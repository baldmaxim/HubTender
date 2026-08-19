package repository

import (
	"context"
	"errors"
	"math"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for stage 0-F1: server-authoritative BOQ import
// and the atomic FX-rate reprice pipeline. Reuses newTestPool /
// HUBTENDER_TEST_DATABASE_URL (COMPILED + SKIPPED without a test DB) and the
// full markup fixture from boq_audit_rollback_integration_test.go.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run 'Import|Rate|Reprice' -v

func fptr(v float64) *float64 { return &v }
func sptr(s string) *string   { return &s }

func importItem(t *testing.T, pool *pgxpool.Pool, posID, itemType string, qty, rate float64, currency *string, clientTotal *float64) ImportBoqItem {
	t.Helper()
	workNameID, matNameID := ensureTestNames(t, pool)
	item := ImportBoqItem{
		ClientPositionID: posID,
		BoqItemType:      itemType,
		Quantity:         fptr(qty),
		UnitRate:         fptr(rate),
		CurrencyType:     currency,
		TotalAmount:      clientTotal,
	}
	// boq_items_material_check: works carry work_name_id, materials —
	// material_name_id (the production frontend always sends them).
	if calc.IsWorkBoqType(itemType) {
		item.WorkNameID = &workNameID
	} else {
		item.MaterialNameID = &matNameID
	}
	return item
}

func scanItemTotals(t *testing.T, pool *pgxpool.Pool, tenderID string) map[string]float64 {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT id::text, total_amount FROM public.boq_items WHERE tender_id = $1::uuid`, tenderID)
	if err != nil {
		t.Fatalf("scan totals: %v", err)
	}
	defer rows.Close()
	out := map[string]float64{}
	for rows.Next() {
		var id string
		var total float64
		if err := rows.Scan(&id, &total); err != nil {
			t.Fatalf("scan: %v", err)
		}
		out[id] = total
	}
	return out
}

func tenderStateSnapshot(t *testing.T, pool *pgxpool.Pool, tenderID string) (usdRate *float64, cached string, itemCount int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `
		SELECT t.usd_rate, t.cached_grand_total::text,
		       (SELECT count(*) FROM public.boq_items b WHERE b.tender_id = t.id)
		FROM public.tenders t WHERE t.id = $1::uuid`, tenderID,
	).Scan(&usdRate, &cached, &itemCount); err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return
}

// ─── A. Import ignores a forged client total ─────────────────────────────────

func TestImportIntegration_IgnoresForgedClientTotal(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "IMPA", fptr(90))
	repo := NewImportRepo(pool)

	// G.1 — RUB: quantity=100, unit_rate=500, forged client total=1.
	res, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID,
		FileName: "forged.xlsx",
		Items: []ImportBoqItem{
			importItem(t, pool, f.posID, "раб", 100, 500, nil, fptr(1)),
		},
	})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if res.InsertedItemsCount != 1 {
		t.Fatalf("inserted = %d", res.InsertedItemsCount)
	}
	totals := scanItemTotals(t, pool, f.tenderID)
	for _, total := range totals {
		if total != 50000 {
			t.Fatalf("persisted total = %v, want 50000 (server calc, not the forged 1)", total)
		}
	}
	// The forged value shows up ONLY in the diagnostic report.
	if res.TotalMismatchCount != 1 || len(res.TotalMismatches) != 1 {
		t.Fatalf("want exactly 1 mismatch, got %+v", res.TotalMismatches)
	}
	m := res.TotalMismatches[0]
	if m.ClientTotalAmount != 1 || m.ServerTotalAmount != 50000 {
		t.Fatalf("mismatch row wrong: %+v", m)
	}
	// Position totals were re-aggregated in the same tx (G: import consistency).
	var totalWorks float64
	if err := pool.QueryRow(context.Background(),
		`SELECT COALESCE(total_works,0) FROM public.client_positions WHERE id = $1::uuid`, f.posID,
	).Scan(&totalWorks); err != nil {
		t.Fatalf("position totals: %v", err)
	}
	if totalWorks != 50000 {
		t.Fatalf("position total_works = %v, want 50000", totalWorks)
	}

	// G.2 — USD row: rate 90 → 10×100×90 = 90000 regardless of client total.
	res2, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID,
		FileName: "forged-usd.xlsx",
		Items: []ImportBoqItem{
			importItem(t, pool, f.posID, "раб", 10, 100, sptr("USD"), fptr(100)),
		},
	})
	if err != nil {
		t.Fatalf("usd import: %v", err)
	}
	if res2.TotalMismatchCount != 1 || res2.TotalMismatches[0].ServerTotalAmount != 90000 {
		t.Fatalf("usd mismatch: %+v", res2.TotalMismatches)
	}
	var usdTotal float64
	if err := pool.QueryRow(context.Background(), `
		SELECT total_amount FROM public.boq_items
		WHERE tender_id = $1::uuid AND currency_type = 'USD'`, f.tenderID,
	).Scan(&usdTotal); err != nil {
		t.Fatalf("usd total: %v", err)
	}
	if usdTotal != 90000 {
		t.Fatalf("usd persisted total = %v, want 90000", usdTotal)
	}
}

// ─── B. Mismatch report semantics ────────────────────────────────────────────

func TestImportIntegration_MismatchReport(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "IMPB", fptr(90))
	repo := NewImportRepo(pool)

	res, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID,
		FileName: "report.xlsx",
		Items: []ImportBoqItem{
			// G.4 — client total matches server calc → no warning.
			importItem(t, pool, f.posID, "раб", 2, 10, nil, fptr(20)),
			// G.3 — client total absent → no warning.
			importItem(t, pool, f.posID, "раб", 3, 10, nil, nil),
			// G.5 — divergent → warning; G.6 — negative diagnostic value.
			importItem(t, pool, f.posID, "мат", 4, 10, nil, fptr(-5)),
		},
	})
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	if res.InsertedItemsCount != 3 {
		t.Fatalf("inserted = %d, want 3 (a mismatch is a warning, not an error)", res.InsertedItemsCount)
	}
	if res.TotalMismatchCount != 1 || len(res.TotalMismatches) != 1 {
		t.Fatalf("want exactly 1 mismatch, got %+v", res.TotalMismatches)
	}
	if res.TotalMismatches[0].ClientTotalAmount != -5 || res.TotalMismatches[0].ServerTotalAmount != 40 {
		t.Fatalf("mismatch row wrong: %+v", res.TotalMismatches[0])
	}

	// G.11 — re-importing identical inputs yields identical authoritative totals.
	res2, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID,
		FileName: "repeat.xlsx",
		Items:    []ImportBoqItem{importItem(t, pool, f.posID, "раб", 2, 10, nil, nil)},
	})
	if err != nil {
		t.Fatalf("repeat import: %v", err)
	}
	if res2.TotalMismatchCount != 0 {
		t.Fatalf("repeat import must not warn: %+v", res2.TotalMismatches)
	}
	var cnt int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM public.boq_items
		WHERE tender_id = $1::uuid AND quantity = 2 AND total_amount = 20`, f.tenderID,
	).Scan(&cnt); err != nil {
		t.Fatalf("count: %v", err)
	}
	if cnt != 2 {
		t.Fatalf("identical inputs → identical totals, got %d rows with total 20", cnt)
	}
}

// ─── C. Missing FX rolls the whole import back ───────────────────────────────

func TestImportIntegration_MissingFXRollsBackEverything(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "IMPC", nil) // no usd_rate
	repo := NewImportRepo(pool)

	_, beforeCached, beforeCount := tenderStateSnapshot(t, pool, f.tenderID)

	_, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID,
		FileName: "usd-no-rate.xlsx",
		Items: []ImportBoqItem{
			importItem(t, pool, f.posID, "раб", 1, 10, nil, nil),           // valid RUB row
			importItem(t, pool, f.posID, "раб", 10, 100, sptr("USD"), nil), // uncalculable
		},
	})
	var fx *calc.MissingFXRateError
	if !errors.As(err, &fx) {
		t.Fatalf("want MissingFXRateError, got %v", err)
	}

	// All-or-nothing: no rows (including the valid RUB one), totals untouched.
	_, afterCached, afterCount := tenderStateSnapshot(t, pool, f.tenderID)
	if afterCount != beforeCount {
		t.Fatalf("rows leaked: %d → %d", beforeCount, afterCount)
	}
	if afterCached != beforeCached {
		t.Fatalf("cached_grand_total changed: %s → %s", beforeCached, afterCached)
	}
	var sessions int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.import_sessions WHERE tender_id = $1::uuid`, f.tenderID,
	).Scan(&sessions); err != nil {
		t.Fatalf("sessions: %v", err)
	}
	if sessions != 0 {
		t.Fatalf("import_sessions leaked: %d", sessions)
	}
}

// G.7 — a NaN control value is a clear input error, never a persisted total.
func TestImportIntegration_NaNControlValueRejected(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "IMPN", fptr(90))
	repo := NewImportRepo(pool)

	nan := math.NaN()
	_, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID,
		FileName: "nan.xlsx",
		Items:    []ImportBoqItem{importItem(t, pool, f.posID, "раб", 1, 10, nil, &nan)},
	})
	var bulkErr *ErrBulkImport
	if !errors.As(err, &bulkErr) {
		t.Fatalf("want ErrBulkImport (400-class input error), got %v", err)
	}
	if _, _, count := tenderStateSnapshot(t, pool, f.tenderID); count != 0 {
		t.Fatalf("NaN row leaked into boq_items")
	}
}

// ─── G.9. Parent semantics: persisted amount == calc's view of the real link ─

func TestImportIntegration_ParentMaterialAuthoritativeAmount(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "IMPP", fptr(90))
	repo := NewImportRepo(pool)

	work := importItem(t, pool, f.posID, "раб", 5, 100, nil, nil)
	work.TempID = sptr("w1")
	child := importItem(t, pool, f.posID, "мат", 2, 10, nil, nil)
	child.ParentWorkTempID = sptr("w1")
	child.ConsumptionCoeff = fptr(1.5)

	if _, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID, FileName: "parent.xlsx",
		Items: []ImportBoqItem{work, child},
	}); err != nil {
		t.Fatalf("import: %v", err)
	}

	// The child's persisted parent link must be a real UUID and its amount must
	// equal the kernel's result for exactly that persisted state.
	var childTotal float64
	var parentID *string
	if err := pool.QueryRow(context.Background(), `
		SELECT total_amount, parent_work_item_id::text FROM public.boq_items
		WHERE tender_id = $1::uuid AND boq_item_type = 'мат'`, f.tenderID,
	).Scan(&childTotal, &parentID); err != nil {
		t.Fatalf("child: %v", err)
	}
	if parentID == nil {
		t.Fatal("child lost its parent link")
	}
	want, err := calc.CalculateBoqItemTotalAmount(calc.BoqItemAmountInput{
		BoqItemType:            "мат",
		Quantity:               fptr(2),
		UnitRate:               fptr(10),
		CurrencyType:           "RUB",
		ConsumptionCoefficient: fptr(1.5),
		ParentWorkItemID:       parentID,
	}, calc.CurrencyRates{USDRate: fptr(90)})
	if err != nil {
		t.Fatalf("kernel: %v", err)
	}
	if childTotal != want {
		t.Fatalf("child total = %v, kernel says %v (parent semantics diverged)", childTotal, want)
	}
}

// ─── G.10. Large batch: single rates load, batch persistence ─────────────────

func TestImportIntegration_LargeBatch(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "IMPL", fptr(90))
	repo := NewImportRepo(pool)

	items := make([]ImportBoqItem, 0, 1000)
	for i := 0; i < 1000; i++ {
		items = append(items, importItem(t, pool, f.posID, "раб", 2, 5, nil, nil))
	}
	res, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID, FileName: "big.xlsx", Items: items,
	})
	if err != nil {
		t.Fatalf("large import: %v", err)
	}
	if res.InsertedItemsCount != 1000 {
		t.Fatalf("inserted = %d", res.InsertedItemsCount)
	}
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM public.boq_items
		WHERE tender_id = $1::uuid AND total_amount = 10`, f.tenderID,
	).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1000 {
		t.Fatalf("all 1000 rows must carry the server total 10, got %d", n)
	}
	// No per-row FX queries by construction: RecomputeBoqTotalAmountsTx issues
	// ONE rates query, ONE row-select and ONE bulk UPDATE (asserted at source
	// level by the serverAuthoritativeImportFx guard; no runtime query counter
	// exists in this codebase).
}

// ─── D/F. Atomic FX reprice on the regular and admin update paths ───────────

func seedRateChangeFixture(t *testing.T, pool *pgxpool.Pool, tag string) (*rbFixture, string, string) {
	t.Helper()
	f := seedRollbackFixture(t, pool, tag, fptr(80))
	usdItem := f.addItem(t, pool, "раб", "USD", 10, 100, nil) // marked totals 111/1/2/3
	rubItem := f.addItem(t, pool, "мат", "RUB", 3, 100, nil)
	return f, usdItem, rubItem
}

func assertRepriced(t *testing.T, pool *pgxpool.Pool, f *rbFixture, usdItem, rubItem, label string) {
	t.Helper()
	ctx := context.Background()
	totals := scanItemTotals(t, pool, f.tenderID)
	if totals[usdItem] != 100000 { // 10 × 100 × 100
		t.Fatalf("%s: USD total = %v, want 100000 (new rate)", label, totals[usdItem])
	}
	if totals[rubItem] != 300 { // H.2 — RUB rows unaffected by the USD rate
		t.Fatalf("%s: RUB total = %v, want 300", label, totals[rubItem])
	}
	// Position totals follow (H: positions recomputed in the same tx).
	var tm, tw float64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(total_material,0), COALESCE(total_works,0)
		FROM public.client_positions WHERE id = $1::uuid`, f.posID).Scan(&tm, &tw); err != nil {
		t.Fatalf("%s: position totals: %v", label, err)
	}
	if tm != 300 || tw != 100000 {
		t.Fatalf("%s: position totals = %v/%v, want 300/100000", label, tm, tw)
	}
	// Commercial values re-materialized from the NEW total_amount: the marked
	// stale values (1/2/3 from addItem) must be gone on every row.
	var stale int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM public.boq_items
		WHERE tender_id = $1::uuid
		  AND (total_commercial_material_cost = 2 OR total_commercial_work_cost = 3)`,
		f.tenderID).Scan(&stale); err != nil {
		t.Fatalf("%s: stale scan: %v", label, err)
	}
	if stale != 0 {
		t.Fatalf("%s: %d rows kept commercial values computed before the rate change", label, stale)
	}
	// cached_grand_total is exactly the canonical helper's value (idempotent
	// recompute must be a no-op byte-for-byte).
	var persisted string
	if err := pool.QueryRow(ctx,
		`SELECT cached_grand_total::text FROM public.tenders WHERE id = $1::uuid`, f.tenderID,
	).Scan(&persisted); err != nil {
		t.Fatalf("%s: cached: %v", label, err)
	}
	res := runHelper(t, pool, f.tenderID)
	if res.RoundedTotalDecimal != persisted {
		t.Fatalf("%s: cached %s != canonical recompute %s", label, persisted, res.RoundedTotalDecimal)
	}
}

func TestRateChangeIntegration_RegularUpdateRepricesAtomically(t *testing.T) {
	pool := newTestPool(t)
	f, usdItem, rubItem := seedRateChangeFixture(t, pool, "FXD")
	repo := NewTenderRepo(pool)

	row, err := repo.UpdateTender(context.Background(), f.tenderID,
		UpdateTenderInput{USDRate: fptr(100)})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if row.USDRate == nil || *row.USDRate != 100 {
		t.Fatalf("returned rate = %v, want 100", row.USDRate)
	}
	assertRepriced(t, pool, f, usdItem, rubItem, "regular")
}

func TestRateChangeIntegration_AdminUpdateParity(t *testing.T) {
	pool := newTestPool(t)
	f, usdItem, rubItem := seedRateChangeFixture(t, pool, "FXF")
	repo := NewTenderRepo(pool)

	if err := repo.AdminPatchTender(context.Background(), f.tenderID,
		AdminTenderPatch{USDRate: fptr(100)}); err != nil {
		t.Fatalf("admin patch: %v", err)
	}
	assertRepriced(t, pool, f, usdItem, rubItem, "admin")
}

// ─── E. A failing reprice rolls back the rate and every derived value ────────

func TestRateChangeIntegration_FailureRollsBackEverything(t *testing.T) {
	pool := newTestPool(t)
	f, usdItem, _ := seedRateChangeFixture(t, pool, "FXE")
	repo := NewTenderRepo(pool)

	// Establish a consistent baseline at rate 80 first. The reprice gate is
	// value-based, so the baseline patch has to be a REAL rate change: park the
	// stored rate at 79 (raw UPDATE — no reprice) so patching it to 80 actually
	// runs the pipeline and replaces the fixture's marked totals.
	if _, err := pool.Exec(context.Background(),
		`UPDATE public.tenders SET usd_rate = 79 WHERE id = $1::uuid`, f.tenderID); err != nil {
		t.Fatalf("park baseline rate: %v", err)
	}
	if err := repo.AdminPatchTender(context.Background(), f.tenderID,
		AdminTenderPatch{USDRate: fptr(80)}); err != nil {
		t.Fatalf("baseline: %v", err)
	}
	rateBefore, cachedBefore, _ := tenderStateSnapshot(t, pool, f.tenderID)
	totalsBefore := scanItemTotals(t, pool, f.tenderID)

	// usd_rate = 0 makes the USD row uncalculable → full rollback (E).
	err := repo.AdminPatchTender(context.Background(), f.tenderID,
		AdminTenderPatch{USDRate: fptr(0)})
	var fx *calc.MissingFXRateError
	if !errors.As(err, &fx) {
		t.Fatalf("want MissingFXRateError, got %v", err)
	}

	rateAfter, cachedAfter, _ := tenderStateSnapshot(t, pool, f.tenderID)
	if rateBefore == nil || rateAfter == nil || *rateAfter != *rateBefore {
		t.Fatalf("usd_rate changed: %v → %v", rateBefore, rateAfter)
	}
	if cachedAfter != cachedBefore {
		t.Fatalf("cached_grand_total changed: %s → %s", cachedBefore, cachedAfter)
	}
	totalsAfter := scanItemTotals(t, pool, f.tenderID)
	for id, before := range totalsBefore {
		if totalsAfter[id] != before {
			t.Fatalf("item %s total changed: %v → %v", id, before, totalsAfter[id])
		}
	}
	if totalsAfter[usdItem] != 80000 {
		t.Fatalf("sanity: baseline USD total = %v, want 80000", totalsAfter[usdItem])
	}
}

// H.3 — mixed-currency tender: only the matching currency legs move.
func TestRateChangeIntegration_MixedCurrencies(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "FXM", fptr(80))
	ctx := context.Background()
	if _, err := pool.Exec(ctx,
		`UPDATE public.tenders SET eur_rate = 90 WHERE id = $1::uuid`, f.tenderID); err != nil {
		t.Fatalf("seed eur: %v", err)
	}
	usdItem := f.addItem(t, pool, "раб", "USD", 1, 10, nil)
	eurItem := f.addItem(t, pool, "раб", "EUR", 1, 10, nil)
	rubItem := f.addItem(t, pool, "мат", "RUB", 1, 10, nil)

	repo := NewTenderRepo(pool)
	if _, err := repo.UpdateTender(ctx, f.tenderID, UpdateTenderInput{USDRate: fptr(100)}); err != nil {
		t.Fatalf("update: %v", err)
	}
	totals := scanItemTotals(t, pool, f.tenderID)
	if totals[usdItem] != 1000 {
		t.Fatalf("USD leg = %v, want 1000", totals[usdItem])
	}
	if totals[eurItem] != 900 {
		t.Fatalf("EUR leg = %v, want 900 (unchanged rate)", totals[eurItem])
	}
	if totals[rubItem] != 10 {
		t.Fatalf("RUB leg = %v, want 10", totals[rubItem])
	}
}

// H.4 — consumption/delivery keep flowing through calc on reprice.
func TestRateChangeIntegration_DeliveryAndConsumptionViaCalc(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "FXC", fptr(80))
	ctx := context.Background()

	// USD material with delivery "не в цене" (3% matrix rule in calc).
	_, matNameID := ensureTestNames(t, pool)
	var itemID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, quantity, unit_rate, currency_type,
		   delivery_price_type, consumption_coefficient, detail_cost_category_id,
		   material_name_id, total_amount)
		VALUES ($1::uuid,$2::uuid,'мат',2,100,'USD','не в цене',1.5,$3::uuid,$4::uuid, 111)
		RETURNING id::text`, f.posID, f.tenderID, f.detailCatID, matNameID).Scan(&itemID); err != nil {
		t.Fatalf("seed: %v", err)
	}

	repo := NewTenderRepo(pool)
	if _, err := repo.UpdateTender(ctx, f.tenderID, UpdateTenderInput{USDRate: fptr(100)}); err != nil {
		t.Fatalf("update: %v", err)
	}
	want, err := calc.CalculateBoqItemTotalAmount(calc.BoqItemAmountInput{
		BoqItemType: "мат", Quantity: fptr(2), UnitRate: fptr(100), CurrencyType: "USD",
		DeliveryPriceType: "не в цене", ConsumptionCoefficient: fptr(1.5),
	}, calc.CurrencyRates{USDRate: fptr(100)})
	if err != nil {
		t.Fatalf("kernel: %v", err)
	}
	totals := scanItemTotals(t, pool, f.tenderID)
	if totals[itemID] != want {
		t.Fatalf("repriced total = %v, kernel says %v", totals[itemID], want)
	}
}
