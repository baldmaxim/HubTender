package calc

import (
	"math"
	"testing"
)

func ptr(s string) *string { return &s }

// Basic redistribution: one source detail category → one target detail category.
// Source items total 1000 work_cost, 10% deducted = 100, redistributed to one
// target item with 500 work_cost. Result: source down by 100 (proportional),
// target up by 100.
func TestCalculateRedistribution_DetailLevel_OneToOne(t *testing.T) {
	items := []BoqItemWithCosts{
		// Source category A
		{ID: "s1", BoqItemType: "раб", TotalCommercialWorkCost: 600, DetailCostCategoryID: ptr("det-A")},
		{ID: "s2", BoqItemType: "раб", TotalCommercialWorkCost: 400, DetailCostCategoryID: ptr("det-A")},
		// Target category B
		{ID: "t1", BoqItemType: "раб", TotalCommercialWorkCost: 500, DetailCostCategoryID: ptr("det-B")},
	}
	rules := []SourceRule{
		{Level: LevelDetail, DetailCostCategoryID: "det-A", Percentage: 10},
	}
	targets := []TargetCost{
		{Level: LevelDetail, DetailCostCategoryID: "det-B"},
	}

	out := CalculateRedistribution(items, rules, targets, nil)

	if math.Abs(out.TotalDeducted-100) > 1e-6 {
		t.Errorf("totalDeducted: got %v, want 100", out.TotalDeducted)
	}
	if math.Abs(out.TotalAdded-100) > 1e-6 {
		t.Errorf("totalAdded: got %v, want 100", out.TotalAdded)
	}
	if !out.IsBalanced {
		t.Errorf("should be balanced")
	}

	byID := map[string]RedistributionResult{}
	for _, r := range out.Results {
		byID[r.BoqItemID] = r
	}

	// Source proportional: s1 has 600/1000 share → deduct 60. s2 has 400/1000 → 40.
	if math.Abs(byID["s1"].DeductedAmount-60) > 1e-6 {
		t.Errorf("s1 deduct: got %v, want 60", byID["s1"].DeductedAmount)
	}
	if math.Abs(byID["s2"].DeductedAmount-40) > 1e-6 {
		t.Errorf("s2 deduct: got %v, want 40", byID["s2"].DeductedAmount)
	}
	if math.Abs(byID["t1"].AddedAmount-100) > 1e-6 {
		t.Errorf("t1 added: got %v, want 100", byID["t1"].AddedAmount)
	}
	// Final: s1 = 600-60 = 540, s2 = 400-40 = 360, t1 = 500+100 = 600.
	if math.Abs(byID["s1"].FinalWorkCost-540) > 1e-6 {
		t.Errorf("s1 final: got %v", byID["s1"].FinalWorkCost)
	}
	if math.Abs(byID["t1"].FinalWorkCost-600) > 1e-6 {
		t.Errorf("t1 final: got %v", byID["t1"].FinalWorkCost)
	}
}

// Zero totalCost in source → equal-split fallback.
func TestApplyDeductions_ZeroTotal_EqualSplit(t *testing.T) {
	items := []BoqItemWithCosts{
		{ID: "a", TotalCommercialWorkCost: 0, DetailCostCategoryID: ptr("d")},
		{ID: "b", TotalCommercialWorkCost: 0, DetailCostCategoryID: ptr("d")},
		{ID: "c", TotalCommercialWorkCost: 0, DetailCostCategoryID: ptr("d")},
	}
	deductions := map[string]deductionBucket{
		"d": {DeductedAmount: 30, AffectedItems: []string{"a", "b", "c"}},
	}

	out := ApplyDeductions(items, deductions)
	for _, id := range []string{"a", "b", "c"} {
		if math.Abs(out[id].Deducted-10) > 1e-6 {
			t.Errorf("%s: equal-split got %v, want 10", id, out[id].Deducted)
		}
	}
}

// Category-level rule: uses detailCategoriesMap to resolve detail → category.
func TestCalculateDeductions_CategoryLevel(t *testing.T) {
	detailMap := detailCategoriesMap{
		"det-X1": "cat-X",
		"det-X2": "cat-X",
		"det-Y":  "cat-Y",
	}
	items := []BoqItemWithCosts{
		{ID: "i1", TotalCommercialWorkCost: 100, DetailCostCategoryID: ptr("det-X1")},
		{ID: "i2", TotalCommercialWorkCost: 200, DetailCostCategoryID: ptr("det-X2")},
		{ID: "i3", TotalCommercialWorkCost: 999, DetailCostCategoryID: ptr("det-Y")},
	}
	rules := []SourceRule{
		{Level: LevelCategory, CategoryID: "cat-X", Percentage: 50},
	}

	d := CalculateDeductions(items, rules, detailMap)
	bucket := d["cat_cat-X"]
	if math.Abs(bucket.DeductedAmount-150) > 1e-6 {
		t.Errorf("cat-X deduct: got %v, want 150", bucket.DeductedAmount)
	}
	if len(bucket.AffectedItems) != 2 {
		t.Errorf("affected: got %v, want 2", bucket.AffectedItems)
	}
}

// Empty source category → rule skipped (no panic).
func TestCalculateDeductions_EmptyCategory(t *testing.T) {
	items := []BoqItemWithCosts{
		{ID: "a", TotalCommercialWorkCost: 100, DetailCostCategoryID: ptr("det-X")},
	}
	rules := []SourceRule{
		{Level: LevelDetail, DetailCostCategoryID: "det-NOTHING", Percentage: 10},
	}
	d := CalculateDeductions(items, rules, nil)
	if len(d) != 0 {
		t.Errorf("empty cat should produce no bucket: got %v", d)
	}
}

// No target items → additions all zero.
func TestCalculateAdditions_NoTargets(t *testing.T) {
	items := []BoqItemWithCosts{
		{ID: "a", TotalCommercialWorkCost: 100},
	}
	out := CalculateAdditions(items, []TargetCost{}, 100, nil)
	if out["a"] != 0 {
		t.Errorf("no targets: got %v, want 0", out["a"])
	}
}

// Balance check: floating-point noise under 0.01 tolerance.
func TestRedistribution_BalanceWithRoundingNoise(t *testing.T) {
	items := []BoqItemWithCosts{
		{ID: "s1", TotalCommercialWorkCost: 333.33, DetailCostCategoryID: ptr("d-src")},
		{ID: "t1", TotalCommercialWorkCost: 100.01, DetailCostCategoryID: ptr("d-tgt")},
	}
	rules := []SourceRule{
		{Level: LevelDetail, DetailCostCategoryID: "d-src", Percentage: 33.33},
	}
	targets := []TargetCost{
		{Level: LevelDetail, DetailCostCategoryID: "d-tgt"},
	}
	out := CalculateRedistribution(items, rules, targets, nil)
	if !out.IsBalanced {
		t.Errorf("should balance under 0.01: deducted=%v added=%v", out.TotalDeducted, out.TotalAdded)
	}
}
