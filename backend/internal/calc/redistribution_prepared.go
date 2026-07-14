// Stage 0.1.2.3b: the authoritative prepared-redistribution pipeline.
// Port of the SINGLE frontend pipeline shared by CostRedistribution, Commerce
// and both Excel exports:
//
//	buildResultRows (per-position aggregation of the category snapshot)
//	→ position-adjustment cumulative deltas (evolving base, works only)
//	→ smartRoundResults (2dp UNIT-PRICE rounding — the ACTUAL production
//	  policy; the 5-RUB RoundTo5/CompensateError kernel belongs to a different
//	  legacy Commerce flow and is NOT part of this pipeline)
//	→ proportional insurance allocation over the ROUNDED works base
//	→ totals.
//
// Pure: no DB, no env, no HTTP DTO, no map-iteration order dependence.
package calc

import (
	"fmt"
	"math"
	"sort"
)

// PreparedSchemaVersion marks the prepared projection contract.
const PreparedSchemaVersion = 1

// RoundingPolicyUnitPrice2dp — the canonical rounding policy: the per-unit
// price is rounded to 2 decimals (half away from zero, like TS Math.round for
// positive values), then total = round2(rounded_price × quantity). There is NO
// cross-row compensation in this pipeline.
const RoundingPolicyUnitPrice2dp = "unit_price_2dp"

// ─── input ───────────────────────────────────────────────────────────────────

// PreparedPositionInput is one client position (server-loaded metadata).
type PreparedPositionInput struct {
	ID               string
	PositionNumber   int
	SectionNumber    *string
	PositionName     string
	ItemNo           *string
	WorkName         string
	ClientVolume     *float64
	ManualVolume     *float64
	UnitCode         string
	ManualNote       *string
	IsAdditional     bool
	ParentPositionID *string
	HierarchyLevel   int
}

// InsuranceInput mirrors public.tender_insurance (server-loaded).
type InsuranceInput struct {
	AptPriceM2     float64
	AptArea        float64
	ParkingPriceM2 float64
	ParkingArea    float64
	StoragePriceM2 float64
	StorageArea    float64
	JudicialPct    float64
	TotalPct       float64
}

// PreparedRedistributionInput is the fully server-normalized pipeline input.
// Server-generated; must never be populated from an HTTP request.
type PreparedRedistributionInput struct {
	// Positions in stored order (position_number ASC, id as tie-break).
	Positions []PreparedPositionInput
	// BoqItems — the tender's BOQ with CURRENT commercial costs.
	BoqItems []BoqItemWithCosts
	// CategoryResults — the persisted/just-calculated category snapshot.
	CategoryResults []RedistributionResult
	// PositionAdjustments — canonical position rules.
	PositionAdjustments []PositionAdjustmentRuleInput
	// Insurance — nil when the tender has no insurance row.
	Insurance *InsuranceInput
}

// ─── output ──────────────────────────────────────────────────────────────────

// PreparedPositionRow is one final prepared row with a traceable breakdown.
// Server-generated prepared redistribution result.
// Must never be populated from an HTTP request.
type PreparedPositionRow struct {
	PositionID     string   `json:"position_id"`
	PositionNumber int      `json:"position_number"`
	SectionNumber  *string  `json:"section_number"`
	PositionName   string   `json:"position_name"`
	ItemNo         *string  `json:"item_no"`
	WorkName       string   `json:"work_name"`
	ClientVolume   *float64 `json:"client_volume"`
	ManualVolume   *float64 `json:"manual_volume"`
	UnitCode       string   `json:"unit_code"`
	ManualNote     *string  `json:"manual_note"`
	IsAdditional   bool     `json:"is_additional"`
	IsLeaf         bool     `json:"is_leaf"`
	Quantity       float64  `json:"quantity"`

	MaterialCost            float64 `json:"material_cost"`
	WorkCostBefore          float64 `json:"work_cost_before"` // before category redistribution
	CategoryDeducted        float64 `json:"category_deducted"`
	CategoryAdded           float64 `json:"category_added"`
	WorkCostAfterCategory   float64 `json:"work_cost_after_category"`
	PositionDeducted        float64 `json:"position_deducted"`
	PositionAdded           float64 `json:"position_added"`
	WorkCostAfterAdjustment float64 `json:"work_cost_after_adjustments"`

	RoundedMaterialUnitPrice float64 `json:"rounded_material_unit_price"`
	RoundedMaterialCost      float64 `json:"rounded_material_cost"`
	RoundedWorkUnitPrice     float64 `json:"rounded_work_unit_price"`
	RoundingAdjustment       float64 `json:"rounding_adjustment"` // rounded works − after_adjustments
	WorkCostRounded          float64 `json:"work_cost_rounded"`   // pre-insurance

	InsuranceAmount    float64 `json:"insurance_amount"`
	FinalWorkCost      float64 `json:"final_work_cost"` // rounded + insurance
	FinalWorkUnitPrice float64 `json:"final_work_unit_price"`
	FinalPositionTotal float64 `json:"final_position_total"` // rounded materials + final works
}

// PreparedSummary — totals; every field must equal the sum of its rows.
type PreparedSummary struct {
	TotalMaterialCost         float64 `json:"total_material_cost"` // rounded
	WorkTotalBeforeCategory   float64 `json:"work_total_before_category"`
	TotalCategoryDeducted     float64 `json:"total_category_deducted"`
	TotalCategoryAdded        float64 `json:"total_category_added"`
	WorkTotalAfterCategory    float64 `json:"work_total_after_category"`
	TotalPositionDeducted     float64 `json:"total_position_deducted"`
	TotalPositionAdded        float64 `json:"total_position_added"`
	WorkTotalAfterAdjustments float64 `json:"work_total_after_adjustments"`
	RoundingAdjustmentTotal   float64 `json:"rounding_adjustment_total"`
	WorkTotalRoundedPreInsur  float64 `json:"work_total_rounded_pre_insurance"`
	InsuranceTotal            float64 `json:"insurance_total"`
	InsuranceAllocated        float64 `json:"insurance_allocated"`
	FinalWorkTotal            float64 `json:"final_work_total"`
	FinalTotal                float64 `json:"final_total"` // materials + works
	IsCategoryBalanced        bool    `json:"is_category_balanced"`
	IsInsuranceFullyAllocated bool    `json:"is_insurance_fully_allocated"`
}

// PreparedRedistribution is the full server-generated prepared projection.
type PreparedRedistribution struct {
	Rows                  []PreparedPositionRow `json:"rows"`
	Summary               PreparedSummary       `json:"summary"`
	RoundingPolicy        string                `json:"rounding_policy"`
	PreparedSchemaVersion int                   `json:"prepared_schema_version"`
	CalculationSource     string                `json:"calculation_source"`
}

// ─── typed errors ────────────────────────────────────────────────────────────

// InvalidPreparedRedistributionInputError — the server-side inputs are
// inconsistent (a category result references an unknown BOQ item, duplicates…).
type InvalidPreparedRedistributionInputError struct {
	Field    string
	EntityID string
	Reason   string
}

func (e *InvalidPreparedRedistributionInputError) Error() string {
	return fmt.Sprintf("INVALID_PREPARED_REDISTRIBUTION_INPUT: %s (%s=%s)", e.Reason, e.Field, e.EntityID)
}

// InvalidInsuranceConfigurationError — the stored insurance row cannot be
// safely interpreted (non-finite / negative fields).
type InvalidInsuranceConfigurationError struct {
	Field  string
	Reason string
}

func (e *InvalidInsuranceConfigurationError) Error() string {
	return fmt.Sprintf("INVALID_INSURANCE_CONFIGURATION: %s (%s)", e.Reason, e.Field)
}

// Code returns the stable machine-readable error code.
func (e *InvalidInsuranceConfigurationError) Code() string { return "INVALID_INSURANCE_CONFIGURATION" }

// RedistributionSnapshotSetMismatchError — the persisted category snapshot
// does not exactly match the expected BOQ set (missing/extra rows). A partial
// snapshot must never be silently completed with current commercial values.
type RedistributionSnapshotSetMismatchError struct {
	MissingItemIDs []string
	ExtraItemIDs   []string
	ExpectedCount  int
	ActualCount    int
	Reason         string
}

func (e *RedistributionSnapshotSetMismatchError) Error() string {
	limit := func(ids []string) []string {
		if len(ids) > 5 {
			return ids[:5]
		}
		return ids
	}
	return fmt.Sprintf(
		"REDISTRIBUTION_SNAPSHOT_SET_MISMATCH: %s (expected %d, actual %d; missing %d %v, extra %d %v)",
		e.Reason, e.ExpectedCount, e.ActualCount,
		len(e.MissingItemIDs), limit(e.MissingItemIDs),
		len(e.ExtraItemIDs), limit(e.ExtraItemIDs))
}

// Code returns the stable machine-readable error code.
func (e *RedistributionSnapshotSetMismatchError) Code() string {
	return "REDISTRIBUTION_SNAPSHOT_SET_MISMATCH"
}

// InsuranceZeroBaseReason — non-zero insurance with a zero eligible works base:
// the total cannot be allocated and must never be silently dropped.
const InsuranceZeroBaseReason = "NON_ZERO_INSURANCE_WITH_ZERO_BASE"

// InvalidInsuranceAllocationError — the insurance total cannot be (or was not)
// fully allocated across positions; the projection is never "calculated".
type InvalidInsuranceAllocationError struct {
	ExpectedTotal  float64
	AllocatedTotal float64
	Reason         string
}

func (e *InvalidInsuranceAllocationError) Error() string {
	return fmt.Sprintf("INVALID_INSURANCE_ALLOCATION: %s (expected %v, allocated %v)",
		e.Reason, e.ExpectedTotal, e.AllocatedTotal)
}

// Code returns the stable machine-readable error code.
func (e *InvalidInsuranceAllocationError) Code() string { return "INVALID_INSURANCE_ALLOCATION" }

// AdditionalPositionParentMissingReason — a cost-bearing additional position
// without a resolvable regular parent cannot be silently dropped.
const AdditionalPositionParentMissingReason = "ADDITIONAL_POSITION_PARENT_MISSING"

// InvalidPreparedRedistributionResultError — an internal invariant of the
// prepared projection was violated (a bug); never persisted/returned as success.
type InvalidPreparedRedistributionResultError struct {
	Field    string
	Expected float64
	Actual   float64
	Reason   string
}

func (e *InvalidPreparedRedistributionResultError) Error() string {
	return fmt.Sprintf("INVALID_PREPARED_REDISTRIBUTION_RESULT: %s (%s: expected %v, actual %v)",
		e.Reason, e.Field, e.Expected, e.Actual)
}

// ─── insurance ───────────────────────────────────────────────────────────────

// CalculateInsuranceTotal — the canonical tender-insurance formula
// (mirrors computeInsuranceTotal.ts and the grand-total SQL twin):
//
//	(apt_price×apt_area + parking_price×parking_area + storage_price×storage_area)
//	× judicial_pct/100 × total_pct/100
//
// nil input = no insurance row = 0. All fields must be finite and
// non-negative; percentages are validated to [0, 100].
func CalculateInsuranceTotal(in *InsuranceInput) (float64, error) {
	if in == nil {
		return 0, nil
	}
	fields := []struct {
		name string
		val  float64
	}{
		{"apt_price_m2", in.AptPriceM2}, {"apt_area", in.AptArea},
		{"parking_price_m2", in.ParkingPriceM2}, {"parking_area", in.ParkingArea},
		{"storage_price_m2", in.StoragePriceM2}, {"storage_area", in.StorageArea},
		{"judicial_pct", in.JudicialPct}, {"total_pct", in.TotalPct},
	}
	for _, f := range fields {
		if !isFinite(f.val) {
			return 0, &InvalidInsuranceConfigurationError{Field: f.name, Reason: "non-finite value"}
		}
		if f.val < 0 {
			return 0, &InvalidInsuranceConfigurationError{Field: f.name, Reason: "negative value"}
		}
	}
	for _, p := range []struct {
		name string
		val  float64
	}{{"judicial_pct", in.JudicialPct}, {"total_pct", in.TotalPct}} {
		if p.val > 100 {
			return 0, &InvalidInsuranceConfigurationError{Field: p.name, Reason: "percentage out of range [0,100]"}
		}
	}
	base := in.AptPriceM2*in.AptArea + in.ParkingPriceM2*in.ParkingArea + in.StoragePriceM2*in.StorageArea
	return base * (in.JudicialPct / 100) * (in.TotalPct / 100), nil
}

// round2 mirrors the TS Math.round(v*100)/100 for the non-negative money this
// pipeline produces (half up).
func round2(v float64) float64 { return math.Round(v*100) / 100 }

// ─── the pipeline ────────────────────────────────────────────────────────────

// positionBase is the per-position aggregation of the category snapshot.
type positionBase struct {
	pos              PreparedPositionInput
	isLeaf           bool
	materials        float64
	worksBefore      float64
	categoryDeducted float64
	categoryAdded    float64
	worksAfter       float64
}

// ExpectedRedistributionBoqItems is the ONE domain classification of which BOQ
// items must carry a category result — shared by save-invariants and the
// prepared projection (no separate save/GET/prepared sets).
//
// Current domain model: EVERY BOQ item of the tender participates in category
// redistribution (stage 0.1.2.3a persists the complete set — work, material
// and additional item types alike; there is no excluded class). If an excluded
// class ever appears, it must be encoded HERE with an explicit predicate — a
// missing category result is NEVER a pass-through.
func ExpectedRedistributionBoqItems(items []BoqItemWithCosts) map[string]bool {
	expected := make(map[string]bool, len(items))
	for _, it := range items {
		expected[it.ID] = true
	}
	return expected
}

// aggregatePositions ports buildResultRows ordering + aggregation with the
// stage 0.1.2.3b.1 fail-closed rules:
//
//   - the category snapshot must EXACTLY match ExpectedRedistributionBoqItems:
//     a missing or extra result is a RedistributionSnapshotSetMismatchError —
//     never a pass-through with current commercial values, never an ignored
//     extra row;
//   - an additional (ДОП) position without a resolvable REGULAR parent is
//     dropped ONLY when it carries no BOQ items (presentation-only, zero
//     financial base by construction); a cost-bearing one is a typed error
//     (ADDITIONAL_POSITION_PARENT_MISSING) — money never silently disappears.
func aggregatePositions(in PreparedRedistributionInput) ([]positionBase, error) {
	resultByItem := make(map[string]RedistributionResult, len(in.CategoryResults))
	for _, r := range in.CategoryResults {
		if _, dup := resultByItem[r.BoqItemID]; dup {
			return nil, &InvalidPreparedRedistributionInputError{
				Field: "category_results", EntityID: r.BoqItemID, Reason: "duplicate category result"}
		}
		resultByItem[r.BoqItemID] = r
	}
	knownItems := make(map[string]bool, len(in.BoqItems))
	itemsByPosition := map[string][]BoqItemWithCosts{}
	knownPositions := make(map[string]bool, len(in.Positions))
	for _, p := range in.Positions {
		if knownPositions[p.ID] {
			return nil, &InvalidPreparedRedistributionInputError{
				Field: "positions", EntityID: p.ID, Reason: "duplicate position"}
		}
		knownPositions[p.ID] = true
	}
	for _, it := range in.BoqItems {
		if knownItems[it.ID] {
			return nil, &InvalidPreparedRedistributionInputError{
				Field: "boq_items", EntityID: it.ID, Reason: "duplicate BOQ item"}
		}
		knownItems[it.ID] = true
		if !knownPositions[it.ClientPositionID] {
			return nil, &InvalidPreparedRedistributionInputError{
				Field: "boq_items", EntityID: it.ID, Reason: "unknown client_position_id"}
		}
		itemsByPosition[it.ClientPositionID] = append(itemsByPosition[it.ClientPositionID], it)
	}

	// Exact-set check: expected BOQ IDs == actual snapshot IDs.
	expected := ExpectedRedistributionBoqItems(in.BoqItems)
	var missing, extra []string
	for _, it := range in.BoqItems {
		if _, ok := resultByItem[it.ID]; !ok {
			missing = append(missing, it.ID)
		}
	}
	for id := range resultByItem {
		if !expected[id] {
			extra = append(extra, id)
		}
	}
	sort.Strings(missing)
	sort.Strings(extra)
	if len(missing) > 0 || len(extra) > 0 {
		return nil, &RedistributionSnapshotSetMismatchError{
			MissingItemIDs: missing,
			ExtraItemIDs:   extra,
			ExpectedCount:  len(expected),
			ActualCount:    len(resultByItem),
			Reason:         "category snapshot does not match the expected BOQ set",
		}
	}

	build := func(p PreparedPositionInput, isLeaf bool) positionBase {
		b := positionBase{pos: p, isLeaf: isLeaf}
		for _, it := range itemsByPosition[p.ID] {
			b.materials += it.TotalCommercialMaterialCost
			r := resultByItem[it.ID] // exact set guaranteed above
			b.worksBefore += r.OriginalWorkCost
			b.worksAfter += r.FinalWorkCost
			b.categoryDeducted += r.DeductedAmount
			b.categoryAdded += r.AddedAmount
		}
		return b
	}

	regularByID := map[string]bool{}
	for _, p := range in.Positions {
		if !p.IsAdditional {
			regularByID[p.ID] = true
		}
	}
	var regulars []PreparedPositionInput
	additionalByParent := map[string][]PreparedPositionInput{}
	for _, p := range in.Positions {
		if !p.IsAdditional {
			regulars = append(regulars, p)
			continue
		}
		if p.ParentPositionID == nil || !regularByID[*p.ParentPositionID] {
			// Financial significance is decided by the position's BOQ items —
			// not by the presence of a parent. Cost-bearing → blocking error.
			if len(itemsByPosition[p.ID]) > 0 {
				return nil, &InvalidPreparedRedistributionInputError{
					Field: "positions", EntityID: p.ID,
					Reason: AdditionalPositionParentMissingReason}
			}
			continue // presentation-only: no BOQ items ⇒ zero financial base
		}
		additionalByParent[*p.ParentPositionID] = append(additionalByParent[*p.ParentPositionID], p)
	}
	isLeaf := func(i int) bool {
		if i == len(regulars)-1 {
			return true
		}
		return regulars[i].HierarchyLevel >= regulars[i+1].HierarchyLevel
	}

	out := make([]positionBase, 0, len(in.Positions))
	for i, p := range regulars {
		out = append(out, build(p, isLeaf(i)))
		for _, add := range additionalByParent[p.ID] {
			out = append(out, build(add, true)) // additional rows are always leaves
		}
	}
	return out, nil
}

// BuildPreparedRedistribution runs the full authoritative pipeline and
// validates every invariant before returning. Deterministic: same inputs →
// identical output; input BOQ/result order does not matter.
func BuildPreparedRedistribution(in PreparedRedistributionInput) (*PreparedRedistribution, error) {
	bases, err := aggregatePositions(in)
	if err != nil {
		return nil, err
	}

	// Position adjustments on the evolving works base (shared validator —
	// no second implementation).
	baseRows := make([]PositionBaseRow, len(bases))
	knownPositions := make(map[string]bool, len(bases))
	for i, b := range bases {
		baseRows[i] = PositionBaseRow{PositionID: b.pos.ID, TotalWorksAfter: b.worksAfter}
		knownPositions[b.pos.ID] = true
	}
	issues, deltas := ValidatePositionAdjustments(in.PositionAdjustments, baseRows, knownPositions)
	if len(issues) > 0 {
		return nil, &InvalidRedistributionRulesError{Issues: issues}
	}

	insuranceTotal, err := CalculateInsuranceTotal(in.Insurance)
	if err != nil {
		return nil, err
	}

	rows := make([]PreparedPositionRow, 0, len(bases))
	for _, b := range bases {
		quantity := 1.0
		if b.pos.ManualVolume != nil && *b.pos.ManualVolume != 0 {
			quantity = *b.pos.ManualVolume
		} else if b.pos.ClientVolume != nil && *b.pos.ClientVolume != 0 {
			quantity = *b.pos.ClientVolume
		}

		delta := deltas[b.pos.ID]
		afterAdj := b.worksAfter + delta
		posDeducted, posAdded := 0.0, 0.0
		if delta < 0 {
			posDeducted = -delta
		} else {
			posAdded = delta
		}

		// smartRoundResults: 2dp unit price → total = round2(price × qty);
		// a zero total or non-positive quantity rounds to 0 (TS semantics).
		var rMatPrice, rMat, rWorkPrice, rWorks float64
		if b.materials != 0 && quantity > 0 {
			rMatPrice = round2(b.materials / quantity)
			rMat = round2(rMatPrice * quantity)
		}
		if afterAdj != 0 && quantity > 0 {
			rWorkPrice = round2(afterAdj / quantity)
			rWorks = round2(rWorkPrice * quantity)
		}

		rows = append(rows, PreparedPositionRow{
			PositionID:     b.pos.ID,
			PositionNumber: b.pos.PositionNumber,
			SectionNumber:  b.pos.SectionNumber,
			PositionName:   b.pos.PositionName,
			ItemNo:         b.pos.ItemNo,
			WorkName:       b.pos.WorkName,
			ClientVolume:   b.pos.ClientVolume,
			ManualVolume:   b.pos.ManualVolume,
			UnitCode:       b.pos.UnitCode,
			ManualNote:     b.pos.ManualNote,
			IsAdditional:   b.pos.IsAdditional,
			IsLeaf:         b.isLeaf,
			Quantity:       quantity,

			MaterialCost:            b.materials,
			WorkCostBefore:          b.worksBefore,
			CategoryDeducted:        b.categoryDeducted,
			CategoryAdded:           b.categoryAdded,
			WorkCostAfterCategory:   b.worksAfter,
			PositionDeducted:        posDeducted,
			PositionAdded:           posAdded,
			WorkCostAfterAdjustment: afterAdj,

			RoundedMaterialUnitPrice: rMatPrice,
			RoundedMaterialCost:      rMat,
			RoundedWorkUnitPrice:     rWorkPrice,
			RoundingAdjustment:       rWorks - afterAdj,
			WorkCostRounded:          rWorks,
		})
	}

	// Insurance: proportional to the ROUNDED works base (post-rounding).
	// Stage 0.1.2.3b.1 policy: non-zero insurance with a zero eligible base is
	// a BLOCKING typed error — the total can neither be allocated nor silently
	// dropped from the final totals. (zero insurance + zero base stays valid.)
	roundedBase := 0.0
	for _, r := range rows {
		roundedBase += r.WorkCostRounded
	}
	if insuranceTotal > redistributionBalanceTolerance && roundedBase <= redistributionBalanceTolerance {
		return nil, &InvalidInsuranceAllocationError{
			ExpectedTotal:  insuranceTotal,
			AllocatedTotal: 0,
			Reason:         InsuranceZeroBaseReason,
		}
	}
	allocated := 0.0
	for i := range rows {
		share := 0.0
		if insuranceTotal > 0 && roundedBase > 0 {
			share = insuranceTotal * (rows[i].WorkCostRounded / roundedBase)
		}
		rows[i].InsuranceAmount = share
		rows[i].FinalWorkCost = rows[i].WorkCostRounded + share
		if rows[i].Quantity > 0 {
			rows[i].FinalWorkUnitPrice = rows[i].FinalWorkCost / rows[i].Quantity
		}
		rows[i].FinalPositionTotal = rows[i].RoundedMaterialCost + rows[i].FinalWorkCost
		allocated += share
	}

	summary := PreparedSummary{InsuranceTotal: insuranceTotal, InsuranceAllocated: allocated}
	for _, r := range rows {
		summary.TotalMaterialCost += r.RoundedMaterialCost
		summary.WorkTotalBeforeCategory += r.WorkCostBefore
		summary.TotalCategoryDeducted += r.CategoryDeducted
		summary.TotalCategoryAdded += r.CategoryAdded
		summary.WorkTotalAfterCategory += r.WorkCostAfterCategory
		summary.TotalPositionDeducted += r.PositionDeducted
		summary.TotalPositionAdded += r.PositionAdded
		summary.WorkTotalAfterAdjustments += r.WorkCostAfterAdjustment
		summary.RoundingAdjustmentTotal += r.RoundingAdjustment
		summary.WorkTotalRoundedPreInsur += r.WorkCostRounded
		summary.FinalWorkTotal += r.FinalWorkCost
	}
	summary.FinalTotal = summary.TotalMaterialCost + summary.FinalWorkTotal
	summary.IsCategoryBalanced = math.Abs(summary.TotalCategoryDeducted-summary.TotalCategoryAdded) < redistributionBalanceTolerance
	summary.IsInsuranceFullyAllocated = math.Abs(allocated-insuranceTotal) < redistributionBalanceTolerance

	out := &PreparedRedistribution{
		Rows:                  rows,
		Summary:               summary,
		RoundingPolicy:        RoundingPolicyUnitPrice2dp,
		PreparedSchemaVersion: PreparedSchemaVersion,
		CalculationSource:     RedistributionCalculationServer,
	}
	if err := ValidatePreparedRedistribution(out); err != nil {
		return nil, err
	}
	return out, nil
}
