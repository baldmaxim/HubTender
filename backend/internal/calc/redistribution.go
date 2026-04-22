// Port of src/pages/CostRedistribution/utils/calculateDistribution.ts.
// 3-step work-cost redistribution engine: deduct from source categories,
// accumulate into a total pool, add to target categories proportionally.
// Stay 1:1 with TS; any drift = cutover blocker.
package calc

import "math"

// RuleLevel selects the scope of a source rule / target.
type RuleLevel string

const (
	LevelCategory RuleLevel = "category" // whole cost_category (via detailCategoriesMap)
	LevelDetail   RuleLevel = "detail"   // specific detail_cost_category_id
)

// SourceRule — one line of the "откуда вычитаем" list.
type SourceRule struct {
	CategoryID           string // non-empty when Level=="category"
	DetailCostCategoryID string // non-empty when Level=="detail"
	CategoryName         string
	Percentage           float64 // 0-100
	Level                RuleLevel
}

// TargetCost — one line of the "куда добавляем" list.
type TargetCost struct {
	CategoryID           string
	DetailCostCategoryID string
	CategoryName         string
	Level                RuleLevel
}

// BoqItemWithCosts is the subset of boq_items needed for redistribution.
type BoqItemWithCosts struct {
	ID                         string
	ClientPositionID           string
	DetailCostCategoryID       *string // nil when not categorised
	BoqItemType                string
	TotalCommercialWorkCost    float64
	TotalCommercialMaterialCost float64
}

// RedistributionResult — per-item delta to apply.
type RedistributionResult struct {
	BoqItemID        string
	OriginalWorkCost float64
	DeductedAmount   float64
	AddedAmount      float64
	FinalWorkCost    float64 // original - deducted + added
}

// RedistributionCalculationResult is returned by CalculateRedistribution.
type RedistributionCalculationResult struct {
	Results       []RedistributionResult
	TotalDeducted float64
	TotalAdded    float64
	IsBalanced    bool // |deducted - added| < 0.01
}

// Internal bucket for step 1.
type deductionBucket struct {
	DeductedAmount float64
	AffectedItems  []string
}

// detailCategoriesMap maps detail_cost_category_id → cost_category_id.
type detailCategoriesMap = map[string]string

// CalculateDeductions — step 1: compute the amount to subtract per source rule.
func CalculateDeductions(
	boqItems []BoqItemWithCosts,
	sourceRules []SourceRule,
	detailCategoriesMap detailCategoriesMap,
) map[string]deductionBucket {
	deductions := make(map[string]deductionBucket)

	for _, rule := range sourceRules {
		var itemsInCategory []BoqItemWithCosts

		if rule.Level == LevelDetail && rule.DetailCostCategoryID != "" {
			for _, item := range boqItems {
				if item.DetailCostCategoryID != nil && *item.DetailCostCategoryID == rule.DetailCostCategoryID {
					itemsInCategory = append(itemsInCategory, item)
				}
			}
		} else if rule.Level == LevelCategory && rule.CategoryID != "" && detailCategoriesMap != nil {
			for _, item := range boqItems {
				if item.DetailCostCategoryID == nil {
					continue
				}
				if detailCategoriesMap[*item.DetailCostCategoryID] == rule.CategoryID {
					itemsInCategory = append(itemsInCategory, item)
				}
			}
		}

		if len(itemsInCategory) == 0 {
			continue
		}

		totalCost := 0.0
		ids := make([]string, 0, len(itemsInCategory))
		for _, item := range itemsInCategory {
			totalCost += item.TotalCommercialWorkCost
			ids = append(ids, item.ID)
		}

		deductedAmount := totalCost * rule.Percentage / 100

		key := rule.DetailCostCategoryID
		if rule.Level == LevelCategory {
			key = "cat_" + rule.CategoryID
		}

		deductions[key] = deductionBucket{
			DeductedAmount: deductedAmount,
			AffectedItems:  ids,
		}
	}

	return deductions
}

// ApplyDeductions — step 2: distribute each deduction across its items,
// proportionally to each item's work_cost. Zero-total falls back to equal split.
func ApplyDeductions(
	boqItems []BoqItemWithCosts,
	deductions map[string]deductionBucket,
) map[string]struct{ Original, Deducted float64 } {
	itemDeductions := make(map[string]struct{ Original, Deducted float64 })
	for _, item := range boqItems {
		itemDeductions[item.ID] = struct{ Original, Deducted float64 }{
			Original: item.TotalCommercialWorkCost,
			Deducted: 0,
		}
	}

	boqItemsMap := make(map[string]BoqItemWithCosts, len(boqItems))
	for _, item := range boqItems {
		boqItemsMap[item.ID] = item
	}

	for _, bucket := range deductions {
		if len(bucket.AffectedItems) == 0 {
			continue
		}

		totalCost := 0.0
		for _, id := range bucket.AffectedItems {
			if it, ok := boqItemsMap[id]; ok {
				totalCost += it.TotalCommercialWorkCost
			}
		}

		if totalCost == 0 {
			// Equal split fallback (div-by-zero guard).
			perItem := bucket.DeductedAmount / float64(len(bucket.AffectedItems))
			for _, id := range bucket.AffectedItems {
				current := itemDeductions[id]
				itemDeductions[id] = struct{ Original, Deducted float64 }{
					Original: current.Original,
					Deducted: current.Deducted + perItem,
				}
			}
			continue
		}

		for _, id := range bucket.AffectedItems {
			item, ok := boqItemsMap[id]
			if !ok {
				continue
			}
			proportion := item.TotalCommercialWorkCost / totalCost
			deductForItem := bucket.DeductedAmount * proportion

			current := itemDeductions[id]
			itemDeductions[id] = struct{ Original, Deducted float64 }{
				Original: current.Original,
				Deducted: current.Deducted + deductForItem,
			}
		}
	}

	return itemDeductions
}

// CalculateAdditions — step 3: distribute the total deducted amount across
// target-category items proportionally to each item's work_cost.
func CalculateAdditions(
	boqItems []BoqItemWithCosts,
	targetCosts []TargetCost,
	totalDeduction float64,
	detailCategoriesMap detailCategoriesMap,
) map[string]float64 {
	itemAdditions := make(map[string]float64, len(boqItems))
	for _, item := range boqItems {
		itemAdditions[item.ID] = 0
	}

	if totalDeduction == 0 || len(targetCosts) == 0 {
		return itemAdditions
	}

	isTargetItem := func(item BoqItemWithCosts) bool {
		for _, target := range targetCosts {
			switch {
			case target.Level == LevelDetail && target.DetailCostCategoryID != "":
				if item.DetailCostCategoryID != nil && *item.DetailCostCategoryID == target.DetailCostCategoryID {
					return true
				}
			case target.Level == LevelCategory && target.CategoryID != "" && detailCategoriesMap != nil:
				if item.DetailCostCategoryID == nil {
					continue
				}
				if detailCategoriesMap[*item.DetailCostCategoryID] == target.CategoryID {
					return true
				}
			}
		}
		return false
	}

	var targetItems []BoqItemWithCosts
	totalTargetCost := 0.0
	for _, item := range boqItems {
		if isTargetItem(item) {
			targetItems = append(targetItems, item)
			totalTargetCost += item.TotalCommercialWorkCost
		}
	}

	if len(targetItems) == 0 {
		return itemAdditions
	}

	if totalTargetCost == 0 {
		perItem := totalDeduction / float64(len(targetItems))
		for _, item := range targetItems {
			itemAdditions[item.ID] = perItem
		}
		return itemAdditions
	}

	for _, item := range targetItems {
		proportion := item.TotalCommercialWorkCost / totalTargetCost
		itemAdditions[item.ID] = totalDeduction * proportion
	}

	return itemAdditions
}

// CalculateRedistribution runs the full 3-step pipeline and returns per-item
// results along with balance check (|deducted - added| < 0.01).
func CalculateRedistribution(
	boqItems []BoqItemWithCosts,
	sourceRules []SourceRule,
	targetCosts []TargetCost,
	detailCategoriesMap detailCategoriesMap,
) RedistributionCalculationResult {
	deductions := CalculateDeductions(boqItems, sourceRules, detailCategoriesMap)
	itemDeductions := ApplyDeductions(boqItems, deductions)

	totalDeducted := 0.0
	for _, v := range itemDeductions {
		totalDeducted += v.Deducted
	}

	itemAdditions := CalculateAdditions(boqItems, targetCosts, totalDeducted, detailCategoriesMap)

	totalAdded := 0.0
	for _, v := range itemAdditions {
		totalAdded += v
	}

	results := make([]RedistributionResult, 0, len(boqItems))
	for _, item := range boqItems {
		d := itemDeductions[item.ID]
		a := itemAdditions[item.ID]
		results = append(results, RedistributionResult{
			BoqItemID:        item.ID,
			OriginalWorkCost: d.Original,
			DeductedAmount:   d.Deducted,
			AddedAmount:      a,
			FinalWorkCost:    d.Original - d.Deducted + a,
		})
	}

	return RedistributionCalculationResult{
		Results:       results,
		TotalDeducted: totalDeducted,
		TotalAdded:    totalAdded,
		IsBalanced:    math.Abs(totalDeducted-totalAdded) < 0.01,
	}
}
