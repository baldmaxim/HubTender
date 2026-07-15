package repository

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for stage 0-F2: the financial revision model,
// stale/CAS protection, recalc serialization, approval gates and the
// derived-write ETag contract. Reuses newTestPool / HUBTENDER_TEST_DATABASE_URL
// (COMPILED + SKIPPED without a test DB) and seedRollbackFixture.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run 'Revision|CalculationStatus|ConcurrentRecalc|Approval|ETag' -v

type finState struct {
	inputRev, calcRev int64
	status            string
	approved          bool
	errCode           *string
	updatedAt         time.Time
}

func readFinState(t *testing.T, pool *pgxpool.Pool, tenderID string) finState {
	t.Helper()
	var st finState
	if err := pool.QueryRow(context.Background(), `
		SELECT financial_input_revision, financial_calculation_revision,
		       financial_calculation_status, financial_approved,
		       financial_calculation_error_code, updated_at
		FROM public.tenders WHERE id = $1::uuid`, tenderID,
	).Scan(&st.inputRev, &st.calcRev, &st.status, &st.approved, &st.errCode, &st.updatedAt); err != nil {
		t.Fatalf("readFinState: %v", err)
	}
	return st
}

func approveDirect(t *testing.T, pool *pgxpool.Pool, tenderID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		UPDATE public.tenders SET financial_approved = true,
		  financial_approved_by = NULL, financial_approved_at = NOW()
		WHERE id = $1::uuid`, tenderID); err != nil {
		t.Fatalf("approveDirect: %v", err)
	}
}

// ─── A / §12.1-4: revision increment + approval invalidation, one tx ─────────

func TestRevisionIntegration_MarkBumpsOnceAndInvalidatesApproval(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVA", fptr(90))
	repo := NewImportRepo(pool)
	before := readFinState(t, pool, f.tenderID)
	approveDirect(t, pool, f.tenderID)

	// A batch of 3 rows = ONE user command = exactly +1 (§12.4).
	if _, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID, FileName: "rev.xlsx",
		Items: []ImportBoqItem{
			importItem(t, pool, f.posID, "раб", 1, 10, nil, nil),
			importItem(t, pool, f.posID, "раб", 2, 10, nil, nil),
			importItem(t, pool, f.posID, "мат", 3, 10, nil, nil),
		},
	}); err != nil {
		t.Fatalf("import: %v", err)
	}
	st := readFinState(t, pool, f.tenderID)
	if st.inputRev != before.inputRev+1 {
		t.Fatalf("input revision %d → %d, want exactly +1 per command", before.inputRev, st.inputRev)
	}
	if st.status != "stale" {
		t.Fatalf("status = %q, want stale after a category-A mutation", st.status)
	}
	if st.approved {
		t.Fatal("financial approval must be invalidated by a financial mutation")
	}
}

// ─── B / §12.6: import → stale → worker recalc → calculated ──────────────────

func TestRevisionIntegration_ImportLifecycle(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVB", fptr(90))
	repo := NewImportRepo(pool)

	if _, err := repo.BulkImport(context.Background(), ImportInput{
		TenderID: f.tenderID, FileName: "life.xlsx",
		Items: []ImportBoqItem{importItem(t, pool, f.posID, "раб", 10, 100, nil, nil)},
	}); err != nil {
		t.Fatalf("import: %v", err)
	}
	if st := readFinState(t, pool, f.tenderID); st.status != "stale" {
		t.Fatalf("after import status = %q, want stale", st.status)
	}

	outcome, err := RecalcTenderCommercialAuthoritative(context.Background(), pool, f.tenderID)
	if err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if outcome != RecalcOutcomeCalculated {
		t.Fatalf("outcome = %v, want calculated", outcome)
	}
	st := readFinState(t, pool, f.tenderID)
	if st.status != "calculated" || st.calcRev != st.inputRev {
		t.Fatalf("after recalc: %+v, want calculated with matching revisions", st)
	}

	// §12.8 / C: the second job is a cheap no-op.
	outcome2, err := RecalcTenderCommercialAuthoritative(context.Background(), pool, f.tenderID)
	if err != nil || outcome2 != RecalcOutcomeNoOp {
		t.Fatalf("second recalc = %v/%v, want no_op", outcome2, err)
	}
}

// ─── C / §12.7: two concurrent recalcs — one writer, one no-op ───────────────

func TestConcurrentRecalcIntegration_OneWriterOneNoOp(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVC", fptr(90))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil) // marked commercial 1/2/3
	repo := NewImportRepo(pool)
	_ = repo
	// Make the tender stale via a real mutation.
	if _, err := MarkTenderFinancialInputsChangedTx(context.Background(), pool, f.tenderID, "test_seed"); err != nil {
		t.Fatalf("mark: %v", err)
	}

	start := make(chan struct{}) // barrier — no sleeps as the sync mechanism
	outcomes := make([]CommercialRecalcOutcome, 2)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			outcomes[i], errs[i] = RecalcTenderCommercialAuthoritative(context.Background(), pool, f.tenderID)
		}(i)
	}
	close(start)
	wg.Wait()

	var calculated, noop int
	for i := 0; i < 2; i++ {
		if errs[i] != nil {
			t.Fatalf("job %d: %v", i, errs[i])
		}
		switch outcomes[i] {
		case RecalcOutcomeCalculated:
			calculated++
		case RecalcOutcomeNoOp:
			noop++
		}
	}
	if calculated != 1 || noop != 1 {
		t.Fatalf("outcomes = %v, want exactly one calculated and one no-op", outcomes)
	}
	if st := readFinState(t, pool, f.tenderID); st.status != "calculated" || st.calcRev != st.inputRev {
		t.Fatalf("final state %+v", st)
	}
}

// ─── D / §12.9: input change mid-recalc → CAS fails, derived writes roll back ─

func TestRevisionIntegration_StaleResultCannotPersist(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVD", fptr(90))
	itemID := f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	ctx := context.Background()

	if _, err := MarkTenderFinancialInputsChangedTx(ctx, pool, f.tenderID, "seed"); err != nil {
		t.Fatalf("mark: %v", err)
	}
	stale := readFinState(t, pool, f.tenderID)

	// An "old job": open a tx, snapshot the revision…
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	inputRev, _, _, err := ReadTenderFinancialRevisionTx(ctx, tx, f.tenderID)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if inputRev != stale.inputRev {
		t.Fatalf("snapshot rev %d != %d", inputRev, stale.inputRev)
	}
	// …write a derived value inside the old job's tx…
	if _, err := PersistCalculatedCommercialCostsTx(ctx, tx, f.tenderID, []CalculatedCommercialCostRow{
		{ID: itemID, CommercialMarkup: 9, TotalCommercialMaterialCost: 999, TotalCommercialWorkCost: 999},
	}); err != nil {
		t.Fatalf("derived write: %v", err)
	}
	// …meanwhile the inputs change in ANOTHER connection (committed).
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, pool, f.tenderID, "concurrent_user_edit"); err != nil {
		t.Fatalf("concurrent mark: %v", err)
	}
	// The old job's CAS must fail (RowsAffected==0 or 40001) → rollback all.
	casErr := MarkTenderCalculationSucceededTx(ctx, tx, f.tenderID, inputRev)
	if casErr == nil {
		t.Fatal("old revision CAS must not succeed after a concurrent input change")
	}
	var staleErr *StaleCalculationResultError
	if !errors.As(casErr, &staleErr) && !isSerializationFailure(casErr) {
		t.Fatalf("want StaleCalculationResultError or 40001, got %v", casErr)
	}
	_ = tx.Rollback(ctx)

	// The old job's derived write is gone; the tender stays stale at rev+1.
	var work float64
	if err := pool.QueryRow(ctx,
		`SELECT total_commercial_work_cost FROM public.boq_items WHERE id = $1::uuid`, itemID,
	).Scan(&work); err != nil {
		t.Fatalf("read item: %v", err)
	}
	if work == 999 {
		t.Fatal("stale calculation's derived write survived the rollback")
	}
	st := readFinState(t, pool, f.tenderID)
	if st.status != "stale" || st.inputRev != stale.inputRev+1 {
		t.Fatalf("state %+v, want stale at rev %d", st, stale.inputRev+1)
	}

	// The LATEST revision then calculates normally (requeue path).
	outcome, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID)
	if err != nil || outcome != RecalcOutcomeCalculated {
		t.Fatalf("latest recalc = %v/%v", outcome, err)
	}
}

// ─── E / §12.10-12: failed only for the CURRENT revision; retry recovers ─────

func TestCalculationStatusIntegration_FailedSemantics(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVE", fptr(90))
	ctx := context.Background()

	if _, err := MarkTenderFinancialInputsChangedTx(ctx, pool, f.tenderID, "seed"); err != nil {
		t.Fatalf("mark: %v", err)
	}
	st := readFinState(t, pool, f.tenderID)

	// §12.10 — a failure of an OLD revision does not mark the new one failed.
	if err := MarkTenderCalculationFailedIfCurrent(ctx, pool, f.tenderID, st.inputRev-1, "X", "old"); err != nil {
		t.Fatalf("old fail: %v", err)
	}
	if got := readFinState(t, pool, f.tenderID); got.status != "stale" {
		t.Fatalf("old-revision failure must keep status stale, got %q", got.status)
	}

	// §12.11 — a failure of the CURRENT revision marks failed (safe fields).
	if err := MarkTenderCalculationFailedIfCurrent(ctx, pool, f.tenderID, st.inputRev, "MISSING_FX_RATE", "Отсутствует курс валюты"); err != nil {
		t.Fatalf("current fail: %v", err)
	}
	got := readFinState(t, pool, f.tenderID)
	if got.status != "failed" || got.errCode == nil || *got.errCode != "MISSING_FX_RATE" {
		t.Fatalf("state %+v, want failed/MISSING_FX_RATE", got)
	}

	// §12.12 — a retry can become calculated (clears the error).
	outcome, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID)
	if err != nil || outcome != RecalcOutcomeCalculated {
		t.Fatalf("retry = %v/%v", outcome, err)
	}
	got = readFinState(t, pool, f.tenderID)
	if got.status != "calculated" || got.errCode != nil {
		t.Fatalf("after retry %+v", got)
	}
}

// ─── F / §12.5: sync FX reprice → calculated, revisions equal ────────────────

func TestRevisionIntegration_SyncFxReprice(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVF", fptr(80))
	f.addItem(t, pool, "раб", "USD", 10, 100, nil)
	repo := NewTenderRepo(pool)
	approveDirect(t, pool, f.tenderID)

	row, err := repo.UpdateTender(context.Background(), f.tenderID, UpdateTenderInput{USDRate: fptr(100)})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	st := readFinState(t, pool, f.tenderID)
	if st.status != "calculated" || st.calcRev != st.inputRev {
		t.Fatalf("sync reprice must finish calculated with equal revisions: %+v", st)
	}
	if st.approved {
		t.Fatal("§12.15: approval must be invalidated by the rate change")
	}
	if row.FinancialCalculationStatus != "calculated" {
		t.Fatalf("PATCH response status = %q, want calculated", row.FinancialCalculationStatus)
	}
}

// ─── G: redistribution snapshot revision marker ──────────────────────────────

func TestRevisionIntegration_RedistributionMarker(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVG", fptr(90))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	ctx := context.Background()

	// A SECOND detail category + work item so the deduction source and the
	// target do not overlap (SOURCE_TARGET_OVERLAP is fail-closed).
	var detail2 string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.detail_cost_categories (cost_category_id, location, name, unit)
		SELECT cost_category_id, 'loc2', 'itest-revg-detail2', 'м2'
		FROM public.detail_cost_categories WHERE id = $1::uuid
		RETURNING id::text`, f.detailCatID).Scan(&detail2); err != nil {
		t.Fatalf("detail2: %v", err)
	}
	t.Cleanup(func() {
		// LIFO: runs before the fixture's cleanup — drop dependents first.
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE detail_cost_category_id = $1::uuid`, detail2)
		_, _ = pool.Exec(ctx, `DELETE FROM public.detail_cost_categories WHERE id = $1::uuid`, detail2)
	})
	workNameID, _ := ensureTestNames(t, pool)
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, work_name_id, quantity, unit_rate,
		   currency_type, delivery_price_type, detail_cost_category_id, total_amount)
		VALUES ($1::uuid,$2::uuid,'раб',$3::uuid,5,100,'RUB','в цене',$4::uuid, 500)`,
		f.posID, f.tenderID, workNameID, detail2); err != nil {
		t.Fatalf("item2: %v", err)
	}

	// Materialize commercial first so redistribution has a base.
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("prep recalc: %v", err)
	}

	redRepo := NewRedistributionRepo(pool)
	saveOut, err := redRepo.SaveAuthoritative(ctx, f.tenderID, f.tacticID, crossDetailRules(t, pool, f, detail2), "")
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	_ = saveOut
	load, err := redRepo.LoadResults(ctx, f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if load.Status != RedistributionStatusCalculated {
		t.Fatalf("fresh snapshot status = %s/%s", load.Status, load.Reason)
	}

	// §13.G — an input change WITHOUT touching the BOQ set (insurance upsert).
	insRepo := NewInsuranceRepo(pool)
	if _, err := insRepo.Upsert(ctx, f.tenderID, InsuranceRow{
		JudicialPct: 10, TotalPct: 100, AptPriceM2: 10, AptArea: 10,
	}); err != nil {
		t.Fatalf("insurance: %v", err)
	}
	load2, err := redRepo.LoadResults(ctx, f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load2: %v", err)
	}
	if load2.Status != RedistributionStatusRequiresRecalculation ||
		load2.Reason != RedistributionReasonInputRevisionChanged {
		t.Fatalf("status = %s/%s, want requires_recalculation/INPUT_REVISION_CHANGED",
			load2.Status, load2.Reason)
	}
	if load2.Prepared != nil {
		t.Fatal("prepared must be nil for a stale snapshot")
	}
}

// ─── H / §12.13-15: approval gates ───────────────────────────────────────────

func TestApprovalIntegration_GatesAndInvalidation(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVH", fptr(90))
	f.addItem(t, pool, "раб", "RUB", 1, 10, nil)
	ctx := context.Background()
	repo := NewTenderRepo(pool)

	var userID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM public.users LIMIT 1`).Scan(&userID); err != nil {
		t.Skipf("no users row available for approval FK: %v", err)
	}

	// stale → 409-class typed error.
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, pool, f.tenderID, "seed"); err != nil {
		t.Fatalf("mark: %v", err)
	}
	err := repo.ApproveFinancial(ctx, f.tenderID, userID)
	var notReady *FinancialCalculationNotReadyError
	if !errors.As(err, &notReady) || notReady.Reason != "CALCULATION_STALE" {
		t.Fatalf("stale approve: want CALCULATION_STALE, got %v", err)
	}

	// calculated/current → success (§12.14).
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if err := repo.ApproveFinancial(ctx, f.tenderID, userID); err != nil {
		t.Fatalf("approve: %v", err)
	}
	if st := readFinState(t, pool, f.tenderID); !st.approved {
		t.Fatal("approve did not stick")
	}

	// §12.15 — a mutation flips approval off; re-approve blocked until recalc.
	boqRepo := NewBoqRepo(pool)
	workNameID, _ := ensureTestNames(t, pool)
	if _, err := boqRepo.CreateBoqItem(ctx, CreateBoqItemInput{
		TenderID: f.tenderID, ClientPositionID: f.posID, BoqItemType: "раб",
		WorkNameID: &workNameID, Quantity: fptr(1), UnitRate: fptr(5),
	}); err != nil {
		t.Fatalf("boq create: %v", err)
	}
	st := readFinState(t, pool, f.tenderID)
	if st.approved || st.status != "stale" {
		t.Fatalf("after mutation: %+v, want approval invalidated + stale", st)
	}
	err = repo.ApproveFinancial(ctx, f.tenderID, userID)
	if !errors.As(err, &notReady) {
		t.Fatalf("re-approve before recalc must be blocked, got %v", err)
	}
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("recalc2: %v", err)
	}
	if err := repo.ApproveFinancial(ctx, f.tenderID, userID); err != nil {
		t.Fatalf("approve after recalc: %v", err)
	}
}

// ─── I / §12.17-18: derived commercial write does not shift the BOQ ETag ─────

func TestETagIntegration_DerivedWriteKeepsUpdatedAt(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "REVI", fptr(90))
	itemID := f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	ctx := context.Background()

	readUpdatedAt := func() time.Time {
		var ts time.Time
		if err := pool.QueryRow(ctx,
			`SELECT updated_at FROM public.boq_items WHERE id = $1::uuid`, itemID).Scan(&ts); err != nil {
			t.Fatalf("updated_at: %v", err)
		}
		return ts
	}
	before := readUpdatedAt()

	// System commercial recalc — derived write only.
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if after := readUpdatedAt(); !after.Equal(before) {
		t.Fatalf("system recalc moved boq_items.updated_at: %v → %v (user ETag broken)", before, after)
	}

	// §12.18 — a USER input edit DOES move updated_at.
	boqRepo := NewBoqRepo(pool)
	if _, err := boqRepo.UpdateBoqItem(ctx, itemID, BoqItemPatch{Quantity: fptr(11)}); err != nil {
		t.Fatalf("user edit: %v", err)
	}
	if after := readUpdatedAt(); after.Equal(before) {
		t.Fatal("user edit must move updated_at (ETag must change)")
	}
}

// crossDetailRules — the smallest valid server rules input over the rollback
// fixture: deduct 10% from its first detail category into a second one (the
// source and target BOQ scopes must not overlap).
func crossDetailRules(t *testing.T, pool *pgxpool.Pool, f *rbFixture, targetDetailID string) calc.RedistributionRulesInput {
	t.Helper()
	_ = pool
	return calc.RedistributionRulesInput{
		Deductions: []calc.RedistributionSourceRuleInput{{
			Level: "detail", DetailCostCategoryID: f.detailCatID, Percentage: 10,
		}},
		Targets: []calc.RedistributionTargetInput{{Level: "detail", DetailCostCategoryID: targetDetailID}},
	}
}

// ensureTestNames returns reusable work/material nomenclature ids for BOQ
// fixtures (boq_items_material_check requires them on a fresh schema).
// Idempotent per database: select-or-insert by a fixed test name.
func ensureTestNames(t *testing.T, pool *pgxpool.Pool) (workNameID, materialNameID string) {
	t.Helper()
	ctx := context.Background()
	get := func(table, name string) string {
		var id string
		err := pool.QueryRow(ctx,
			`SELECT id::text FROM public.`+table+` WHERE name = $1 LIMIT 1`, name).Scan(&id)
		if err == nil {
			return id
		}
		if err := pool.QueryRow(ctx,
			`INSERT INTO public.`+table+` (name, unit) VALUES ($1, 'м2') RETURNING id::text`,
			name).Scan(&id); err != nil {
			t.Fatalf("ensureTestNames %s: %v", table, err)
		}
		return id
	}
	return get("work_names", "itest-shared-work"), get("material_names", "itest-shared-material")
}
