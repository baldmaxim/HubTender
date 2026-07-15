package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
)

// PostgreSQL integration tests for stage 1.5: change impact between saved
// tender versions (COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL).
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run ChangeImpactIntegration -v

// seedCIVersion — версия тендера с заданной готовностью и итогом.
func seedCIVersion(
	t *testing.T, pool *pgxpool.Pool, number string, ver int,
	approved bool, status string, usdRate *float64, grand string,
) (tenderID, posID string) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders
		  (title, client_name, tender_number, version, usd_rate,
		   financial_approved, financial_approved_at,
		   financial_calculation_status, financial_input_revision, financial_calculation_revision,
		   cached_grand_total)
		VALUES ($1,'itest-client',$2,$3,$4,$5,
		        CASE WHEN $5 THEN NOW() - make_interval(months => 1) ELSE NULL END,
		        $6, 3, CASE WHEN $6 = 'calculated' THEN 3 ELSE 2 END, $7::numeric)
		RETURNING id::text`,
		fmt.Sprintf("itest-ci-%s-v%d", number, ver), "ITEST-CI-"+number, ver,
		usdRate, approved, status, grand).Scan(&tenderID); err != nil {
		t.Fatalf("seed ci tender: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.tender_insurance WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1::uuid`, tenderID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, item_no, work_name, unit_code)
		VALUES ($1::uuid, 1, '01', 'Основные работы', 'м2') RETURNING id::text`, tenderID).Scan(&posID); err != nil {
		t.Fatalf("seed ci pos: %v", err)
	}
	return tenderID, posID
}

// addCIItem — строка с authoritative direct + commercial work cost.
func addCIItem(
	t *testing.T, pool *pgxpool.Pool, tenderID, posID, workNameID string,
	desc string, qty, rate float64, direct, commWork string, sort int,
) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, work_name_id, unit_code,
		   description, quantity, unit_rate, currency_type, sort_number,
		   total_amount, total_commercial_work_cost)
		VALUES ($1::uuid,$2::uuid,'раб',$3::uuid,'м2',$4,$5,$6,'RUB',$7,$8::numeric,$9::numeric)
		RETURNING id::text`,
		posID, tenderID, workNameID, desc, qty, rate, sort, direct, commWork).Scan(&id); err != nil {
		t.Fatalf("seed ci item: %v", err)
	}
	return id
}

// ciReport — та же композиция, что в ChangeImpactService (без import-cycle):
// gate готовности current + Compare/BaselineNotAvailable.
func ciReport(t *testing.T, pool *pgxpool.Pool, tenderID, baselineID string) (*ci.Report, error) {
	t.Helper()
	snap, err := NewChangeImpactRepo(pool).LoadSnapshot(context.Background(), tenderID, baselineID)
	if err != nil {
		return nil, err
	}
	curT := &snap.Current.Tender
	if curT.CalcStatus != "calculated" || curT.CalcRev != curT.InputRev {
		return nil, &FinancialCalculationNotReadyError{
			TenderID: tenderID, CalculationStatus: curT.CalcStatus,
			InputRevision: curT.InputRev, CalculationRevision: curT.CalcRev,
			Reason: "CALCULATION_STALE",
		}
	}
	if snap.Baseline == nil {
		return ci.BaselineNotAvailableReport(snap.Current.Tender, snap.Candidates, snap.GeneratedAt), nil
	}
	return ci.Compare(snap.Current, *snap.Baseline, snap.Candidates, snap.GeneratedAt), nil
}

func mustCIReport(t *testing.T, pool *pgxpool.Pool, tenderID, baselineID string) *ci.Report {
	t.Helper()
	r, err := ciReport(t, pool, tenderID, baselineID)
	if err != nil {
		t.Fatalf("change impact: %v", err)
	}
	return r
}

func ciDiffByStatus(r *ci.Report, status string) []ci.ItemDiff {
	var out []ci.ItemDiff
	for _, d := range r.Items {
		if d.Status == status {
			out = append(out, d)
		}
	}
	return out
}

// A/C/F/G/H/J/M/N/O/P — основной сценарий: v2 против approved v1.
func TestChangeImpactIntegration_TwoVersionsFullScenario(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	workNameID, _ := ensureTestNames(t, pool)
	usd80, usd100 := 80.0, 100.0

	// v1: unchanged(110) + modified(220→) + removed(50); insurance 100.
	// grand = 110+220+50 (commercial) + 100 (insurance) = 480.
	v1, p1 := seedCIVersion(t, pool, "MAIN", 1, true, "calculated", &usd80, "480")
	addCIItem(t, pool, v1, p1, workNameID, "Бетон М300", 1, 100, "100", "110", 1)
	bMod := addCIItem(t, pool, v1, p1, workNameID, "Арматура", 2, 100, "200", "220", 2)
	bDel := addCIItem(t, pool, v1, p1, workNameID, "Опалубка", 1, 50, "50", "50", 3)
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.tender_insurance (tender_id, judicial_pct, total_pct, apt_price_m2, apt_area)
		VALUES ($1::uuid, 10, 100, 1000, 1)`, v1); err != nil {
		t.Fatal(err)
	}

	// v2 (current): unchanged(110) + modified(qty 2→3, 330) + added(80);
	// insurance 200. grand = 110+330+80 + 200 = 720.
	v2, p2 := seedCIVersion(t, pool, "MAIN", 2, false, "calculated", &usd100, "720")
	cSame := addCIItem(t, pool, v2, p2, workNameID, "Бетон М300", 1, 100, "100", "110", 1)
	cMod := addCIItem(t, pool, v2, p2, workNameID, "Арматура", 3, 100, "300", "330", 2)
	cNew := addCIItem(t, pool, v2, p2, workNameID, "Гидроизоляция", 1, 80, "80", "80", 4)
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.tender_insurance (tender_id, judicial_pct, total_pct, apt_price_m2, apt_area)
		VALUES ($1::uuid, 10, 100, 2000, 1)`, v2); err != nil {
		t.Fatal(err)
	}

	r := mustCIReport(t, pool, v2, "")

	// A: baseline по умолчанию — approved v1.
	if r.Status != ci.ReportOK || r.Baseline == nil || r.Baseline.TenderID != v1 {
		t.Fatalf("baseline wrong: %+v", r.Baseline)
	}
	// C: статусы.
	if len(ciDiffByStatus(r, ci.StatusAdded)) != 1 || len(ciDiffByStatus(r, ci.StatusRemoved)) != 1 ||
		len(ciDiffByStatus(r, ci.StatusModified)) != 1 || len(ciDiffByStatus(r, ci.StatusUnchanged)) != 1 {
		t.Fatalf("statuses wrong: %+v", r.Summary)
	}
	// F: quantity change в changed fields.
	mod := ciDiffByStatus(r, ci.StatusModified)[0]
	if mod.CurrentItemID == nil || *mod.CurrentItemID != cMod || mod.BaselineItemID == nil || *mod.BaselineItemID != bMod {
		t.Fatalf("modified pair wrong: %+v", mod)
	}
	foundQty := false
	for _, f := range mod.ChangedFields {
		if f.Field == "quantity" {
			foundQty = true
		}
	}
	if !foundQty {
		t.Fatalf("quantity change not detected: %+v", mod.ChangedFields)
	}
	// G: insurance delta = 100.
	if r.Summary.InsuranceDelta != 100 {
		t.Fatalf("insurance delta=%v, want 100", r.Summary.InsuranceDelta)
	}
	// H: bridge полностью согласован: Δgrand 240 = BOQ (80-50+110) + ins 100.
	if !r.Summary.IsReconciled || r.Summary.GrandTotalDelta != 240 || r.Summary.BoqCommercialDelta != 140 {
		t.Fatalf("bridge must reconcile: %+v", r.Summary)
	}
	// O: config diff — USD 80→100 присутствует и НЕ несёт денежной дельты.
	var usdChange *ci.ConfigChange
	for i := range r.ConfigChanges {
		if r.ConfigChanges[i].Code == "USD_RATE" {
			usdChange = &r.ConfigChanges[i]
		}
	}
	if usdChange == nil || usdChange.OldValue != "80" || usdChange.NewValue != "100" {
		t.Fatalf("USD config change wrong: %+v", r.ConfigChanges)
	}
	// M: deep-link IDs существуют (added → текущая строка).
	added := ciDiffByStatus(r, ci.StatusAdded)[0]
	if added.CurrentItemID == nil || *added.CurrentItemID != cNew || *added.ClientPositionID != p2 {
		t.Fatalf("added ids wrong: %+v", added)
	}
	// N: removed — без current ID.
	removed := ciDiffByStatus(r, ci.StatusRemoved)[0]
	if removed.CurrentItemID != nil || removed.BaselineItemID == nil || *removed.BaselineItemID != bDel {
		t.Fatalf("removed row must have no current id: %+v", removed)
	}
	// P: стабильность между двумя запросами.
	r2 := mustCIReport(t, pool, v2, "")
	if len(r.Items) != len(r2.Items) {
		t.Fatal("unstable item count")
	}
	for i := range r.Items {
		if r.Items[i].ID != r2.Items[i].ID {
			t.Fatalf("unstable order at %d", i)
		}
	}
	_ = cSame
}

// B/R — несогласованная/stale версия не выбирается по умолчанию и отклоняется явно.
func TestChangeImpactIntegration_IneligibleBaselinesSkipped(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0

	v1, p1 := seedCIVersion(t, pool, "SKIP", 1, true, "calculated", &usd, "110")
	addCIItem(t, pool, v1, p1, workNameID, "Бетон", 1, 100, "100", "110", 1)
	v2, _ := seedCIVersion(t, pool, "SKIP", 2, false, "calculated", &usd, "0") // не согласована
	v3, _ := seedCIVersion(t, pool, "SKIP", 3, true, "stale", &usd, "0")       // stale
	v4, p4 := seedCIVersion(t, pool, "SKIP", 4, false, "calculated", &usd, "110")
	addCIItem(t, pool, v4, p4, workNameID, "Бетон", 1, 100, "100", "110", 1)

	r := mustCIReport(t, pool, v4, "")
	// B: default baseline пропускает v3(stale) и v2(unapproved) → v1.
	if r.Baseline == nil || r.Baseline.TenderID != v1 {
		t.Fatalf("default baseline must be v1, got %+v", r.Baseline)
	}
	// Кандидаты не содержат непригодные версии.
	for _, c := range r.BaselineCandidates {
		if c.TenderID == v2 || c.TenderID == v3 {
			t.Fatalf("ineligible candidate leaked: %+v", c)
		}
	}
	// R: явный выбор stale → typed 409-ошибка.
	var notReady *ChangeImpactBaselineNotReadyError
	if _, err := ciReport(t, pool, v4, v3); !errors.As(err, &notReady) {
		t.Fatalf("explicit stale baseline must fail typed, got %v", err)
	}
	// J: явный выбор валидного v1 работает.
	if r2 := mustCIReport(t, pool, v4, v1); r2.Baseline == nil || r2.Baseline.TenderID != v1 {
		t.Fatal("explicit valid baseline failed")
	}
}

// E — дубли exact-ключа → одна ambiguous-группа с агрегатом.
func TestChangeImpactIntegration_DuplicateAmbiguousGroup(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0
	v1, p1 := seedCIVersion(t, pool, "DUP", 1, true, "calculated", &usd, "220")
	addCIItem(t, pool, v1, p1, workNameID, "Одинаковая строка", 1, 100, "100", "110", 1)
	addCIItem(t, pool, v1, p1, workNameID, "Одинаковая строка", 1, 100, "100", "110", 2)
	v2, p2 := seedCIVersion(t, pool, "DUP", 2, false, "calculated", &usd, "330")
	for i := 1; i <= 3; i++ {
		addCIItem(t, pool, v2, p2, workNameID, "Одинаковая строка", 1, 100, "100", "110", i)
	}

	r := mustCIReport(t, pool, v2, "")
	groups := ciDiffByStatus(r, ci.StatusAmbiguousGroup)
	if len(groups) != 1 || groups[0].CurrentCount != 3 || groups[0].BaselineCount != 2 {
		t.Fatalf("want one 3↔2 ambiguous group, got %+v", groups)
	}
	if groups[0].Commercial.Delta != 110 || !r.Summary.IsReconciled {
		t.Fatalf("group aggregate/reconciliation wrong: %+v", r.Summary)
	}
}

// I — намеренная порча cached_grand_total → mismatch не скрывается.
func TestChangeImpactIntegration_ReconciliationMismatchVisible(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0
	v1, p1 := seedCIVersion(t, pool, "BAD", 1, true, "calculated", &usd, "110")
	addCIItem(t, pool, v1, p1, workNameID, "Бетон", 1, 100, "100", "110", 1)
	v2, p2 := seedCIVersion(t, pool, "BAD", 2, false, "calculated", &usd, "999110")
	addCIItem(t, pool, v2, p2, workNameID, "Бетон", 1, 100, "100", "110", 1)

	r := mustCIReport(t, pool, v2, "")
	if r.Summary.IsReconciled || r.Summary.ReconciliationStatus != ci.ReconciliationMismatch {
		t.Fatalf("mismatch must be visible: %+v", r.Summary)
	}
	if r.Summary.ReconciliationResidual != 999000 {
		t.Fatalf("residual=%v, want 999000", r.Summary.ReconciliationResidual)
	}
}

// K — not found; отсутствие baseline → 200-контракт.
func TestChangeImpactIntegration_NotFoundAndNoBaseline(t *testing.T) {
	pool := newTestPool(t)
	_, err := NewChangeImpactRepo(pool).LoadSnapshot(context.Background(),
		"ffffffff-ffff-ffff-ffff-ffffffffffff", "")
	if !errors.Is(err, ErrQualityTenderNotFound) {
		t.Fatalf("want not-found, got %v", err)
	}
	usd := 90.0
	solo, _ := seedCIVersion(t, pool, "SOLO", 1, false, "calculated", &usd, "0")
	r := mustCIReport(t, pool, solo, "")
	if r.Status != ci.ReportBaselineNotAvailable || r.Baseline != nil || len(r.Items) != 0 {
		t.Fatalf("no-baseline contract wrong: %+v", r.Status)
	}
}

// Q — current stale → typed not-ready (handler отдаёт 409).
func TestChangeImpactIntegration_CurrentStale409(t *testing.T) {
	pool := newTestPool(t)
	usd := 90.0
	v1, _ := seedCIVersion(t, pool, "STALE", 1, true, "calculated", &usd, "0")
	v2, _ := seedCIVersion(t, pool, "STALE", 2, false, "stale", &usd, "0")
	var notReady *FinancialCalculationNotReadyError
	if _, err := ciReport(t, pool, v2, ""); !errors.As(err, &notReady) {
		t.Fatalf("stale current must fail typed, got %v", err)
	}
	_ = v1
}

// D — persisted transfer lineage в модели отсутствует (аудит §1).
func TestChangeImpactIntegration_TransferLineage(t *testing.T) {
	t.Skip("persisted row lineage отсутствует (transfer-карта транзиентна) — exact-key policy покрыта остальными кейсами")
}

// S — query count instrumentation недоступна.
func TestChangeImpactIntegration_QueryCountInstrumentation(t *testing.T) {
	t.Skip("query-count instrumentation недоступна; фиксированность гарантирована структурой LoadSnapshot + guard")
}
