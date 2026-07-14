package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for the authoritative BOQ copy path.
// Reuses the existing convention + production-DSN guard (newTestPool /
// HUBTENDER_TEST_DATABASE_URL); SKIPs when no test DB is configured.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run CopyIntegration -v

type copyFixture struct {
	tenderID   string
	srcPosID   string
	dstPosID   string
	srcItemIDs []string
}

// seedCopyTender creates a tender with a source and a target position.
// usdRate may be nil (⇒ no USD rate configured).
func seedCopyTender(t *testing.T, pool *pgxpool.Pool, tag string, usdRate *float64) *copyFixture {
	t.Helper()
	ctx := context.Background()
	f := &copyFixture{}

	must := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("fixture exec: %v\nSQL: %s", err, q)
		}
	}
	scan := func(dst *string, q string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			t.Fatalf("fixture query: %v\nSQL: %s", err, q)
		}
	}

	scan(&f.tenderID, `INSERT INTO public.tenders (title, client_name, tender_number, usd_rate)
	                   VALUES ($1,'itest-client',$2,$3) RETURNING id::text`,
		"itest-copy-"+tag, "ITEST-CP-"+tag, usdRate)
	scan(&f.srcPosID, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
	                   VALUES ($1::uuid, 1, 'src') RETURNING id::text`, f.tenderID)
	scan(&f.dstPosID, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
	                   VALUES ($1::uuid, 2, 'dst') RETURNING id::text`, f.tenderID)

	t.Cleanup(func() {
		must(`DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.client_positions WHERE tender_id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.tenders WHERE id = $1::uuid`, f.tenderID)
	})
	return f
}

// addSrcItem inserts a source BOQ row with DELIBERATELY CORRUPTED derived values.
func (f *copyFixture) addSrcItem(
	t *testing.T, pool *pgxpool.Pool,
	itemType, currency string, qty, rate float64, consumption *float64, parentID *string,
) string {
	t.Helper()
	workNameID, matNameID := ensureTestNames(t, pool)
	var workRef, matRef *string
	if calc.IsWorkBoqType(itemType) {
		workRef = &workNameID
	} else {
		matRef = &matNameID
	}
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, quantity, unit_rate, currency_type,
		   delivery_price_type, consumption_coefficient, parent_work_item_id,
		   work_name_id, material_name_id,
		   total_amount, commercial_markup,
		   total_commercial_material_cost, total_commercial_work_cost)
		VALUES ($1::uuid,$2::uuid,$3::boq_item_type,$4,$5,$6::currency_type,
		        'в цене',$7,$8::uuid,$9::uuid,$10::uuid,
		        999999, 777, 888888, 999999)
		RETURNING id::text`,
		f.srcPosID, f.tenderID, itemType, qty, rate, currency, consumption, parentID, workRef, matRef,
	).Scan(&id); err != nil {
		t.Fatalf("add source item: %v", err)
	}
	f.srcItemIDs = append(f.srcItemIDs, id)
	return id
}

type copiedRow struct {
	id       string
	total    *float64
	markup   *float64
	matCost  *float64
	workCost *float64
	parent   *string
	itemType string
}

func readTargetRows(t *testing.T, pool *pgxpool.Pool, posID string) []copiedRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT id::text, total_amount, commercial_markup,
		       total_commercial_material_cost, total_commercial_work_cost,
		       parent_work_item_id::text, boq_item_type::text
		FROM public.boq_items WHERE client_position_id = $1::uuid
		ORDER BY sort_number`, posID)
	if err != nil {
		t.Fatalf("read target rows: %v", err)
	}
	defer rows.Close()
	var out []copiedRow
	for rows.Next() {
		var r copiedRow
		if err := rows.Scan(&r.id, &r.total, &r.markup, &r.matCost, &r.workCost, &r.parent, &r.itemType); err != nil {
			t.Fatalf("scan target row: %v", err)
		}
		out = append(out, r)
	}
	return out
}

// ─── A. Same-tender copy: corrupted source derived values are NOT copied ─────

func TestCopyIntegration_DerivedValuesRecomputedNotCopied(t *testing.T) {
	pool := newTestPool(t)
	f := seedCopyTender(t, pool, "recompute", nil)
	repo := NewBoqRepo(pool)

	// RUB work: qty 10 × rate 100 = 1000. Source row claims total_amount = 999999.
	f.addSrcItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 10, 100, nil, nil)

	if _, err := repo.CopyPositionItems(context.Background(), f.srcPosID, f.dstPosID,
		"00000000-0000-0000-0000-000000000000"); err != nil {
		t.Fatalf("copy failed: %v", err)
	}

	got := readTargetRows(t, pool, f.dstPosID)
	if len(got) != 1 {
		t.Fatalf("target rows = %d, want 1", len(got))
	}
	r := got[0]

	// total_amount must be the calc result, NOT the source's 999999.
	if r.total == nil || *r.total != 1000 {
		t.Fatalf("target total_amount = %v, want 1000 (calc), source had 999999", r.total)
	}
	// Commercial values must NOT be the source's corrupted numbers.
	if r.matCost != nil && *r.matCost == 888888 {
		t.Fatal("source total_commercial_material_cost was copied (888888)")
	}
	if r.workCost != nil && *r.workCost == 999999 {
		t.Fatal("source total_commercial_work_cost was copied (999999)")
	}
	if r.markup != nil && *r.markup == 777 {
		t.Fatal("source commercial_markup was copied (777)")
	}

	// Source row is untouched.
	var srcTotal float64
	if err := pool.QueryRow(context.Background(),
		`SELECT total_amount FROM public.boq_items WHERE id = $1::uuid`, f.srcItemIDs[0]).Scan(&srcTotal); err != nil {
		t.Fatalf("read source: %v", err)
	}
	if srcTotal != 999999 {
		t.Fatalf("source row was modified: total_amount = %v", srcTotal)
	}
}

// ─── E. Parent mapping: child gets the COPIED work's new UUID ────────────────

func TestCopyIntegration_ParentRemappedAndChildPriced(t *testing.T) {
	pool := newTestPool(t)
	f := seedCopyTender(t, pool, "parent", nil)
	repo := NewBoqRepo(pool)

	cons := 1.5
	workID := f.addSrcItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 1, 100, nil, nil)
	// child material: qty 10, rate 100, consumption 1.5 — as a CHILD calc forces
	// consumption to 1 ⇒ 10 × 1 × 100 = 1000 (not 1500).
	f.addSrcItem(t, pool, calc.BoqMat, calc.CurrencyRUB, 10, 100, &cons, &workID)

	if _, err := repo.CopyPositionItems(context.Background(), f.srcPosID, f.dstPosID,
		"00000000-0000-0000-0000-000000000000"); err != nil {
		t.Fatalf("copy failed: %v", err)
	}

	got := readTargetRows(t, pool, f.dstPosID)
	if len(got) != 2 {
		t.Fatalf("target rows = %d, want 2", len(got))
	}

	var newWork, newMat copiedRow
	for _, r := range got {
		if r.itemType == calc.BoqRab {
			newWork = r
		} else {
			newMat = r
		}
	}

	if newMat.parent == nil {
		t.Fatal("child material lost its parent link")
	}
	if *newMat.parent != newWork.id {
		t.Fatalf("child parent = %s, want the COPIED work %s", *newMat.parent, newWork.id)
	}
	// The SOURCE parent UUID must not leak into the target.
	if *newMat.parent == workID {
		t.Fatal("source parent UUID leaked into the target row")
	}
	// Child pricing matches calc for the FINAL parent state (consumption forced to 1).
	if newMat.total == nil || *newMat.total != 1000 {
		t.Fatalf("child total_amount = %v, want 1000 (consumption forced to 1 for a child)", newMat.total)
	}
}

// ─── D/F. Missing target FX ⇒ blocking error, nothing persisted ──────────────

func TestCopyIntegration_MissingFXRollsBackEverything(t *testing.T) {
	pool := newTestPool(t)
	f := seedCopyTender(t, pool, "nofx", nil) // tender has NO usd_rate
	repo := NewBoqRepo(pool)

	// row 1 valid (RUB), row 2 USD → blocks.
	f.addSrcItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 1, 100, nil, nil)
	f.addSrcItem(t, pool, calc.BoqRab, calc.CurrencyUSD, 1, 100, nil, nil)

	_, err := repo.CopyPositionItems(context.Background(), f.srcPosID, f.dstPosID,
		"00000000-0000-0000-0000-000000000000")

	var fx *calc.MissingFXRateError
	if !errors.As(err, &fx) {
		t.Fatalf("expected MissingFXRateError, got %v", err)
	}
	if fx.Currency != calc.CurrencyUSD {
		t.Fatalf("currency = %q, want USD", fx.Currency)
	}

	// Whole batch rolled back — not even the valid first row survives.
	if got := readTargetRows(t, pool, f.dstPosID); len(got) != 0 {
		t.Fatalf("target rows after failed copy = %d, want 0 (rollback failed)", len(got))
	}
}

// ─── B. Target FX rate is the one used (not the source's stale total) ────────

func TestCopyIntegration_UsesTargetTenderFXRate(t *testing.T) {
	pool := newTestPool(t)
	rate := 100.0
	f := seedCopyTender(t, pool, "fx", &rate) // tender USD rate = 100
	repo := NewBoqRepo(pool)

	// USD work: qty 2 × rate 100 × fx 100 = 20000. Source claims 999999.
	f.addSrcItem(t, pool, calc.BoqRab, calc.CurrencyUSD, 2, 100, nil, nil)

	if _, err := repo.CopyPositionItems(context.Background(), f.srcPosID, f.dstPosID,
		"00000000-0000-0000-0000-000000000000"); err != nil {
		t.Fatalf("copy failed: %v", err)
	}

	got := readTargetRows(t, pool, f.dstPosID)
	if len(got) != 1 || got[0].total == nil {
		t.Fatalf("unexpected target rows: %+v", got)
	}
	if *got[0].total != 20000 {
		t.Fatalf("target total_amount = %v, want 20000 (qty 2 × 100 × USD 100)", *got[0].total)
	}
}

// ─── Invalid parent (material parent) blocks the copy ────────────────────────

func TestCopyIntegration_InvalidParentBlocks(t *testing.T) {
	pool := newTestPool(t)
	f := seedCopyTender(t, pool, "badparent", nil)
	repo := NewBoqRepo(pool)

	matParent := f.addSrcItem(t, pool, calc.BoqMat, calc.CurrencyRUB, 1, 10, nil, nil)
	f.addSrcItem(t, pool, calc.BoqMat, calc.CurrencyRUB, 1, 10, nil, &matParent) // parent is a MATERIAL

	_, err := repo.CopyPositionItems(context.Background(), f.srcPosID, f.dstPosID,
		"00000000-0000-0000-0000-000000000000")

	var pe *InvalidBoqParentError
	if !errors.As(err, &pe) {
		t.Fatalf("expected InvalidBoqParentError, got %v", err)
	}
	if pe.Reason != BoqParentNotWorkItem {
		t.Fatalf("reason = %q, want PARENT_NOT_WORK_ITEM", pe.Reason)
	}
	if got := readTargetRows(t, pool, f.dstPosID); len(got) != 0 {
		t.Fatalf("target rows after blocked copy = %d, want 0", len(got))
	}
}
