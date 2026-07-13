// Stage 0.1.2.3a: server-side validation of position-level ("между строками")
// adjustment rules + calculation invariants of the category-level snapshot.
// Port of src/pages/CostRedistribution/utils/calculatePositionAdjustment.ts
// (validation + cumulative deltas over an evolving base). Deltas are returned
// as diagnostics for 0.1.2.3b — they are NEVER persisted as money in 0.1.2.3a.
package calc

import (
	"fmt"
	"math"
	"sort"
)

// positionAdjustmentEpsilon mirrors the TS EPSILON for the amount-vs-source
// check (0.01 = one kopeck of tolerance).
const positionAdjustmentEpsilon = 0.01

// redistributionBalanceTolerance — |deducted − added| below this is balanced
// (same 0.01 the engine's IsBalanced uses; documented single source).
const redistributionBalanceTolerance = 0.01

// redistributionRowEpsilon — per-row identity tolerance for
// final = original − deducted + added and non-negativity of final
// (floating-point residuals only, never a real imbalance).
const redistributionRowEpsilon = 1e-6

// PositionBaseRow is the server-generated category-level base for position
// rules: per client position, the works total AFTER category redistribution.
type PositionBaseRow struct {
	PositionID      string
	TotalWorksAfter float64
}

// ValidatePositionAdjustments validates the rule sequence on the EVOLVING
// server-generated base (rule N+1 sees the base after rule N) and returns the
// cumulative per-position deltas. knownPositions must contain ONLY positions of
// the current tender — a foreign/unknown ID is a blocking issue.
func ValidatePositionAdjustments(
	rules []PositionAdjustmentRuleInput,
	base []PositionBaseRow,
	knownPositions map[string]bool,
) ([]RuleIssue, map[string]float64) {
	issues := make([]RuleIssue, 0)
	cumulative := make(map[string]float64)

	baseByID := make(map[string]float64, len(base))
	for _, row := range base {
		baseByID[row.PositionID] = row.TotalWorksAfter
	}

	for i, rule := range rules {
		f := fmt.Sprintf("position_adjustments[%d]", i)
		ruleOK := true

		if rule.Mode != "deduct" && rule.Mode != "transfer" && rule.Mode != "add" {
			issues = append(issues, issue(f+".mode", "INVALID_MODE", "mode должен быть deduct, transfer или add"))
			continue
		}
		if !isFinite(rule.Amount) {
			issues = append(issues, issue(f+".amount", "AMOUNT_NOT_FINITE", "Сумма должна быть конечным числом"))
			continue
		}
		if rule.Amount <= 0 {
			issues = append(issues, issue(f+".amount", "AMOUNT_REQUIRED", "Введите сумму больше нуля"))
			ruleOK = false
		}

		needSource := rule.Mode == "deduct" || rule.Mode == "transfer"
		needTarget := rule.Mode == "add" || rule.Mode == "transfer"
		if needSource && len(rule.SourceIDs) == 0 {
			issues = append(issues, issue(f+".sourceIds", "SOURCE_REQUIRED", "Выберите строки в блоке «Откуда»"))
			ruleOK = false
		}
		if needTarget && len(rule.TargetIDs) == 0 {
			issues = append(issues, issue(f+".targetIds", "TARGET_REQUIRED", "Выберите строки в блоке «Куда»"))
			ruleOK = false
		}

		// IDs: known (current tender), no duplicates, no source∩target overlap.
		checkIDs := func(ids []string, sub string) {
			seen := map[string]bool{}
			for _, id := range ids {
				if !knownPositions[id] {
					issues = append(issues, issue(f+"."+sub, "UNKNOWN_POSITION",
						"Позиция не найдена в текущем тендере: "+id))
					ruleOK = false
				}
				if seen[id] {
					issues = append(issues, issue(f+"."+sub, "DUPLICATE_POSITION_ID", "Дублирующийся ID позиции: "+id))
					ruleOK = false
				}
				seen[id] = true
			}
		}
		checkIDs(rule.SourceIDs, "sourceIds")
		checkIDs(rule.TargetIDs, "targetIds")
		if rule.Mode == "transfer" {
			src := map[string]bool{}
			for _, id := range rule.SourceIDs {
				src[id] = true
			}
			for _, id := range rule.TargetIDs {
				if src[id] {
					issues = append(issues, issue(f, "SOURCE_TARGET_OVERLAP",
						"Одна и та же строка не может быть одновременно источником и получателем"))
					ruleOK = false
					break
				}
			}
		}

		// Amount vs available source total ON THE EVOLVING BASE.
		if ruleOK && needSource && rule.Amount > 0 {
			totalSource := 0.0
			for _, id := range rule.SourceIDs {
				totalSource += math.Max(0, baseByID[id])
			}
			if rule.Amount-totalSource > positionAdjustmentEpsilon {
				issues = append(issues, issue(f+".amount", "AMOUNT_EXCEEDS_SOURCE",
					fmt.Sprintf("Сумма %.2f превышает итог работ выбранных строк %.2f", rule.Amount, totalSource)))
				ruleOK = false
			}
		}
		if !ruleOK {
			continue
		}

		// Apply this rule's proportional deltas to the evolving base (mirrors TS).
		applyProportional := func(ids []string, sign float64) {
			total := 0.0
			for _, id := range ids {
				total += math.Max(0, baseByID[id])
			}
			if total <= 0 {
				return
			}
			for _, id := range ids {
				share := math.Max(0, baseByID[id]) / total
				delta := sign * rule.Amount * share
				cumulative[id] += delta
				baseByID[id] += delta
			}
		}
		if needSource {
			applyProportional(rule.SourceIDs, -1)
		}
		if needTarget {
			applyProportional(rule.TargetIDs, 1)
		}
	}

	return issues, cumulative
}

// PositionWorksAfterRedistribution aggregates the category-level snapshot into
// per-position works totals (Σ final_work_cost per client position) — the base
// on which position rules are validated. Deterministic order by position id.
func PositionWorksAfterRedistribution(
	items []BoqItemWithCosts,
	results []RedistributionResult,
) []PositionBaseRow {
	finalByItem := make(map[string]float64, len(results))
	for _, r := range results {
		finalByItem[r.BoqItemID] = r.FinalWorkCost
	}
	sums := map[string]float64{}
	for _, it := range items {
		sums[it.ClientPositionID] += finalByItem[it.ID]
	}
	out := make([]PositionBaseRow, 0, len(sums))
	for id, total := range sums {
		out = append(out, PositionBaseRow{PositionID: id, TotalWorksAfter: total})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PositionID < out[j].PositionID })
	return out
}

// ValidateRedistributionCalculation enforces the §9 invariants on a calculated
// snapshot BEFORE persistence. items is the exact server-loaded BOQ set.
// Returns UnbalancedRedistributionError for a real imbalance; any structural
// violation is an InvalidRedistributionCalculationResultError (internal bug).
func ValidateRedistributionCalculation(
	items []BoqItemWithCosts,
	out RedistributionCalculationResult,
) error {
	if len(out.Results) != len(items) {
		return &InvalidRedistributionCalculationResultError{
			Field:  "results",
			Reason: fmt.Sprintf("result set size %d != BOQ set size %d", len(out.Results), len(items)),
		}
	}
	itemByID := make(map[string]BoqItemWithCosts, len(items))
	for _, it := range items {
		itemByID[it.ID] = it
	}
	seen := make(map[string]bool, len(out.Results))
	for i, r := range out.Results {
		if seen[r.BoqItemID] {
			return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID, Reason: "duplicate BoqItemID"}
		}
		seen[r.BoqItemID] = true
		it, ok := itemByID[r.BoqItemID]
		if !ok {
			return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID, Reason: "unknown BoqItemID (not in the tender's BOQ set)"}
		}
		// Deterministic order: results follow the input BOQ order by construction.
		if items[i].ID != r.BoqItemID {
			return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID, Reason: "non-deterministic result order"}
		}
		for _, v := range []struct {
			name string
			val  float64
		}{
			{"original_work_cost", r.OriginalWorkCost},
			{"deducted_amount", r.DeductedAmount},
			{"added_amount", r.AddedAmount},
			{"final_work_cost", r.FinalWorkCost},
		} {
			if !isFinite(v.val) {
				return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID + "." + v.name, Reason: "non-finite value"}
			}
		}
		if r.OriginalWorkCost < 0 || r.DeductedAmount < 0 || r.AddedAmount < 0 {
			return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID, Reason: "negative amount"}
		}
		if r.FinalWorkCost < -redistributionRowEpsilon {
			return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID, Reason: "negative final_work_cost"}
		}
		if math.Abs(r.FinalWorkCost-(r.OriginalWorkCost-r.DeductedAmount+r.AddedAmount)) > redistributionRowEpsilon {
			return &InvalidRedistributionCalculationResultError{Field: r.BoqItemID, Reason: "final != original - deducted + added"}
		}
		if math.Abs(r.OriginalWorkCost-it.TotalCommercialWorkCost) > redistributionRowEpsilon {
			return &InvalidRedistributionCalculationResultError{
				Field:  r.BoqItemID,
				Reason: "original_work_cost does not match the current total_commercial_work_cost",
			}
		}
	}
	// Balance is a hard requirement, not an informational warning. Microscopic
	// floating residuals are within the documented 0.01 tolerance; a real
	// imbalance is never silently clamped.
	if math.Abs(out.TotalDeducted-out.TotalAdded) >= redistributionBalanceTolerance {
		return &UnbalancedRedistributionError{TotalDeducted: out.TotalDeducted, TotalAdded: out.TotalAdded}
	}
	return nil
}
