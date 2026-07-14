// Stage 0.1.2.3b (§18): invariants of the prepared redistribution projection.
// A violated invariant is an internal bug — the result is never returned as
// success and never persisted; no silent clamp.
package calc

import "math"

// preparedMoneyTolerance — money-level tolerance for row identities and
// summary-vs-rows comparisons (floating accumulation over many rows).
const preparedMoneyTolerance = 0.01

func near(a, b float64) bool { return math.Abs(a-b) <= preparedMoneyTolerance }

// ValidatePreparedRedistribution enforces the §18 invariants on a built
// projection. Deterministic inputs are the caller's duty; this checks the
// numbers.
func ValidatePreparedRedistribution(p *PreparedRedistribution) error {
	seen := make(map[string]bool, len(p.Rows))
	var sum PreparedSummary

	for _, r := range p.Rows {
		if seen[r.PositionID] {
			return &InvalidPreparedRedistributionResultError{
				Field: r.PositionID, Reason: "duplicate position row"}
		}
		seen[r.PositionID] = true

		for _, v := range []struct {
			name string
			val  float64
		}{
			{"material_cost", r.MaterialCost},
			{"work_cost_before", r.WorkCostBefore},
			{"category_deducted", r.CategoryDeducted},
			{"category_added", r.CategoryAdded},
			{"work_cost_after_category", r.WorkCostAfterCategory},
			{"position_deducted", r.PositionDeducted},
			{"position_added", r.PositionAdded},
			{"work_cost_after_adjustments", r.WorkCostAfterAdjustment},
			{"rounding_adjustment", r.RoundingAdjustment},
			{"work_cost_rounded", r.WorkCostRounded},
			{"insurance_amount", r.InsuranceAmount},
			{"final_work_cost", r.FinalWorkCost},
			{"final_position_total", r.FinalPositionTotal},
		} {
			if !isFinite(v.val) {
				return &InvalidPreparedRedistributionResultError{
					Field: r.PositionID + "." + v.name, Reason: "non-finite value"}
			}
		}
		// Costs are non-negative (rounding of a non-negative works base cannot
		// produce a negative row; adjustments are validated not to drain below 0).
		for _, v := range []struct {
			name string
			val  float64
		}{
			{"material_cost", r.MaterialCost},
			{"work_cost_rounded", r.WorkCostRounded},
			{"insurance_amount", r.InsuranceAmount},
			{"final_work_cost", r.FinalWorkCost},
			{"final_position_total", r.FinalPositionTotal},
		} {
			if v.val < -preparedMoneyTolerance {
				return &InvalidPreparedRedistributionResultError{
					Field: r.PositionID + "." + v.name, Actual: v.val, Reason: "negative cost"}
			}
		}

		// §18.6-9 — per-row identities of the canonical order.
		if !near(r.WorkCostAfterCategory, r.WorkCostBefore-r.CategoryDeducted+r.CategoryAdded) {
			return &InvalidPreparedRedistributionResultError{
				Field:    r.PositionID + ".work_cost_after_category",
				Expected: r.WorkCostBefore - r.CategoryDeducted + r.CategoryAdded,
				Actual:   r.WorkCostAfterCategory,
				Reason:   "after_category != before - category_deducted + category_added"}
		}
		if !near(r.WorkCostAfterAdjustment, r.WorkCostAfterCategory-r.PositionDeducted+r.PositionAdded) {
			return &InvalidPreparedRedistributionResultError{
				Field:    r.PositionID + ".work_cost_after_adjustments",
				Expected: r.WorkCostAfterCategory - r.PositionDeducted + r.PositionAdded,
				Actual:   r.WorkCostAfterAdjustment,
				Reason:   "after_position != after_category - position_deducted + position_added"}
		}
		if !near(r.WorkCostRounded, r.WorkCostAfterAdjustment+r.RoundingAdjustment) {
			return &InvalidPreparedRedistributionResultError{
				Field:    r.PositionID + ".work_cost_rounded",
				Expected: r.WorkCostAfterAdjustment + r.RoundingAdjustment,
				Actual:   r.WorkCostRounded,
				Reason:   "rounded != after_position + rounding_adjustment"}
		}
		if !near(r.FinalWorkCost, r.WorkCostRounded+r.InsuranceAmount) {
			return &InvalidPreparedRedistributionResultError{
				Field:    r.PositionID + ".final_work_cost",
				Expected: r.WorkCostRounded + r.InsuranceAmount,
				Actual:   r.FinalWorkCost,
				Reason:   "final != rounded + insurance"}
		}
		if !near(r.FinalPositionTotal, r.RoundedMaterialCost+r.FinalWorkCost) {
			return &InvalidPreparedRedistributionResultError{
				Field:    r.PositionID + ".final_position_total",
				Expected: r.RoundedMaterialCost + r.FinalWorkCost,
				Actual:   r.FinalPositionTotal,
				Reason:   "position total != rounded materials + final works"}
		}

		sum.TotalMaterialCost += r.RoundedMaterialCost
		sum.WorkTotalBeforeCategory += r.WorkCostBefore
		sum.TotalCategoryDeducted += r.CategoryDeducted
		sum.TotalCategoryAdded += r.CategoryAdded
		sum.WorkTotalAfterCategory += r.WorkCostAfterCategory
		sum.TotalPositionDeducted += r.PositionDeducted
		sum.TotalPositionAdded += r.PositionAdded
		sum.WorkTotalAfterAdjustments += r.WorkCostAfterAdjustment
		sum.RoundingAdjustmentTotal += r.RoundingAdjustment
		sum.WorkTotalRoundedPreInsur += r.WorkCostRounded
		sum.InsuranceAllocated += r.InsuranceAmount
		sum.FinalWorkTotal += r.FinalWorkCost
	}

	// §18.10 — summary equals the sum of rows, field by field.
	for _, c := range []struct {
		name            string
		got, recomputed float64
	}{
		{"total_material_cost", p.Summary.TotalMaterialCost, sum.TotalMaterialCost},
		{"work_total_before_category", p.Summary.WorkTotalBeforeCategory, sum.WorkTotalBeforeCategory},
		{"total_category_deducted", p.Summary.TotalCategoryDeducted, sum.TotalCategoryDeducted},
		{"total_category_added", p.Summary.TotalCategoryAdded, sum.TotalCategoryAdded},
		{"work_total_after_category", p.Summary.WorkTotalAfterCategory, sum.WorkTotalAfterCategory},
		{"total_position_deducted", p.Summary.TotalPositionDeducted, sum.TotalPositionDeducted},
		{"total_position_added", p.Summary.TotalPositionAdded, sum.TotalPositionAdded},
		{"work_total_after_adjustments", p.Summary.WorkTotalAfterAdjustments, sum.WorkTotalAfterAdjustments},
		{"rounding_adjustment_total", p.Summary.RoundingAdjustmentTotal, sum.RoundingAdjustmentTotal},
		{"work_total_rounded_pre_insurance", p.Summary.WorkTotalRoundedPreInsur, sum.WorkTotalRoundedPreInsur},
		{"insurance_allocated", p.Summary.InsuranceAllocated, sum.InsuranceAllocated},
		{"final_work_total", p.Summary.FinalWorkTotal, sum.FinalWorkTotal},
	} {
		if !near(c.got, c.recomputed) {
			return &InvalidPreparedRedistributionResultError{
				Field: "summary." + c.name, Expected: c.recomputed, Actual: c.got,
				Reason: "summary does not equal the sum of rows"}
		}
	}
	if !near(p.Summary.FinalTotal, p.Summary.TotalMaterialCost+p.Summary.FinalWorkTotal) {
		return &InvalidPreparedRedistributionResultError{
			Field: "summary.final_total", Reason: "final_total != materials + works"}
	}

	// §18.13 — insurance allocation preserves the total (unless the eligible
	// base was zero — then allocated stays 0 by the documented policy).
	if p.Summary.WorkTotalRoundedPreInsur > 0 &&
		!near(p.Summary.InsuranceAllocated, p.Summary.InsuranceTotal) {
		return &InvalidPreparedRedistributionResultError{
			Field: "summary.insurance_allocated", Expected: p.Summary.InsuranceTotal,
			Actual: p.Summary.InsuranceAllocated, Reason: "insurance allocation lost money"}
	}

	if p.RoundingPolicy != RoundingPolicyUnitPrice2dp {
		return &InvalidPreparedRedistributionResultError{
			Field: "rounding_policy", Reason: "unknown rounding policy"}
	}
	if p.PreparedSchemaVersion != PreparedSchemaVersion {
		return &InvalidPreparedRedistributionResultError{
			Field: "prepared_schema_version", Reason: "unexpected schema version"}
	}
	return nil
}
