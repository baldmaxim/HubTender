package calc

import (
	"encoding/json"
	"math"
	"os"
	"testing"
)

// Stage 0.1.2.3a golden Go↔TS parity suite. The SAME fixture file drives the
// focused TypeScript check (scripts/checks/redistributionParity.check.mjs) —
// any numeric drift between the two engines turns one of the suites red.

const goldenEpsilon = 1e-9

type goldenItem struct {
	ID                      string  `json:"id"`
	ClientPositionID        string  `json:"client_position_id"`
	DetailCostCategoryID    *string `json:"detail_cost_category_id"`
	BoqItemType             string  `json:"boq_item_type"`
	TotalCommercialWorkCost float64 `json:"total_commercial_work_cost"`
}

type goldenRule struct {
	Level                string   `json:"level"`
	CategoryID           string   `json:"category_id"`
	DetailCostCategoryID string   `json:"detail_cost_category_id"`
	Percentage           float64  `json:"percentage"`
	BoqItemTypes         []string `json:"boq_item_types"`
}

type goldenExpectedRow struct {
	Original float64 `json:"original"`
	Deducted float64 `json:"deducted"`
	Added    float64 `json:"added"`
	Final    float64 `json:"final"`
}

type goldenCase struct {
	Name       string       `json:"name"`
	BoqItems   []goldenItem `json:"boq_items"`
	Deductions []goldenRule `json:"deductions"`
	Targets    []goldenRule `json:"targets"`
	Expected   struct {
		TotalDeducted float64                      `json:"total_deducted"`
		TotalAdded    float64                      `json:"total_added"`
		IsBalanced    bool                         `json:"is_balanced"`
		Results       map[string]goldenExpectedRow `json:"results"`
	} `json:"expected"`
}

type goldenFile struct {
	DetailCategories map[string]string `json:"detail_categories"`
	Cases            []goldenCase      `json:"cases"`
}

func loadGoldenCases(t *testing.T) goldenFile {
	t.Helper()
	raw, err := os.ReadFile("testdata/redistribution_cases.json")
	if err != nil {
		t.Fatalf("read golden fixtures: %v", err)
	}
	var f goldenFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse golden fixtures: %v", err)
	}
	if len(f.Cases) < 12 {
		t.Fatalf("golden fixture must keep >= 12 cases, got %d", len(f.Cases))
	}
	return f
}

func approxEq(a, b float64) bool { return math.Abs(a-b) <= goldenEpsilon }

func TestRedistributionGoldenParity(t *testing.T) {
	f := loadGoldenCases(t)

	for _, tc := range f.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			items := make([]BoqItemWithCosts, len(tc.BoqItems))
			for i, gi := range tc.BoqItems {
				items[i] = BoqItemWithCosts{
					ID:                      gi.ID,
					ClientPositionID:        gi.ClientPositionID,
					DetailCostCategoryID:    gi.DetailCostCategoryID,
					BoqItemType:             gi.BoqItemType,
					TotalCommercialWorkCost: gi.TotalCommercialWorkCost,
				}
			}
			sources := make([]SourceRule, len(tc.Deductions))
			for i, gr := range tc.Deductions {
				sources[i] = SourceRule{
					Level:                RuleLevel(gr.Level),
					CategoryID:           gr.CategoryID,
					DetailCostCategoryID: gr.DetailCostCategoryID,
					Percentage:           gr.Percentage,
					BoqItemTypes:         gr.BoqItemTypes,
				}
			}
			targets := make([]TargetCost, len(tc.Targets))
			for i, gr := range tc.Targets {
				targets[i] = TargetCost{
					Level:                RuleLevel(gr.Level),
					CategoryID:           gr.CategoryID,
					DetailCostCategoryID: gr.DetailCostCategoryID,
				}
			}

			out := CalculateRedistribution(items, sources, targets, f.DetailCategories)

			if !approxEq(out.TotalDeducted, tc.Expected.TotalDeducted) {
				t.Errorf("total_deducted = %v, want %v", out.TotalDeducted, tc.Expected.TotalDeducted)
			}
			if !approxEq(out.TotalAdded, tc.Expected.TotalAdded) {
				t.Errorf("total_added = %v, want %v", out.TotalAdded, tc.Expected.TotalAdded)
			}
			if out.IsBalanced != tc.Expected.IsBalanced {
				t.Errorf("is_balanced = %v, want %v", out.IsBalanced, tc.Expected.IsBalanced)
			}
			if len(out.Results) != len(tc.Expected.Results) {
				t.Fatalf("results count = %d, want %d", len(out.Results), len(tc.Expected.Results))
			}
			for _, r := range out.Results {
				want, ok := tc.Expected.Results[r.BoqItemID]
				if !ok {
					t.Errorf("unexpected result row %s", r.BoqItemID)
					continue
				}
				if !approxEq(r.OriginalWorkCost, want.Original) ||
					!approxEq(r.DeductedAmount, want.Deducted) ||
					!approxEq(r.AddedAmount, want.Added) ||
					!approxEq(r.FinalWorkCost, want.Final) {
					t.Errorf("row %s = {orig:%v ded:%v add:%v fin:%v}, want {%v %v %v %v}",
						r.BoqItemID, r.OriginalWorkCost, r.DeductedAmount, r.AddedAmount, r.FinalWorkCost,
						want.Original, want.Deducted, want.Added, want.Final)
				}
			}
			// final = original - deducted + added must hold row-by-row.
			for _, r := range out.Results {
				if !approxEq(r.FinalWorkCost, r.OriginalWorkCost-r.DeductedAmount+r.AddedAmount) {
					t.Errorf("row %s violates final = original - deducted + added", r.BoqItemID)
				}
			}
		})
	}
}
