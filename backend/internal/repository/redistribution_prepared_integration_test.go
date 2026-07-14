package repository

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for the stage 0.1.2.3b prepared pipeline
// (SaveAuthoritative → Prepared; LoadResults → the SAME calc boundary).
// Reuses newTestPool / HUBTENDER_TEST_DATABASE_URL; SKIPs without a test DB.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run PreparedRedistribution -v
//
// Fixture arithmetic (rdFixture): раб ×1.5, works base→work; insurance 50.
//
//	w1@p1 (qty10×100) → commercial work 1000; w2@p2 (qty5×100) → work 500
//	rules d1→d2 10%: p1 after 900, p2 after 600
//	adjustment transfer 200 p1→p2: p1 700, p2 800
//	rounding (vol p1=?, p2=?): positions have no volume → quantity 1 → identity
//	insurance 50 over rounded base 1500: p1 +23.3(3), p2 +26.6(6)

// ─── A+B+C+D. Save/GET parity: adjustments + insurance + rounding ────────────

func TestPreparedRedistribution_SaveGetParity(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "prep", nil)
	f.seedTwoItems(t, pool)
	repo := NewRedistributionRepo(pool)

	rules := f.d1toD2Rules()
	rules.PositionAdjustments = []calc.PositionAdjustmentRuleInput{{
		Mode: "transfer", Amount: 200, SourceIDs: []string{f.pos1ID}, TargetIDs: []string{f.pos2ID},
	}}

	out, err := repo.SaveAuthoritative(context.Background(), f.tenderID, f.tacticID, rules, rbActor)
	if err != nil {
		t.Fatalf("save failed: %v", err)
	}
	if out.Prepared == nil {
		t.Fatal("save must return the prepared projection")
	}
	p := out.Prepared
	if p.CalculationSource != "server" || p.PreparedSchemaVersion != 1 {
		t.Fatalf("prepared markers wrong: %+v", p)
	}

	// §22B — position adjustments applied server-side (client sent only rules).
	rowByID := map[string]calc.PreparedPositionRow{}
	for _, r := range p.Rows {
		rowByID[r.PositionID] = r
	}
	p1, p2 := rowByID[f.pos1ID], rowByID[f.pos2ID]
	if p1.WorkCostAfterCategory != 900 || p2.WorkCostAfterCategory != 600 {
		t.Fatalf("category stage wrong: %v / %v", p1.WorkCostAfterCategory, p2.WorkCostAfterCategory)
	}
	if p1.WorkCostAfterAdjustment != 700 || p2.WorkCostAfterAdjustment != 800 {
		t.Fatalf("adjustment stage wrong: %v / %v", p1.WorkCostAfterAdjustment, p2.WorkCostAfterAdjustment)
	}
	// §22C — insurance from the DB (50), allocated proportionally on the server.
	if p.Summary.InsuranceTotal != 50 {
		t.Fatalf("insurance_total = %v, want 50 (from tender_insurance)", p.Summary.InsuranceTotal)
	}
	if !p.Summary.IsInsuranceFullyAllocated {
		t.Fatalf("insurance not fully allocated: %+v", p.Summary)
	}
	if p.Summary.FinalWorkTotal != 1550 { // 1500 works + 50 insurance
		t.Fatalf("final_work_total = %v, want 1550", p.Summary.FinalWorkTotal)
	}

	// §22A/D — a subsequent GET rebuilds the IDENTICAL prepared projection
	// through the same calc boundary; repeat GET is deterministic.
	load1, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load failed: %v", err)
	}
	if load1.Status != RedistributionStatusCalculated || load1.Prepared == nil {
		t.Fatalf("status/prepared = %q/%v", load1.Status, load1.Prepared != nil)
	}
	saveJSON, _ := json.Marshal(out.Prepared)
	get1JSON, _ := json.Marshal(load1.Prepared)
	if string(saveJSON) != string(get1JSON) {
		t.Fatalf("save/GET prepared diverged:\nsave: %s\nget:  %s", saveJSON, get1JSON)
	}
	load2, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("second load failed: %v", err)
	}
	get2JSON, _ := json.Marshal(load2.Prepared)
	if string(get1JSON) != string(get2JSON) {
		t.Fatal("repeat GET is not deterministic")
	}

	// §22H — the response carries everything consumers need (no client math).
	if p1.InsuranceAmount <= 0 || p1.FinalWorkCost != p1.WorkCostRounded+p1.InsuranceAmount {
		t.Fatalf("consumer contract broken: %+v", p1)
	}
	if p1.WorkName == "" || p1.PositionNumber == 0 {
		t.Fatalf("display metadata missing: %+v", p1)
	}
}

// ─── F. Atomic failure: a prepared error after category calc changes NOTHING ─

func TestPreparedRedistribution_InvalidInsuranceRollsBackEverything(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "prep-ins", nil)
	f.seedTwoItems(t, pool)
	repo := NewRedistributionRepo(pool)

	// First: a valid save so an OLD snapshot exists.
	if _, err := repo.SaveAuthoritative(context.Background(), f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor); err != nil {
		t.Fatalf("initial save: %v", err)
	}
	before := readRdRows(t, pool, f.tenderID, f.tacticID)

	// Corrupt the insurance row → the prepared stage fails AFTER category calc.
	if _, err := pool.Exec(context.Background(),
		`UPDATE public.tender_insurance SET judicial_pct = -5 WHERE tender_id = $1::uuid`, f.tenderID); err != nil {
		t.Fatalf("corrupt insurance: %v", err)
	}

	rules := f.d1toD2Rules()
	rules.Deductions[0].Percentage = 20 // a DIFFERENT save attempt
	_, err := repo.SaveAuthoritative(context.Background(), f.tenderID, f.tacticID, rules, rbActor)
	var insErr *calc.InvalidInsuranceConfigurationError
	if !errors.As(err, &insErr) {
		t.Fatalf("want InvalidInsuranceConfigurationError, got %v", err)
	}

	// The OLD snapshot is untouched (10% values, not 20%).
	after := readRdRows(t, pool, f.tenderID, f.tacticID)
	if len(after) != len(before) {
		t.Fatalf("snapshot size changed: %d → %d", len(before), len(after))
	}
	for id, b := range before {
		a := after[id]
		if a.ded != b.ded || a.add != b.add || a.final != b.final {
			t.Fatalf("snapshot row %s changed after failed save: %+v → %+v", id, b, a)
		}
	}
	// GET degrades honestly: the calculated snapshot can no longer build a
	// prepared projection → requires_recalculation, no broken money served.
	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusRequiresRecalculation || load.Prepared != nil {
		t.Fatalf("status/prepared = %q/%v, want requires_recalculation/nil", load.Status, load.Prepared != nil)
	}
}

// ─── G. Legacy snapshot: no prepared rows ────────────────────────────────────

func TestPreparedRedistribution_LegacySnapshotHasNoPrepared(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "prep-legacy", nil)
	f.seedTwoItems(t, pool)

	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.cost_redistribution_results
		  (tender_id, markup_tactic_id, boq_item_id, original_work_cost,
		   deducted_amount, added_amount, final_work_cost, redistribution_rules)
		VALUES ($1::uuid,$2::uuid,$3::uuid, 777, 1, 2, 778,
		        '{"deductions":[],"targets":[]}'::jsonb)`,
		f.tenderID, f.tacticID, f.item1ID); err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}

	repo := NewRedistributionRepo(pool)
	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusRequiresRecalculation {
		t.Fatalf("status = %q", load.Status)
	}
	if load.Prepared != nil {
		t.Fatal("legacy snapshot must not produce authoritative prepared rows")
	}
}

// ─── not_configured: no snapshot at all ──────────────────────────────────────

func TestPreparedRedistribution_NotConfigured(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "prep-none", nil)
	f.seedTwoItems(t, pool)

	repo := NewRedistributionRepo(pool)
	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusNotConfigured || load.Prepared != nil || len(load.Results) != 0 {
		t.Fatalf("want not_configured/empty, got %q (%d rows)", load.Status, len(load.Results))
	}
}
