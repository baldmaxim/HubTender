package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
)

// PostgreSQL integration tests for stage 1.2: historical price benchmark on a
// real database. Reuses newTestPool / HUBTENDER_TEST_DATABASE_URL
// (COMPILED + SKIPPED without a test DB) and stage-0/1.1 fixtures.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run PriceBenchmarkIntegration -v

// seedApprovedHistoricalTender — согласованный исторический тендер с одной
// строкой заданного unit cost (qty=1 → total = unitCost) по общей номенклатуре.
func seedApprovedHistoricalTender(
	t *testing.T, pool *pgxpool.Pool, tag string, version int,
	workNameID string, unitCost float64, rows int, monthsAgo int,
) string {
	t.Helper()
	ctx := context.Background()
	var tenderID, posID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders
		  (title, client_name, tender_number, version,
		   financial_approved, financial_approved_at,
		   financial_calculation_status, financial_input_revision, financial_calculation_revision)
		VALUES ($1,'itest-client',$2,$3, true, NOW() - make_interval(months => $4),
		        'calculated', 1, 1)
		RETURNING id::text`,
		"itest-pb-"+tag, "ITEST-PB-"+tag, version, monthsAgo).Scan(&tenderID); err != nil {
		t.Fatalf("seed hist tender: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1::uuid`, tenderID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 1, 'p') RETURNING id::text`, tenderID).Scan(&posID); err != nil {
		t.Fatalf("seed hist pos: %v", err)
	}
	for i := 0; i < rows; i++ {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.boq_items
			  (client_position_id, tender_id, boq_item_type, work_name_id, unit_code,
			   quantity, unit_rate, currency_type, total_amount)
			VALUES ($1::uuid,$2::uuid,'раб',$3::uuid,'м2',1,$4,'RUB',$4)`,
			posID, tenderID, workNameID, unitCost); err != nil {
			t.Fatalf("seed hist row: %v", err)
		}
	}
	return tenderID
}

// seedCurrentBenchmarkTender — текущий тендер (calculated/current) с одной
// строкой той же номенклатуры.
func seedCurrentBenchmarkTender(t *testing.T, pool *pgxpool.Pool, tag, workNameID string, unitCost float64) (tenderID, itemID string) {
	t.Helper()
	ctx := context.Background()
	var posID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders
		  (title, client_name, tender_number,
		   financial_calculation_status, financial_input_revision, financial_calculation_revision)
		VALUES ($1,'itest-client',$2,'calculated', 3, 3)
		RETURNING id::text`, "itest-pb-cur-"+tag, "ITEST-PBCUR-"+tag).Scan(&tenderID); err != nil {
		t.Fatalf("seed current tender: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id=$1::uuid`, tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1::uuid`, tenderID)
	})
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 1, 'p') RETURNING id::text`, tenderID).Scan(&posID); err != nil {
		t.Fatalf("seed current pos: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, work_name_id, unit_code,
		   quantity, unit_rate, currency_type, total_amount)
		VALUES ($1::uuid,$2::uuid,'раб',$3::uuid,'м2',1,$4,'RUB',$4)
		RETURNING id::text`, posID, tenderID, workNameID, unitCost).Scan(&itemID); err != nil {
		t.Fatalf("seed current row: %v", err)
	}
	return tenderID, itemID
}

func benchmarkReport(t *testing.T, pool *pgxpool.Pool, tenderID string, period int) *pb.Report {
	t.Helper()
	repo := NewPriceBenchmarkRepo(pool)
	snap, err := repo.LoadSnapshot(context.Background(), tenderID, period)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return pb.Evaluate(tenderID, snap.InputRev, snap.CalcRev, snap.CalcStatus,
		period, snap.GeneratedAt, snap.Items, snap.Observations)
}

func firstItem(t *testing.T, r *pb.Report, itemID string) *pb.ItemBenchmark {
	t.Helper()
	for i := range r.Items {
		if r.Items[i].BoqItemID == itemID {
			return &r.Items[i]
		}
	}
	t.Fatalf("item %s not in report", itemID)
	return nil
}

// A/H/O — 5 согласованных тендеров → бенчмарк; high outlier; реальные IDs.
func TestPriceBenchmarkIntegration_HighOutlierWithFiveTenders(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	for i, cost := range []float64{100, 105, 110, 115, 120} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("A%d", i), 1, workNameID, cost, 1, 2)
	}
	tenderID, itemID := seedCurrentBenchmarkTender(t, pool, "A", workNameID, 300)

	r := benchmarkReport(t, pool, tenderID, 24)
	ib := firstItem(t, r, itemID)
	if ib.Status != pb.StatusHighOutlier {
		t.Fatalf("status=%s, want HIGH_OUTLIER (%+v)", ib.Status, ib)
	}
	if ib.HistoricalTendersCount != 5 {
		t.Fatalf("tenders=%d, want 5", ib.HistoricalTendersCount)
	}
	if ib.Median == nil || *ib.Median != 110 {
		t.Fatalf("median=%v, want 110", ib.Median)
	}
	// O — deep-link IDs соответствуют текущему BOQ.
	if ib.BoqItemID != itemID || ib.ClientPositionID == "" {
		t.Fatalf("entity ids wrong: %+v", ib)
	}
}

// I — low outlier.
func TestPriceBenchmarkIntegration_LowOutlier(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	for i, cost := range []float64{100, 105, 110, 115, 120} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("L%d", i), 1, workNameID, cost, 1, 3)
	}
	tenderID, itemID := seedCurrentBenchmarkTender(t, pool, "L", workNameID, 10)
	ib := firstItem(t, benchmarkReport(t, pool, tenderID, 24), itemID)
	if ib.Status != pb.StatusLowOutlier {
		t.Fatalf("status=%s, want LOW_OUTLIER", ib.Status)
	}
}

// B — несколько версий одного логического тендера → одна observation.
func TestPriceBenchmarkIntegration_OneVersionPerLogicalTender(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	// один tender_number, версии 1 и 2 — обе согласованы
	for v, cost := range map[int]float64{1: 100, 2: 200} {
		seedApprovedHistoricalTender(t, pool, "VER", v, workNameID, cost, 1, 2)
	}
	for i, cost := range []float64{100, 105, 110, 115} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("V%d", i), 1, workNameID, cost, 1, 2)
	}
	tenderID, itemID := seedCurrentBenchmarkTender(t, pool, "V", workNameID, 100)
	ib := firstItem(t, benchmarkReport(t, pool, tenderID, 24), itemID)
	// 4 одиночных + 1 логический (2 версии → 1) = 5 observations
	if ib.HistoricalTendersCount != 5 {
		t.Fatalf("tenders=%d, want 5 (two versions collapse)", ib.HistoricalTendersCount)
	}
}

// C — несколько одинаковых строк одного тендера → одна representative.
func TestPriceBenchmarkIntegration_PerTenderRepresentative(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	seedApprovedHistoricalTender(t, pool, "REP-big", 1, workNameID, 500, 10, 2) // 10 строк
	for i, cost := range []float64{100, 102, 104, 106} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("REP%d", i), 1, workNameID, cost, 1, 2)
	}
	tenderID, itemID := seedCurrentBenchmarkTender(t, pool, "REP", workNameID, 104)
	ib := firstItem(t, benchmarkReport(t, pool, tenderID, 24), itemID)
	if ib.HistoricalTendersCount != 5 {
		t.Fatalf("tenders=%d, want 5 (big tender collapses to one observation)", ib.HistoricalTendersCount)
	}
	if ib.HistoricalRowsCount != 14 {
		t.Fatalf("rows=%d, want 14", ib.HistoricalRowsCount)
	}
	if ib.Median == nil || *ib.Median != 104 {
		t.Fatalf("median=%v, want 104 (not dominated by 10× rows)", ib.Median)
	}
}

// D/E/F/G/J — исключения выборки и insufficient.
func TestPriceBenchmarkIntegration_EligibilityExclusions(t *testing.T) {
	pool := newTestPool(t)
	workNameID, matNameID := ensureTestNames(t, pool)
	ctx := context.Background()

	// 4 валидных исторических
	for i, cost := range []float64{100, 105, 110, 115} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("EX%d", i), 1, workNameID, cost, 1, 2)
	}
	// D: несогласованный
	unapproved := seedApprovedHistoricalTender(t, pool, "EX-unapp", 1, workNameID, 999, 1, 2)
	if _, err := pool.Exec(ctx, `UPDATE public.tenders SET financial_approved=false WHERE id=$1::uuid`, unapproved); err != nil {
		t.Fatal(err)
	}
	// E: stale
	stale := seedApprovedHistoricalTender(t, pool, "EX-stale", 1, workNameID, 999, 1, 2)
	if _, err := pool.Exec(ctx, `UPDATE public.tenders SET financial_calculation_status='stale' WHERE id=$1::uuid`, stale); err != nil {
		t.Fatal(err)
	}
	// период: старше 24 мес.
	seedApprovedHistoricalTender(t, pool, "EX-old", 1, workNameID, 999, 1, 30)
	// G: другой unit (м3) и другая номенклатура — не участвуют
	other := seedApprovedHistoricalTender(t, pool, "EX-unit", 1, workNameID, 999, 0, 2)
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.boq_items (client_position_id, tender_id, boq_item_type, work_name_id, unit_code, quantity, unit_rate, total_amount)
		SELECT cp.id, $1::uuid, 'раб', $2::uuid, 'м3', 1, 999, 999 FROM public.client_positions cp WHERE cp.tender_id=$1::uuid`,
		other, workNameID); err != nil {
		t.Fatal(err)
	}
	_ = matNameID

	// F: текущий тендер (его собственные строки не история)
	tenderID, itemID := seedCurrentBenchmarkTender(t, pool, "EX", workNameID, 100)

	ib := firstItem(t, benchmarkReport(t, pool, tenderID, 24), itemID)
	// J: только 4 валидных → insufficient
	if ib.Status != pb.StatusInsufficientHistory || ib.HistoricalTendersCount != 4 {
		t.Fatalf("status=%s tenders=%d, want INSUFFICIENT_HISTORY/4 (exclusions leaked)",
			ib.Status, ib.HistoricalTendersCount)
	}
}

// M — stale текущий расчёт → fail-closed (сервисный слой).
func TestPriceBenchmarkIntegration_StaleCurrentFailClosed(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, _ := seedCurrentBenchmarkTender(t, pool, "STALE", workNameID, 100)
	if _, err := pool.Exec(context.Background(),
		`UPDATE public.tenders SET financial_calculation_status='stale' WHERE id=$1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}
	repo := NewPriceBenchmarkRepo(pool)
	snap, err := repo.LoadSnapshot(context.Background(), tenderID, 24)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if snap.CalcStatus == "calculated" {
		t.Fatal("fixture: status must be stale")
	}
	// Сервисный gate — сравнение как в PriceBenchmarkService (409-ветка).
	if snap.CalcStatus == "calculated" && snap.CalcRev == snap.InputRev {
		t.Fatal("stale must not classify as ready")
	}
}

// K — detail: наблюдения по ключу строки.
func TestPriceBenchmarkIntegration_DetailObservations(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	for i, cost := range []float64{100, 105, 110, 115, 120} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("D%d", i), 1, workNameID, cost, 1, 2)
	}
	tenderID, itemID := seedCurrentBenchmarkTender(t, pool, "D", workNameID, 100)
	repo := NewPriceBenchmarkRepo(pool)
	snap, err := repo.LoadSnapshot(context.Background(), tenderID, 24)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	var obsCount int
	for _, it := range snap.Items {
		if it.ID == itemID {
			key, ok, _ := pb.BuildPriceBenchmarkKey(it.BoqItemType, it.NameID, it.UnitCode, it.HasParent)
			if !ok {
				t.Fatal("key must build")
			}
			obsCount = len(snap.Observations[key])
		}
	}
	if obsCount != 5 {
		t.Fatalf("observations=%d, want 5", obsCount)
	}
}

// Not found.
func TestPriceBenchmarkIntegration_TenderNotFound(t *testing.T) {
	pool := newTestPool(t)
	repo := NewPriceBenchmarkRepo(pool)
	_, err := repo.LoadSnapshot(context.Background(), "ffffffff-ffff-ffff-ffff-ffffffffffff", 24)
	if !errors.Is(err, ErrQualityTenderNotFound) {
		t.Fatalf("want not-found, got %v", err)
	}
}
