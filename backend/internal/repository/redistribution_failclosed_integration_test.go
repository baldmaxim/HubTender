package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for stage 0.1.2.3b.1 fail-closed prepared
// states. Reuses newTestPool / HUBTENDER_TEST_DATABASE_URL; SKIPs without a
// test DB.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run FailClosedRedistribution -v

// saveValidSnapshot performs a production save and returns the snapshot rows.
func saveValidSnapshot(t *testing.T, repo *RedistributionRepo, f *rdFixture) map[string]rdRow {
	t.Helper()
	if _, err := repo.SaveAuthoritative(context.Background(), f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor); err != nil {
		t.Fatalf("initial save: %v", err)
	}
	pool := repo.pool
	return readRdRows(t, pool, f.tenderID, f.tacticID)
}

// ─── A. Partial snapshot: a manually deleted row is NOT passed through ───────

func TestFailClosedRedistribution_PartialSnapshot(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "fc-partial", nil)
	f.seedTwoItems(t, pool)
	repo := NewRedistributionRepo(pool)
	saveValidSnapshot(t, repo, f)

	// Удаляем одну snapshot-строку (не holder — rules должны остаться).
	if _, err := pool.Exec(context.Background(), `
		DELETE FROM public.cost_redistribution_results
		WHERE tender_id=$1::uuid AND boq_item_id=$2::uuid AND redistribution_rules IS NULL`,
		f.tenderID, f.item2ID); err != nil {
		t.Fatalf("delete row: %v", err)
	}
	// Если item2 оказался holder'ом — удаляем item1 вместо него.
	rows := readRdRows(t, pool, f.tenderID, f.tacticID)
	if len(rows) == 2 {
		if _, err := pool.Exec(context.Background(), `
			DELETE FROM public.cost_redistribution_results
			WHERE tender_id=$1::uuid AND boq_item_id=$2::uuid AND redistribution_rules IS NULL`,
			f.tenderID, f.item1ID); err != nil {
			t.Fatalf("delete alt row: %v", err)
		}
	}

	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusRequiresRecalculation {
		t.Fatalf("status = %q, want requires_recalculation", load.Status)
	}
	if load.Reason != RedistributionReasonSetMismatch {
		t.Fatalf("reason = %q, want SNAPSHOT_SET_MISMATCH", load.Reason)
	}
	if load.Prepared != nil {
		t.Fatal("prepared must be nil for a partial snapshot (no pass-through)")
	}
}

// ─── B. Extra snapshot row → requires_recalculation ──────────────────────────

func TestFailClosedRedistribution_ExtraSnapshotRow(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "fc-extra", nil)
	f.seedTwoItems(t, pool)
	other := seedRedistributionFixture(t, pool, "fc-extra2", nil)
	other.seedTwoItems(t, pool)
	repo := NewRedistributionRepo(pool)
	saveValidSnapshot(t, repo, f)

	// Чужая строка в снимке тендера f (item другого тендера).
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.cost_redistribution_results
		  (tender_id, markup_tactic_id, boq_item_id, deducted_amount, added_amount)
		VALUES ($1::uuid,$2::uuid,$3::uuid, 0, 0)`,
		f.tenderID, f.tacticID, other.item1ID); err != nil {
		t.Fatalf("insert extra row: %v", err)
	}

	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusRequiresRecalculation ||
		load.Reason != RedistributionReasonSetMismatch || load.Prepared != nil {
		t.Fatalf("status/reason/prepared = %q/%q/%v", load.Status, load.Reason, load.Prepared != nil)
	}
}

// ─── C. BOQ changed after save → requires_recalculation, no substitution ─────

func TestFailClosedRedistribution_BoqChangedAfterSave(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "fc-boq", nil)
	f.seedTwoItems(t, pool)
	repo := NewRedistributionRepo(pool)
	saveValidSnapshot(t, repo, f)

	// Новая expected BOQ-строка ПОСЛЕ save.
	newID := f.addRdItem(t, pool, f.pos1ID, f.detail1ID, "RUB", 3, 100)

	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusRequiresRecalculation ||
		load.Reason != RedistributionReasonSetMismatch {
		t.Fatalf("status/reason = %q/%q, want requires_recalculation/SNAPSHOT_SET_MISMATCH", load.Status, load.Reason)
	}
	if load.Prepared != nil {
		t.Fatalf("prepared must be nil — new row %s must NOT be substituted from current commercial values", newID)
	}
}

// ─── D. Non-zero insurance + zero eligible base: SAVE rollback ────────────────

func TestFailClosedRedistribution_ZeroBaseInsuranceSaveRollback(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "fc-insur", nil)
	// Только материалы: commercial works = 0 при ненулевом insurance (50).
	var matID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, material_type, quantity, unit_rate,
		   currency_type, delivery_price_type, detail_cost_category_id)
		VALUES ($1::uuid,$2::uuid,'мат','основн.',10,100,'RUB','в цене',$3::uuid)
		RETURNING id::text`, f.pos1ID, f.tenderID, f.detail1ID).Scan(&matID); err != nil {
		t.Fatalf("seed mat item: %v", err)
	}
	f.item1ID = matID

	repo := NewRedistributionRepo(pool)
	rules := calc.RedistributionRulesInput{
		PositionAdjustments: []calc.PositionAdjustmentRuleInput{{
			Mode: "add", Amount: 1, TargetIDs: []string{f.pos1ID},
		}},
	}
	_, err := repo.SaveAuthoritative(context.Background(), f.tenderID, f.tacticID, rules, rbActor)
	var allocErr *calc.InvalidInsuranceAllocationError
	if !errors.As(err, &allocErr) || allocErr.Reason != calc.InsuranceZeroBaseReason {
		t.Fatalf("want InvalidInsuranceAllocationError(%s), got %v", calc.InsuranceZeroBaseReason, err)
	}
	// Rollback: snapshot не создан.
	if rows := readRdRows(t, pool, f.tenderID, f.tacticID); len(rows) != 0 {
		t.Fatalf("snapshot rows created despite rollback: %d", len(rows))
	}
	// GET не возвращает calculated partial output.
	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil || load.Status != RedistributionStatusNotConfigured {
		t.Fatalf("status = %q err=%v, want not_configured", load.Status, err)
	}
}

// ─── E. Additional cost-bearing position: included or typed error ─────────────

func TestFailClosedRedistribution_AdditionalCostBearingPosition(t *testing.T) {
	pool := newTestPool(t)
	f := seedRedistributionFixture(t, pool, "fc-add", nil)
	f.seedTwoItems(t, pool)

	// ДОП-позиция С родителем и стоимостью — обязана войти в prepared summary.
	var addPosID string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.client_positions
		  (tender_id, position_number, work_name, is_additional, parent_position_id)
		VALUES ($1::uuid, 3, 'itest-fc-add', true, $2::uuid) RETURNING id::text`,
		f.tenderID, f.pos1ID).Scan(&addPosID); err != nil {
		t.Fatalf("seed additional position: %v", err)
	}
	f.addRdItem(t, pool, addPosID, f.detail2ID, "RUB", 2, 100) // base 200 → work 200

	repo := NewRedistributionRepo(pool)
	out, err := repo.SaveAuthoritative(context.Background(), f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	found := false
	for _, r := range out.Prepared.Rows {
		if r.PositionID == addPosID {
			found = true
			if r.FinalWorkCost <= 0 {
				t.Fatalf("additional row lost its cost: %+v", r)
			}
		}
	}
	if !found {
		t.Fatal("cost-bearing additional position missing from prepared rows")
	}

	// Ломаем связь с родителем → cost-bearing ДОП без родителя блокирует GET
	// (typed error → честная деградация, деньги не исчезают молча).
	if _, err := pool.Exec(context.Background(),
		`UPDATE public.client_positions SET parent_position_id = NULL WHERE id=$1::uuid`, addPosID); err != nil {
		t.Fatalf("orphan additional: %v", err)
	}
	load, err := repo.LoadResults(context.Background(), f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusRequiresRecalculation ||
		load.Reason != RedistributionReasonInputChanged || load.Prepared != nil {
		t.Fatalf("status/reason/prepared = %q/%q/%v, want requires_recalculation/PREPARED_INPUT_CHANGED/nil",
			load.Status, load.Reason, load.Prepared != nil)
	}
}

// ─── F. Status consumer contract: distinguishable states ─────────────────────

func TestFailClosedRedistribution_StatusContract(t *testing.T) {
	pool := newTestPool(t)
	repo := NewRedistributionRepo(pool)

	// not_configured
	f1 := seedRedistributionFixture(t, pool, "fc-st1", nil)
	f1.seedTwoItems(t, pool)
	l1, err := repo.LoadResults(context.Background(), f1.tenderID, f1.tacticID)
	if err != nil || l1.Status != RedistributionStatusNotConfigured || l1.Reason != "" || l1.Prepared != nil {
		t.Fatalf("not_configured contract broken: %+v err=%v", l1, err)
	}

	// calculated
	f2 := seedRedistributionFixture(t, pool, "fc-st2", nil)
	f2.seedTwoItems(t, pool)
	saveValidSnapshot(t, repo, f2)
	l2, err := repo.LoadResults(context.Background(), f2.tenderID, f2.tacticID)
	if err != nil || l2.Status != RedistributionStatusCalculated || l2.Reason != "" || l2.Prepared == nil {
		t.Fatalf("calculated contract broken: status=%q reason=%q err=%v", l2.Status, l2.Reason, err)
	}

	// requires_recalculation (legacy)
	f3 := seedRedistributionFixture(t, pool, "fc-st3", nil)
	f3.seedTwoItems(t, pool)
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.cost_redistribution_results
		  (tender_id, markup_tactic_id, boq_item_id, deducted_amount, added_amount, redistribution_rules)
		VALUES ($1::uuid,$2::uuid,$3::uuid, 1, 2, '{"deductions":[],"targets":[]}'::jsonb)`,
		f3.tenderID, f3.tacticID, f3.item1ID); err != nil {
		t.Fatalf("seed legacy: %v", err)
	}
	l3, err := repo.LoadResults(context.Background(), f3.tenderID, f3.tacticID)
	if err != nil || l3.Status != RedistributionStatusRequiresRecalculation ||
		l3.Reason != RedistributionReasonLegacySnapshot || l3.Prepared != nil {
		t.Fatalf("legacy contract broken: status=%q reason=%q err=%v", l3.Status, l3.Reason, err)
	}
	if l3.Message == "" {
		t.Fatal("legacy message missing")
	}
}
