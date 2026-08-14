package calc

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"testing"
)

// Stage 0.1.2.3b: golden pipeline fixtures (shared with the TS preview parity
// check) + property tests of the prepared projection.

const pipelineEps = 1e-6

type plPosition struct {
	ID               string   `json:"id"`
	Number           float64  `json:"number"`
	Volume           *float64 `json:"volume"`
	ManualVolume     *float64 `json:"manual_volume"`
	IsAdditional     bool     `json:"is_additional"`
	ParentPositionID *string  `json:"parent_position_id"`
	HierarchyLevel   int      `json:"hierarchy_level"`
}

type plItem struct {
	ID           string  `json:"id"`
	PositionID   string  `json:"position_id"`
	MaterialCost float64 `json:"material_cost"`
	WorkCost     float64 `json:"work_cost"`
}

type plResult struct {
	BoqItemID string  `json:"boq_item_id"`
	Original  float64 `json:"original"`
	Deducted  float64 `json:"deducted"`
	Added     float64 `json:"added"`
	Final     float64 `json:"final"`
}

type plExpectedRow struct {
	WorkAfterCategory    *float64 `json:"work_after_category"`
	WorkAfterAdjustments *float64 `json:"work_after_adjustments"`
	WorkRounded          *float64 `json:"work_rounded"`
	Insurance            *float64 `json:"insurance"`
	FinalWork            *float64 `json:"final_work"`
	MaterialRounded      *float64 `json:"material_rounded"`
	FinalTotal           *float64 `json:"final_total"`
}

type plCase struct {
	Name                string                        `json:"name"`
	Positions           []plPosition                  `json:"positions"`
	BoqItems            []plItem                      `json:"boq_items"`
	CategoryResults     []plResult                    `json:"category_results"`
	PositionAdjustments []PositionAdjustmentRuleInput `json:"position_adjustments"`
	Insurance           *InsuranceInput               `json:"-"`
	InsuranceRaw        *insuranceJSON                `json:"insurance"`
	ExpectError         string                        `json:"expect_error"`
	Expected            *struct {
		RowOrder []string                 `json:"row_order"`
		Rows     map[string]plExpectedRow `json:"rows"`
		Summary  map[string]float64       `json:"summary"`
	} `json:"expected"`
}

type insuranceJSON struct {
	AptPriceM2     float64 `json:"apt_price_m2"`
	AptArea        float64 `json:"apt_area"`
	ParkingPriceM2 float64 `json:"parking_price_m2"`
	ParkingArea    float64 `json:"parking_area"`
	StoragePriceM2 float64 `json:"storage_price_m2"`
	StorageArea    float64 `json:"storage_area"`
	JudicialPct    float64 `json:"judicial_pct"`
	TotalPct       float64 `json:"total_pct"`
}

func loadPipelineCases(t *testing.T) []plCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/redistribution_pipeline_cases.json")
	if err != nil {
		t.Fatalf("read pipeline fixtures: %v", err)
	}
	var f struct {
		Cases []plCase `json:"cases"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("parse pipeline fixtures: %v", err)
	}
	if len(f.Cases) < 15 {
		t.Fatalf("pipeline fixtures must keep >= 15 cases, got %d", len(f.Cases))
	}
	return f.Cases
}

func (c plCase) toInput() PreparedRedistributionInput {
	in := PreparedRedistributionInput{PositionAdjustments: c.PositionAdjustments}
	for _, p := range c.Positions {
		in.Positions = append(in.Positions, PreparedPositionInput{
			ID: p.ID, PositionNumber: p.Number, WorkName: "w-" + p.ID, PositionName: "n-" + p.ID,
			UnitCode: "м2", ClientVolume: p.Volume, ManualVolume: p.ManualVolume,
			IsAdditional: p.IsAdditional, ParentPositionID: p.ParentPositionID,
			HierarchyLevel: p.HierarchyLevel,
		})
	}
	for _, it := range c.BoqItems {
		in.BoqItems = append(in.BoqItems, BoqItemWithCosts{
			ID: it.ID, ClientPositionID: it.PositionID, BoqItemType: BoqRab,
			TotalCommercialMaterialCost: it.MaterialCost, TotalCommercialWorkCost: it.WorkCost,
		})
	}
	for _, r := range c.CategoryResults {
		in.CategoryResults = append(in.CategoryResults, RedistributionResult{
			BoqItemID: r.BoqItemID, OriginalWorkCost: r.Original,
			DeductedAmount: r.Deducted, AddedAmount: r.Added, FinalWorkCost: r.Final,
		})
	}
	if c.InsuranceRaw != nil {
		in.Insurance = &InsuranceInput{
			AptPriceM2: c.InsuranceRaw.AptPriceM2, AptArea: c.InsuranceRaw.AptArea,
			ParkingPriceM2: c.InsuranceRaw.ParkingPriceM2, ParkingArea: c.InsuranceRaw.ParkingArea,
			StoragePriceM2: c.InsuranceRaw.StoragePriceM2, StorageArea: c.InsuranceRaw.StorageArea,
			JudicialPct: c.InsuranceRaw.JudicialPct, TotalPct: c.InsuranceRaw.TotalPct,
		}
	}
	return in
}

func nearEps(a, b float64) bool { return math.Abs(a-b) <= pipelineEps }

func TestPreparedRedistributionGolden(t *testing.T) {
	for _, tc := range loadPipelineCases(t) {
		t.Run(tc.Name, func(t *testing.T) {
			out, err := BuildPreparedRedistribution(tc.toInput())

			if tc.ExpectError != "" {
				switch tc.ExpectError {
				case InsuranceZeroBaseReason:
					var insErr *InvalidInsuranceAllocationError
					if !errors.As(err, &insErr) || insErr.Reason != InsuranceZeroBaseReason {
						t.Fatalf("want InvalidInsuranceAllocationError(%s), got %v", tc.ExpectError, err)
					}
				default:
					var rulesErr *InvalidRedistributionRulesError
					if !errors.As(err, &rulesErr) {
						t.Fatalf("want InvalidRedistributionRulesError(%s), got %v", tc.ExpectError, err)
					}
					found := false
					for _, is := range rulesErr.Issues {
						if is.Code == tc.ExpectError {
							found = true
						}
					}
					if !found {
						t.Fatalf("issues %v do not contain %s", rulesErr.Issues, tc.ExpectError)
					}
				}
				return
			}
			if err != nil {
				t.Fatalf("pipeline failed: %v", err)
			}

			rowByID := map[string]PreparedPositionRow{}
			var order []string
			for _, r := range out.Rows {
				rowByID[r.PositionID] = r
				order = append(order, r.PositionID)
			}
			if tc.Expected.RowOrder != nil {
				if len(order) != len(tc.Expected.RowOrder) {
					t.Fatalf("row order = %v, want %v", order, tc.Expected.RowOrder)
				}
				for i := range order {
					if order[i] != tc.Expected.RowOrder[i] {
						t.Fatalf("row order = %v, want %v", order, tc.Expected.RowOrder)
					}
				}
			}
			for id, want := range tc.Expected.Rows {
				got, ok := rowByID[id]
				if !ok {
					t.Fatalf("row %s missing", id)
				}
				check := func(name string, want *float64, got float64) {
					if want != nil && !nearEps(*want, got) {
						t.Errorf("%s.%s = %v, want %v", id, name, got, *want)
					}
				}
				check("work_after_category", want.WorkAfterCategory, got.WorkCostAfterCategory)
				check("work_after_adjustments", want.WorkAfterAdjustments, got.WorkCostAfterAdjustment)
				check("work_rounded", want.WorkRounded, got.WorkCostRounded)
				check("insurance", want.Insurance, got.InsuranceAmount)
				check("final_work", want.FinalWork, got.FinalWorkCost)
				check("material_rounded", want.MaterialRounded, got.RoundedMaterialCost)
				check("final_total", want.FinalTotal, got.FinalPositionTotal)
			}
			sum := map[string]float64{
				"total_material_cost":          out.Summary.TotalMaterialCost,
				"work_total_before_category":   out.Summary.WorkTotalBeforeCategory,
				"total_category_deducted":      out.Summary.TotalCategoryDeducted,
				"total_category_added":         out.Summary.TotalCategoryAdded,
				"total_position_deducted":      out.Summary.TotalPositionDeducted,
				"total_position_added":         out.Summary.TotalPositionAdded,
				"work_total_after_adjustments": out.Summary.WorkTotalAfterAdjustments,
				"rounding_adjustment_total":    out.Summary.RoundingAdjustmentTotal,
				"insurance_total":              out.Summary.InsuranceTotal,
				"insurance_allocated":          out.Summary.InsuranceAllocated,
				"final_work_total":             out.Summary.FinalWorkTotal,
				"final_total":                  out.Summary.FinalTotal,
			}
			for k, want := range tc.Expected.Summary {
				if !nearEps(sum[k], want) {
					t.Errorf("summary.%s = %v, want %v", k, sum[k], want)
				}
			}
			if out.CalculationSource != RedistributionCalculationServer ||
				out.PreparedSchemaVersion != PreparedSchemaVersion ||
				out.RoundingPolicy != RoundingPolicyUnitPrice2dp {
				t.Fatalf("markers wrong: %+v", out)
			}
		})
	}
}

// ─── property tests (§20) ────────────────────────────────────────────────────

// deterministic pseudo-random inputs (fixed seed via simple LCG — no rand pkg).
func lcg(seed *uint64) float64 {
	*seed = *seed*6364136223846793005 + 1442695040888963407
	return float64((*seed>>33)%1_000_000) / 100.0 // 0 .. 10000.00
}

func propInput(seed uint64, n int) PreparedRedistributionInput {
	in := PreparedRedistributionInput{}
	for i := 0; i < n; i++ {
		id := string(rune('a'+i%26)) + string(rune('0'+i/26))
		vol := 1 + lcg(&seed)/100
		in.Positions = append(in.Positions, PreparedPositionInput{
			ID: "p-" + id, PositionNumber: float64(i + 1), WorkName: "w", UnitCode: "м2", ClientVolume: &vol,
		})
		work := lcg(&seed)
		mat := lcg(&seed)
		in.BoqItems = append(in.BoqItems, BoqItemWithCosts{
			ID: "b-" + id, ClientPositionID: "p-" + id, BoqItemType: BoqRab,
			TotalCommercialWorkCost: work, TotalCommercialMaterialCost: mat,
		})
		in.CategoryResults = append(in.CategoryResults, RedistributionResult{
			BoqItemID: "b-" + id, OriginalWorkCost: work, FinalWorkCost: work,
		})
	}
	return in
}

// §20.1/2/5 — a transfer preserves the works total; insurance allocation
// preserves the insurance total; the whole projection is deterministic.
func TestPreparedProperties_TransferAndInsuranceConserveTotals(t *testing.T) {
	for seed := uint64(1); seed <= 20; seed++ {
		in := propInput(seed*97, 8)
		in.PositionAdjustments = []PositionAdjustmentRuleInput{{
			Mode: "transfer", Amount: 1, // tiny — always within any positive source
			SourceIDs: []string{in.Positions[0].ID}, TargetIDs: []string{in.Positions[1].ID},
		}}
		if in.BoqItems[0].TotalCommercialWorkCost < 2 {
			in.BoqItems[0].TotalCommercialWorkCost += 10
			in.CategoryResults[0].OriginalWorkCost += 10
			in.CategoryResults[0].FinalWorkCost += 10
		}
		in.Insurance = &InsuranceInput{AptPriceM2: 100, AptArea: 10, JudicialPct: 50, TotalPct: 100} // 500

		out1, err := BuildPreparedRedistribution(in)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		out2, err := BuildPreparedRedistribution(in)
		if err != nil {
			t.Fatalf("seed %d rerun: %v", seed, err)
		}
		// §20.5 — identical rerun.
		b1, _ := json.Marshal(out1)
		b2, _ := json.Marshal(out2)
		if string(b1) != string(b2) {
			t.Fatalf("seed %d: non-deterministic output", seed)
		}
		// Transfer preserves the pre-rounding works total.
		if !near(out1.Summary.WorkTotalAfterAdjustments, out1.Summary.WorkTotalAfterCategory) {
			t.Fatalf("seed %d: transfer changed the works total", seed)
		}
		// Insurance conserved (base > 0 here).
		if out1.Summary.WorkTotalRoundedPreInsur > 0 &&
			math.Abs(out1.Summary.InsuranceAllocated-out1.Summary.InsuranceTotal) > 0.01 {
			t.Fatalf("seed %d: insurance lost money: %v vs %v", seed,
				out1.Summary.InsuranceAllocated, out1.Summary.InsuranceTotal)
		}
		// §20.7/8 — non-negative rows; summary == Σ rows (validator ran inside,
		// but assert the outputs are finite & non-negative explicitly).
		for _, r := range out1.Rows {
			if r.FinalWorkCost < 0 || r.FinalPositionTotal < 0 ||
				math.IsNaN(r.FinalWorkCost) || math.IsInf(r.FinalWorkCost, 0) {
				t.Fatalf("seed %d: bad row %+v", seed, r)
			}
		}
	}
}

// §20.4 — permuting BOQ/result input order does not change the result by ID.
func TestPreparedProperties_InputOrderIrrelevant(t *testing.T) {
	in := propInput(42, 10)
	out1, err := BuildPreparedRedistribution(in)
	if err != nil {
		t.Fatal(err)
	}
	// reverse items + results
	rev := in
	rev.BoqItems = make([]BoqItemWithCosts, len(in.BoqItems))
	rev.CategoryResults = make([]RedistributionResult, len(in.CategoryResults))
	for i := range in.BoqItems {
		rev.BoqItems[len(in.BoqItems)-1-i] = in.BoqItems[i]
		rev.CategoryResults[len(in.CategoryResults)-1-i] = in.CategoryResults[i]
	}
	out2, err := BuildPreparedRedistribution(rev)
	if err != nil {
		t.Fatal(err)
	}
	b1, _ := json.Marshal(out1)
	b2, _ := json.Marshal(out2)
	if string(b1) != string(b2) {
		t.Fatal("input order changed the prepared output")
	}
}

// §20.9/10 — duplicates and NaN inputs are typed errors, never a panic.
func TestPreparedProperties_BadInputsTypedErrors(t *testing.T) {
	in := propInput(7, 3)
	in.CategoryResults = append(in.CategoryResults, in.CategoryResults[0]) // duplicate
	var inErr *InvalidPreparedRedistributionInputError
	if _, err := BuildPreparedRedistribution(in); !errors.As(err, &inErr) {
		t.Fatalf("duplicate result must be a typed input error, got %v", err)
	}

	// Stage 0.1.2.3b.1: an unknown result ID is an exact-set violation (extra
	// row) — typed set mismatch, not a silent ignore.
	in2 := propInput(8, 3)
	in2.CategoryResults[0].BoqItemID = "ghost"
	var setErr *RedistributionSnapshotSetMismatchError
	if _, err := BuildPreparedRedistribution(in2); !errors.As(err, &setErr) {
		t.Fatalf("unknown result must be a typed set mismatch, got %v", err)
	}
	if len(setErr.MissingItemIDs) != 1 || len(setErr.ExtraItemIDs) != 1 {
		t.Fatalf("set mismatch details wrong: %+v", setErr)
	}

	in3 := propInput(9, 3)
	in3.Insurance = &InsuranceInput{AptPriceM2: math.NaN()}
	var insErr *InvalidInsuranceConfigurationError
	if _, err := BuildPreparedRedistribution(in3); !errors.As(err, &insErr) {
		t.Fatalf("NaN insurance must be a typed config error, got %v", err)
	}
	in4 := propInput(10, 3)
	in4.Insurance = &InsuranceInput{AptPriceM2: 10, AptArea: 10, JudicialPct: 150, TotalPct: 100}
	if _, err := BuildPreparedRedistribution(in4); !errors.As(err, &insErr) {
		t.Fatalf("pct>100 must be a typed config error, got %v", err)
	}
}

// Empty inputs: no positions → empty rows/summary (no-op, no panic).
func TestPreparedProperties_EmptyInput(t *testing.T) {
	out, err := BuildPreparedRedistribution(PreparedRedistributionInput{})
	if err != nil {
		t.Fatalf("empty input must be a no-op, got %v", err)
	}
	if len(out.Rows) != 0 || out.Summary.FinalTotal != 0 {
		t.Fatalf("empty input produced money: %+v", out)
	}
}

// ─── Stage 0.1.2.3b.1 (§11): exact-set fail-closed ────────────────────────────

// §11.2/7/8/9/12 — a missing expected result (work, material or zero-cost row)
// is a typed set mismatch; no pass-through, no partial summary.
func TestPreparedExactSet_MissingResultBlocks(t *testing.T) {
	vol := 1.0
	base := PreparedRedistributionInput{
		Positions: []PreparedPositionInput{
			{ID: "p1", PositionNumber: 1, WorkName: "w", UnitCode: "м2", ClientVolume: &vol},
		},
		BoqItems: []BoqItemWithCosts{
			{ID: "work", ClientPositionID: "p1", BoqItemType: BoqRab, TotalCommercialWorkCost: 100},
			{ID: "mat", ClientPositionID: "p1", BoqItemType: BoqMat, TotalCommercialMaterialCost: 50},
			{ID: "zero", ClientPositionID: "p1", BoqItemType: BoqRab},
		},
	}
	full := []RedistributionResult{
		{BoqItemID: "work", OriginalWorkCost: 100, FinalWorkCost: 100},
		{BoqItemID: "mat"},
		{BoqItemID: "zero"},
	}
	// Full set passes.
	in := base
	in.CategoryResults = full
	if _, err := BuildPreparedRedistribution(in); err != nil {
		t.Fatalf("full set must pass: %v", err)
	}
	// Dropping ANY expected row (work / material / zero-cost) blocks.
	for drop := 0; drop < len(full); drop++ {
		in := base
		in.CategoryResults = append(append([]RedistributionResult{}, full[:drop]...), full[drop+1:]...)
		out, err := BuildPreparedRedistribution(in)
		var setErr *RedistributionSnapshotSetMismatchError
		if !errors.As(err, &setErr) {
			t.Fatalf("drop %s: want set mismatch, got %v", full[drop].BoqItemID, err)
		}
		if out != nil {
			t.Fatalf("drop %s: partial summary returned", full[drop].BoqItemID)
		}
		if setErr.ExpectedCount != 3 || setErr.ActualCount != 2 || len(setErr.MissingItemIDs) != 1 {
			t.Fatalf("drop %s: mismatch details wrong: %+v", full[drop].BoqItemID, setErr)
		}
	}
	// §11.3 — an extra row blocks too.
	in2 := base
	in2.CategoryResults = append(append([]RedistributionResult{}, full...), RedistributionResult{BoqItemID: "alien"})
	var setErr *RedistributionSnapshotSetMismatchError
	if _, err := BuildPreparedRedistribution(in2); !errors.As(err, &setErr) {
		t.Fatalf("extra row must be a set mismatch, got %v", err)
	}
	if len(setErr.ExtraItemIDs) != 1 || setErr.ExtraItemIDs[0] != "alien" {
		t.Fatalf("extra ids wrong: %+v", setErr)
	}
}

// §11.11 — the exact-set classification is ONE shared helper.
func TestPreparedExactSet_SharedHelper(t *testing.T) {
	items := []BoqItemWithCosts{
		{ID: "a", ClientPositionID: "p", BoqItemType: BoqRab},
		{ID: "b", ClientPositionID: "p", BoqItemType: BoqMat},
	}
	expected := ExpectedRedistributionBoqItems(items)
	if len(expected) != 2 || !expected["a"] || !expected["b"] {
		t.Fatalf("expected set wrong: %v", expected)
	}
}

// ─── Stage 0.1.2.3b.1 (§12): additional (ДОП) positions ──────────────────────

func additionalInput(withParent bool, withItems bool, itemCost float64) PreparedRedistributionInput {
	vol := 1.0
	var parent *string
	if withParent {
		p := "p1"
		parent = &p
	}
	in := PreparedRedistributionInput{
		Positions: []PreparedPositionInput{
			{ID: "p1", PositionNumber: 1, WorkName: "w", UnitCode: "м2", ClientVolume: &vol},
			{ID: "add1", PositionNumber: 2, WorkName: "add", UnitCode: "м2", ClientVolume: &vol,
				IsAdditional: true, ParentPositionID: parent},
		},
		BoqItems: []BoqItemWithCosts{
			{ID: "b1", ClientPositionID: "p1", BoqItemType: BoqRab, TotalCommercialWorkCost: 100},
		},
		CategoryResults: []RedistributionResult{
			{BoqItemID: "b1", OriginalWorkCost: 100, FinalWorkCost: 100},
		},
	}
	if withItems {
		in.BoqItems = append(in.BoqItems, BoqItemWithCosts{
			ID: "badd", ClientPositionID: "add1", BoqItemType: BoqRab, TotalCommercialWorkCost: itemCost,
		})
		in.CategoryResults = append(in.CategoryResults, RedistributionResult{
			BoqItemID: "badd", OriginalWorkCost: itemCost, FinalWorkCost: itemCost,
		})
	}
	return in
}

// §12.1 — additional cost-bearing row with a valid parent is included.
func TestAdditionalPosition_WithParentIncluded(t *testing.T) {
	out, err := BuildPreparedRedistribution(additionalInput(true, true, 200))
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	if len(out.Rows) != 2 {
		t.Fatalf("rows = %d, want 2 (parent + additional)", len(out.Rows))
	}
	if out.Summary.FinalWorkTotal != 300 {
		t.Fatalf("final work total = %v, want 300 (100 + 200)", out.Summary.FinalWorkTotal)
	}
}

// ДОП-позиции нумеруются с десятичным суффиксом (2.1) — public.client_positions
// .position_number is numeric, not integer. PositionNumber must therefore stay
// float64: an int field both fails the pgx scan in loadPreparedPositions and
// would collapse 2.1 onto the parent's number 2 in the UI/Excel export.
func TestAdditionalPosition_FractionalNumberPreserved(t *testing.T) {
	in := additionalInput(true, true, 200)
	in.Positions[1].PositionNumber = 2.1

	out, err := BuildPreparedRedistribution(in)
	if err != nil {
		t.Fatalf("unexpected: %v", err)
	}
	var got float64
	for _, r := range out.Rows {
		if r.PositionID == "add1" {
			got = r.PositionNumber
		}
	}
	if got != 2.1 {
		t.Fatalf("position_number = %v, want 2.1 (не усечён до int)", got)
	}
}

// §12.2/3 — a cost-bearing additional position WITHOUT a parent blocks the
// projection (typed error) — the money never silently disappears.
func TestAdditionalPosition_ParentMissingBlocks(t *testing.T) {
	_, err := BuildPreparedRedistribution(additionalInput(false, true, 200))
	var inErr *InvalidPreparedRedistributionInputError
	if !errors.As(err, &inErr) {
		t.Fatalf("want InvalidPreparedRedistributionInputError, got %v", err)
	}
	if inErr.Reason != AdditionalPositionParentMissingReason || inErr.EntityID != "add1" {
		t.Fatalf("wrong error: %+v", inErr)
	}
}

// §12.4 — a zero-cost additional row WITH items still blocks without a parent
// (it is part of the expected set); an EMPTY additional position (no BOQ
// items — zero financial base by construction) may be dropped.
func TestAdditionalPosition_ZeroCostAndEmpty(t *testing.T) {
	_, err := BuildPreparedRedistribution(additionalInput(false, true, 0))
	var inErr *InvalidPreparedRedistributionInputError
	if !errors.As(err, &inErr) {
		t.Fatalf("zero-cost with items must still block, got %v", err)
	}
	out, err := BuildPreparedRedistribution(additionalInput(false, false, 0))
	if err != nil {
		t.Fatalf("empty additional must not block: %v", err)
	}
	if len(out.Rows) != 1 || out.Summary.FinalWorkTotal != 100 {
		t.Fatalf("rows/total = %d/%v, want 1/100", len(out.Rows), out.Summary.FinalWorkTotal)
	}
}

// §12 — additional whose parent is ANOTHER additional (not a regular) — the
// same blocking policy for cost-bearing rows.
func TestAdditionalPosition_AdditionalParentBlocks(t *testing.T) {
	in := additionalInput(true, true, 200)
	in.Positions[0].IsAdditional = true
	pp := "ghost-parent"
	in.Positions[0].ParentPositionID = &pp
	_, err := BuildPreparedRedistribution(in)
	var inErr *InvalidPreparedRedistributionInputError
	if !errors.As(err, &inErr) {
		t.Fatalf("additional-parent chain must block cost-bearing rows, got %v", err)
	}
}

// ─── Stage 0.1.2.3b.1 (§13): insurance zero-base policy ──────────────────────

func TestInsurancePolicy_ZeroBase(t *testing.T) {
	vol := 1.0
	base := PreparedRedistributionInput{
		Positions: []PreparedPositionInput{
			{ID: "p1", PositionNumber: 1, WorkName: "w", UnitCode: "м2", ClientVolume: &vol},
		},
		BoqItems: []BoqItemWithCosts{
			{ID: "b1", ClientPositionID: "p1", BoqItemType: BoqMat, TotalCommercialMaterialCost: 500},
		},
		CategoryResults: []RedistributionResult{{BoqItemID: "b1"}},
	}

	// §13.1 — zero insurance + zero base → success.
	in := base
	if out, err := BuildPreparedRedistribution(in); err != nil || out.Summary.InsuranceTotal != 0 {
		t.Fatalf("zero+zero must pass: %v", err)
	}

	// §13.2/7 — non-zero insurance + zero base → typed error; never a
	// "calculated" result with lost insurance.
	in2 := base
	in2.Insurance = &InsuranceInput{AptPriceM2: 10, AptArea: 10, JudicialPct: 50, TotalPct: 100} // 50
	out, err := BuildPreparedRedistribution(in2)
	var allocErr *InvalidInsuranceAllocationError
	if !errors.As(err, &allocErr) || allocErr.Reason != InsuranceZeroBaseReason {
		t.Fatalf("want InvalidInsuranceAllocationError(%s), got %v", InsuranceZeroBaseReason, err)
	}
	if out != nil {
		t.Fatal("partial prepared returned with unallocated insurance")
	}
	if allocErr.ExpectedTotal != 50 || allocErr.AllocatedTotal != 0 {
		t.Fatalf("error fields wrong: %+v", allocErr)
	}
}
