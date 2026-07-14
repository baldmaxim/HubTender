package repository

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests for the internal commercial writer.
// Reuses the existing convention + production-DSN guard from
// template_insert_integration_test.go (newTestPool / HUBTENDER_TEST_DATABASE_URL).
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run CommercialWriterIntegration -v
//
// Without the variable they SKIP (never a silent PASS).

// commercialFixture is a tender with N boq_items.
type commercialFixture struct {
	tenderID   string
	positionID string
	itemIDs    []string
}

// seedCommercialTender creates an isolated tender + position + boq_items.
func seedCommercialTender(t *testing.T, pool *pgxpool.Pool, nItems int, tag string) *commercialFixture {
	t.Helper()
	ctx := context.Background()
	f := &commercialFixture{}

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

	scan(&f.tenderID, `INSERT INTO public.tenders (title, client_name, tender_number)
	                   VALUES ($1,'itest-client',$2) RETURNING id::text`,
		"itest-commercial-"+tag, "ITEST-C-"+tag)
	scan(&f.positionID, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
	                     VALUES ($1::uuid, 1, 'itest-position') RETURNING id::text`, f.tenderID)

	cwWorkName, _ := ensureTestNames(t, pool)
	for i := 0; i < nItems; i++ {
		var id string
		scan(&id, `INSERT INTO public.boq_items
		             (client_position_id, tender_id, boq_item_type, work_name_id, quantity, unit_rate,
		              currency_type, total_amount, commercial_markup,
		              total_commercial_material_cost, total_commercial_work_cost)
		           VALUES ($1::uuid, $2::uuid, 'раб', $3::uuid, 1, 100, 'RUB', 100, 1, 0, 0)
		           RETURNING id::text`, f.positionID, f.tenderID, cwWorkName)
		f.itemIDs = append(f.itemIDs, id)
	}

	t.Cleanup(func() {
		must(`DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.client_positions WHERE tender_id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.tenders WHERE id = $1::uuid`, f.tenderID)
	})

	return f
}

type commercialSnapshot struct {
	markup, mat, work float64
}

func readCommercial(t *testing.T, pool *pgxpool.Pool, itemID string) commercialSnapshot {
	t.Helper()
	var s commercialSnapshot
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(commercial_markup,0), COALESCE(total_commercial_material_cost,0),
		        COALESCE(total_commercial_work_cost,0)
		 FROM public.boq_items WHERE id = $1::uuid`, itemID).Scan(&s.markup, &s.mat, &s.work); err != nil {
		t.Fatalf("read commercial: %v", err)
	}
	return s
}

func readGrandTotal(t *testing.T, pool *pgxpool.Pool, tenderID string) float64 {
	t.Helper()
	var v *float64
	if err := pool.QueryRow(context.Background(),
		`SELECT cached_grand_total FROM public.tenders WHERE id = $1::uuid`, tenderID).Scan(&v); err != nil {
		t.Fatalf("read grand total: %v", err)
	}
	if v == nil {
		return 0
	}
	return *v
}

// ─── A + D. Successful single-tender batch, exact-set commit ────────────────

func TestCommercialWriterIntegration_SuccessSingleTender(t *testing.T) {
	pool := newTestPool(t)
	f := seedCommercialTender(t, pool, 3, "ok")
	other := seedCommercialTender(t, pool, 2, "other")
	repo := NewBulkBoqRepo(pool)

	otherBefore := readCommercial(t, pool, other.itemIDs[0])
	otherGTBefore := readGrandTotal(t, pool, other.tenderID)

	rows := []CalculatedCommercialCostRow{
		row(f.itemIDs[0], 1.10, 110, 0),
		row(f.itemIDs[1], 1.20, 0, 120),
		row(f.itemIDs[2], 1.30, 65, 65),
	}

	updated, err := repo.PersistCalculatedCommercialCosts(context.Background(), f.tenderID, rows)
	if err != nil {
		t.Fatalf("persist failed: %v", err)
	}
	// D. RowsAffected == expected ⇒ commit.
	if updated != 3 {
		t.Fatalf("updated = %d, want 3", updated)
	}

	for i, want := range rows {
		got := readCommercial(t, pool, f.itemIDs[i])
		if got.markup != want.CommercialMarkup ||
			got.mat != want.TotalCommercialMaterialCost ||
			got.work != want.TotalCommercialWorkCost {
			t.Fatalf("item %d persisted %+v, want %+v", i, got, want)
		}
	}

	// cached grand total refreshed for THIS tender (110+120+130 = 360, no insurance).
	if gt := readGrandTotal(t, pool, f.tenderID); gt != 360 {
		t.Fatalf("cached_grand_total = %v, want 360", gt)
	}

	// Only the named tender was touched.
	if got := readCommercial(t, pool, other.itemIDs[0]); got != otherBefore {
		t.Fatalf("another tender's row changed: %+v → %+v", otherBefore, got)
	}
	if gt := readGrandTotal(t, pool, other.tenderID); gt != otherGTBefore {
		t.Fatalf("another tender's grand total changed: %v → %v", otherGTBefore, gt)
	}
}

// ─── B. Cross-tender injection ⇒ mismatch ⇒ full rollback ───────────────────

func TestCommercialWriterIntegration_CrossTenderInjectionRollsBack(t *testing.T) {
	pool := newTestPool(t)
	a := seedCommercialTender(t, pool, 1, "A")
	b := seedCommercialTender(t, pool, 1, "B")
	repo := NewBulkBoqRepo(pool)

	aBefore := readCommercial(t, pool, a.itemIDs[0])
	bBefore := readCommercial(t, pool, b.itemIDs[0])
	aGT := readGrandTotal(t, pool, a.tenderID)
	bGT := readGrandTotal(t, pool, b.tenderID)

	// Caller claims tender A, but smuggles a row belonging to tender B.
	rows := []CalculatedCommercialCostRow{
		row(a.itemIDs[0], 9, 900, 0),
		row(b.itemIDs[0], 9, 900, 0), // foreign tender — must never be written
	}

	_, err := repo.PersistCalculatedCommercialCosts(context.Background(), a.tenderID, rows)

	var me *CommercialResultSetMismatchError
	if !errors.As(err, &me) {
		t.Fatalf("expected CommercialResultSetMismatchError, got %v", err)
	}
	if me.Expected != 2 || me.Updated != 1 {
		t.Fatalf("mismatch payload = %+v, want expected=2 updated=1", me)
	}

	// Whole batch rolled back: even tender A's own row is unchanged.
	if got := readCommercial(t, pool, a.itemIDs[0]); got != aBefore {
		t.Fatalf("tender A row was persisted despite rollback: %+v → %+v", aBefore, got)
	}
	if got := readCommercial(t, pool, b.itemIDs[0]); got != bBefore {
		t.Fatalf("tender B row was written — cross-tender leak! %+v → %+v", bBefore, got)
	}
	if gt := readGrandTotal(t, pool, a.tenderID); gt != aGT {
		t.Fatalf("tender A grand total changed: %v → %v", aGT, gt)
	}
	if gt := readGrandTotal(t, pool, b.tenderID); gt != bGT {
		t.Fatalf("tender B grand total changed: %v → %v", bGT, gt)
	}
}

// ─── C. Unknown ID ⇒ mismatch ⇒ full rollback ──────────────────────────────

func TestCommercialWriterIntegration_UnknownIDRollsBack(t *testing.T) {
	pool := newTestPool(t)
	f := seedCommercialTender(t, pool, 1, "unknown")
	repo := NewBulkBoqRepo(pool)

	before := readCommercial(t, pool, f.itemIDs[0])
	gtBefore := readGrandTotal(t, pool, f.tenderID)

	rows := []CalculatedCommercialCostRow{
		row(f.itemIDs[0], 5, 500, 0),
		row("99999999-9999-9999-9999-999999999999", 5, 500, 0), // does not exist
	}

	_, err := repo.PersistCalculatedCommercialCosts(context.Background(), f.tenderID, rows)

	var me *CommercialResultSetMismatchError
	if !errors.As(err, &me) {
		t.Fatalf("expected CommercialResultSetMismatchError, got %v", err)
	}

	if got := readCommercial(t, pool, f.itemIDs[0]); got != before {
		t.Fatalf("valid row persisted despite rollback: %+v → %+v", before, got)
	}
	if gt := readGrandTotal(t, pool, f.tenderID); gt != gtBefore {
		t.Fatalf("grand total changed: %v → %v", gtBefore, gt)
	}
}

// ─── E. Invalid numeric values ⇒ rejected BEFORE any SQL mutation ───────────

func TestCommercialWriterIntegration_InvalidNumbersNeverReachDB(t *testing.T) {
	pool := newTestPool(t)
	f := seedCommercialTender(t, pool, 2, "invalid")
	repo := NewBulkBoqRepo(pool)

	before0 := readCommercial(t, pool, f.itemIDs[0])
	before1 := readCommercial(t, pool, f.itemIDs[1])
	gtBefore := readGrandTotal(t, pool, f.tenderID)

	// First row valid, second row NaN ⇒ validation fails before the UPDATE.
	rows := []CalculatedCommercialCostRow{
		row(f.itemIDs[0], 2, 200, 0),
		row(f.itemIDs[1], 2, math.NaN(), 0),
	}

	_, err := repo.PersistCalculatedCommercialCosts(context.Background(), f.tenderID, rows)

	var ie *InvalidCommercialCalculationResultError
	if !errors.As(err, &ie) {
		t.Fatalf("expected InvalidCommercialCalculationResultError, got %v", err)
	}

	// The DB must be completely untouched (validation ran before any mutation).
	if got := readCommercial(t, pool, f.itemIDs[0]); got != before0 {
		t.Fatalf("row 0 was written despite pre-mutation validation failure: %+v → %+v", before0, got)
	}
	if got := readCommercial(t, pool, f.itemIDs[1]); got != before1 {
		t.Fatalf("row 1 changed: %+v → %+v", before1, got)
	}
	if gt := readGrandTotal(t, pool, f.tenderID); gt != gtBefore {
		t.Fatalf("grand total changed: %v → %v", gtBefore, gt)
	}
}
