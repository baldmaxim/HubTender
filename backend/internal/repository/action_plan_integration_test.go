package repository

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/quality"
)

// PostgreSQL integration tests for stage 1.4: action plan composition over the
// three live analytics on a real database (COMPILED + SKIPPED without
// HUBTENDER_TEST_DATABASE_URL).
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run ActionPlanIntegration -v

// planFromSnapshots — та же композиция, что в ActionPlanService (сервис —
// тонкий; здесь она повторена, чтобы не создавать import-cycle
// repository→services в тестах пакета repository).
func planFromSnapshots(snaps *ActionPlanSnapshots, tenderID string, period, maxAge int) *ap.Report {
	qReport := quality.Evaluate(snaps.Quality)
	src := snaps.Source
	sReport := ps.Evaluate(tenderID, src.InputRev, src.CalcRev, src.CalcStatus,
		src.GeneratedAt, src.AsOfDate, maxAge, ps.DefaultExpiringSoonDays, src.Items)
	var bReport *pb.Report
	bs := snaps.Benchmark
	if bs.CalcStatus == "calculated" && bs.CalcRev == bs.InputRev {
		bReport = pb.Evaluate(tenderID, bs.InputRev, bs.CalcRev, bs.CalcStatus,
			period, bs.GeneratedAt, bs.Items, bs.Observations)
	}
	items := make([]ap.ItemInfo, 0, len(src.Items))
	for _, it := range src.Items {
		items = append(items, ap.ItemInfo{
			ID: it.ID, ClientPositionID: it.ClientPositionID,
			SortIndex: it.SortIndex, TotalAmount: it.TotalAmount,
		})
	}
	return ap.Compose(ap.Inputs{
		TenderID: tenderID, InputRev: src.InputRev, CalcRev: src.CalcRev,
		CalcStatus: src.CalcStatus, GeneratedAt: src.GeneratedAt, AsOfDate: src.AsOfDate,
		PeriodMonths: period, MaxAgeDays: maxAge,
		Quality: qReport, Benchmark: bReport, Source: sReport, Items: items,
	})
}

func actionPlan(t *testing.T, pool *pgxpool.Pool, tenderID string) *ap.Report {
	t.Helper()
	snaps, err := NewActionPlanRepo(pool).LoadSnapshots(context.Background(), tenderID, pb.DefaultPeriodMonths)
	if err != nil {
		t.Fatalf("LoadSnapshots: %v", err)
	}
	return planFromSnapshots(snaps, tenderID, pb.DefaultPeriodMonths, ps.DefaultMaxAgeDays)
}

func planActionByCode(r *ap.Report, code string) *ap.Action {
	for i := range r.Actions {
		if r.Actions[i].Code == code {
			return &r.Actions[i]
		}
	}
	return nil
}

// addPlanItem — строка с валютой/единицей/датами под нужный сценарий.
func addPlanItem(
	t *testing.T, pool *pgxpool.Pool, tenderID, posID, workNameID string,
	currency string, unitCode *string, rate float64,
	link *string, priceOffsetDays *int, withDetailCat bool,
) string {
	t.Helper()
	detail := "NULL"
	if withDetailCat {
		detail = "(SELECT id FROM public.detail_cost_categories LIMIT 1)"
	}
	var itemID string
	q := fmt.Sprintf(`
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, boq_item_type, work_name_id, unit_code,
		   quantity, unit_rate, currency_type, total_amount, quote_link,
		   quote_price_date, detail_cost_category_id)
		VALUES ($1::uuid,$2::uuid,'раб',$3::uuid,$4,1,$5,$6::currency_type,$5,$7,
		        CASE WHEN $8::int IS NULL THEN NULL ELSE CURRENT_DATE + $8::int END,
		        %s)
		RETURNING id::text`, detail)
	if err := pool.QueryRow(context.Background(), q,
		posID, tenderID, workNameID, unitCode, rate, currency, link, priceOffsetDays,
	).Scan(&itemID); err != nil {
		t.Fatalf("seed plan item: %v", err)
	}
	return itemID
}

// A/J/L/M — blocker + outlier + stale source в одном плане; реальные IDs;
// история = согласованные актуальные версии; server as-of.
func TestActionPlanIntegration_ThreeSourcesCombined(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	for i, cost := range []float64{100, 105, 110, 115, 120} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("AP%d", i), 1, workNameID, cost, 1, 2)
	}
	tenderID, posID := seedSourceTender(t, pool, "PLAN-A")
	usdRow := addPlanItem(t, pool, tenderID, posID, workNameID, "USD", sptr("м2"), 50, nil, nil, true)
	outlier := addSourceItem(t, pool, tenderID, posID, workNameID, 400, sptr("https://s.kz/a"), iptr(-5), nil)
	staleRow := addSourceItem(t, pool, tenderID, posID, workNameID, 90, sptr("https://s.kz/b"), iptr(-200), nil)

	r := actionPlan(t, pool, tenderID)

	// A: quality blocker (FX) — blocking и раньше всех high.
	fx := planActionByCode(r, "FX_RATE_MISSING")
	if fx == nil || fx.Priority != ap.PriorityBlocking || fx.Source != ap.SourceQuality {
		t.Fatalf("FX blocker wrong: %+v", fx)
	}
	// A/L: ценовой outlier из согласованной истории (5 тендеров).
	ho := planActionByCode(r, "HIGH_OUTLIER")
	if ho == nil || ho.Priority != ap.PriorityHigh || ho.EntityID != outlier {
		t.Fatalf("HIGH_OUTLIER wrong: %+v", ho)
	}
	if ho.Evidence["historical_tenders_count"] != "5" {
		t.Fatalf("history count=%s, want 5 (approved current versions)", ho.Evidence["historical_tenders_count"])
	}
	// A: устаревший источник.
	st := planActionByCode(r, "STALE")
	if st == nil || st.Priority != ap.PriorityNormal || st.EntityID != staleRow {
		t.Fatalf("STALE wrong: %+v", st)
	}
	// Компоненты: всё доступно (расчёт «актуален» в фикстуре).
	if r.Components.PriceBenchmark.Status != ap.ComponentAvailable {
		t.Fatalf("benchmark component=%s", r.Components.PriceBenchmark.Status)
	}
	// J: deep-link ID реальные (позиция строки совпадает с seeded).
	if *ho.ClientPositionID != posID || *ho.Navigation.ItemID != outlier {
		t.Fatalf("deep link ids wrong: %+v", ho.Navigation)
	}
	// M: as-of — серверная дата.
	if _, err := time.Parse("2006-01-02", r.AsOfDate); err != nil {
		t.Fatalf("as_of_date %q not server date: %v", r.AsOfDate, err)
	}
	// blocking сортируется раньше high.
	if r.Actions[0].Priority != ap.PriorityBlocking {
		t.Fatalf("rank 1 must be blocking, got %+v", r.Actions[0])
	}
	_ = usdRow
}

// B — одна строка с несколькими проблемами: в summary amount один раз.
func TestActionPlanIntegration_OneRowManyIssuesCountedOnce(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	for i, cost := range []float64{100, 105, 110, 115, 120} {
		seedApprovedHistoricalTender(t, pool, fmt.Sprintf("BP%d", i), 1, workNameID, cost, 1, 2)
	}
	tenderID, posID := seedSourceTender(t, pool, "PLAN-B")
	// Один item: outlier (900 против медианы 110) + stale источник + без затрат.
	itemID := addPlanItem(t, pool, tenderID, posID, workNameID, "RUB", sptr("м2"), 900,
		sptr("https://s.kz/b1"), iptr(-200), false)

	r := actionPlan(t, pool, tenderID)
	var touching int
	for _, a := range r.Actions {
		for _, id := range a.BoqItemIDs {
			if id == itemID {
				touching++
				break
			}
		}
	}
	if touching < 2 {
		t.Fatalf("expected several actions on one row, got %d", touching)
	}
	if r.Summary.AmountRequiringReview == nil || *r.Summary.AmountRequiringReview != 900 {
		t.Fatalf("summary amount=%v, want 900 exactly once (union)", r.Summary.AmountRequiringReview)
	}
	if r.Summary.AffectedBoqItems != 1 {
		t.Fatalf("affected=%d, want 1", r.Summary.AffectedBoqItems)
	}
}

// C — stale расчёт: blocker есть, benchmark-компонент not ready, benchmark-
// действий нет, source-действия остаются, amount unavailable.
func TestActionPlanIntegration_StaleCalculation(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "PLAN-C")
	addSourceItem(t, pool, tenderID, posID, workNameID, 100, nil, nil, nil) // без источника
	if _, err := pool.Exec(context.Background(), `
		UPDATE public.tenders SET financial_calculation_status='stale',
		  financial_input_revision = financial_input_revision + 1
		WHERE id=$1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}

	r := actionPlan(t, pool, tenderID)
	if a := planActionByCode(r, "CALCULATION_STALE"); a == nil || a.Priority != ap.PriorityBlocking {
		t.Fatalf("CALCULATION_STALE blocker missing: %+v", a)
	}
	if r.Components.PriceBenchmark.Status != ap.ComponentCalculationNotReady {
		t.Fatalf("benchmark component=%s, want calculation_not_ready", r.Components.PriceBenchmark.Status)
	}
	for _, a := range r.Actions {
		if a.Source == ap.SourcePriceBenchmark {
			t.Fatalf("stale: benchmark actions must be absent, got %+v", a)
		}
	}
	if planActionByCode(r, ps.StatusSourceMissing) == nil {
		t.Fatal("source row action must remain available at stale")
	}
	if r.Summary.AmountMetricsStatus != "unavailable" || r.Summary.AmountRequiringReview != nil {
		t.Fatalf("amount must be unavailable at stale: %+v", r.Summary)
	}
}

// D — после исправления данных action исчезает при следующем построении.
func TestActionPlanIntegration_ActionDisappearsAfterFix(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "PLAN-D")
	itemID := addSourceItem(t, pool, tenderID, posID, workNameID, 100, nil, nil, nil)

	before := actionPlan(t, pool, tenderID)
	if a := planActionByCode(before, ps.StatusSourceMissing); a == nil || a.EntityID != itemID {
		t.Fatalf("SOURCE_MISSING must exist before fix: %+v", a)
	}
	if _, err := pool.Exec(context.Background(), `
		UPDATE public.boq_items
		SET quote_link='https://s.kz/fixed', quote_price_date=CURRENT_DATE - 1
		WHERE id=$1::uuid`, itemID); err != nil {
		t.Fatal(err)
	}
	after := actionPlan(t, pool, tenderID)
	for _, a := range after.Actions {
		if a.EntityID == itemID && a.Source == ap.SourcePriceSource {
			t.Fatalf("action must disappear after fix, got %+v", a)
		}
	}
}

// E — группа точных дублей: один action, несколько item IDs.
func TestActionPlanIntegration_DuplicateGroupOneAction(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "PLAN-E")
	id1 := addSourceItem(t, pool, tenderID, posID, workNameID, 100, sptr("https://s.kz/d"), iptr(-1), nil)
	id2 := addSourceItem(t, pool, tenderID, posID, workNameID, 100, sptr("https://s.kz/d"), iptr(-1), nil)

	r := actionPlan(t, pool, tenderID)
	var dups []*ap.Action
	for i := range r.Actions {
		if r.Actions[i].Code == "EXACT_DUPLICATE_GROUP" {
			dups = append(dups, &r.Actions[i])
		}
	}
	if len(dups) != 1 {
		t.Fatalf("duplicate group must stay ONE action, got %d", len(dups))
	}
	if len(dups[0].BoqItemIDs) != 2 {
		t.Fatalf("group ids=%v, want both %s %s", dups[0].BoqItemIDs, id1, id2)
	}
	if dups[0].Navigation.Type != ap.NavDuplicateGroup {
		t.Fatalf("duplicate navigation type=%s", dups[0].Navigation.Type)
	}
}

// F — номенклатурная идентичность: quality + benchmark сливаются в один action.
func TestActionPlanIntegration_NomenclatureMerge(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "PLAN-F")
	itemID := addPlanItem(t, pool, tenderID, posID, workNameID, "RUB", nil, 100,
		sptr("https://s.kz/f"), iptr(-1), true) // unit_code NULL

	r := actionPlan(t, pool, tenderID)
	merged := planActionByCode(r, "UNIT_CODE_MISSING")
	if merged == nil {
		t.Fatal("merged identity action missing")
	}
	if merged.ID != "merged:ITEM_IDENTITY_MISSING:"+itemID+":unit_code" {
		t.Fatalf("merged ID=%s", merged.ID)
	}
	if len(merged.Sources) != 2 || merged.Sources[0] != ap.SourceQuality || merged.Sources[1] != ap.SourcePriceBenchmark {
		t.Fatalf("merged sources=%v", merged.Sources)
	}
	// Отдельного benchmark identity action быть не должно.
	if planActionByCode(r, "BENCHMARK_IDENTITY_MISSING") != nil {
		t.Fatal("separate benchmark identity action must not exist after merge")
	}
}

// H — тендер не найден.
func TestActionPlanIntegration_TenderNotFound(t *testing.T) {
	pool := newTestPool(t)
	_, err := NewActionPlanRepo(pool).LoadSnapshots(context.Background(),
		"ffffffff-ffff-ffff-ffff-ffffffffffff", pb.DefaultPeriodMonths)
	if !errors.Is(err, ErrQualityTenderNotFound) {
		t.Fatalf("want not-found, got %v", err)
	}
}

// K — стабильные action IDs между двумя одинаковыми построениями.
func TestActionPlanIntegration_StableIDsAcrossRequests(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "PLAN-K")
	addSourceItem(t, pool, tenderID, posID, workNameID, 100, nil, nil, nil)
	addSourceItem(t, pool, tenderID, posID, workNameID, 200, sptr("https://s.kz/k"), iptr(-200), nil)

	r1 := actionPlan(t, pool, tenderID)
	r2 := actionPlan(t, pool, tenderID)
	if len(r1.Actions) == 0 || len(r1.Actions) != len(r2.Actions) {
		t.Fatalf("plans differ in size: %d vs %d", len(r1.Actions), len(r2.Actions))
	}
	for i := range r1.Actions {
		if r1.Actions[i].ID != r2.Actions[i].ID || r1.Actions[i].Rank != r2.Actions[i].Rank {
			t.Fatalf("unstable at %d: %s/%d vs %s/%d", i,
				r1.Actions[i].ID, r1.Actions[i].Rank, r2.Actions[i].ID, r2.Actions[i].Rank)
		}
	}
}

// N — согласованный снапшот: все три аналитики видят одну ревизию, даже при
// конкурентном изменении между построениями.
func TestActionPlanIntegration_ConsistentSnapshotSmoke(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "PLAN-N")
	addSourceItem(t, pool, tenderID, posID, workNameID, 100, nil, nil, nil)

	check := func(label string) {
		snaps, err := NewActionPlanRepo(pool).LoadSnapshots(context.Background(), tenderID, pb.DefaultPeriodMonths)
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		q := snaps.Quality.Tender.FinancialInputRevision
		if q != snaps.Benchmark.InputRev || q != snaps.Source.InputRev {
			t.Fatalf("%s: snapshot revisions diverge: q=%d b=%d s=%d",
				label, q, snaps.Benchmark.InputRev, snaps.Source.InputRev)
		}
	}
	check("before")
	if _, err := pool.Exec(context.Background(), `
		UPDATE public.tenders SET financial_input_revision = financial_input_revision + 1,
		  financial_calculation_status='stale' WHERE id=$1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}
	check("after concurrent-style bump")
}

// O — фиксированное число запросов: инструментация счётчика запросов в pgx
// недоступна в тестовой обвязке; структурная гарантия покрыта guard'ом
// (fixed load*SnapshotTx) — кейс помечен SKIPPED.
func TestActionPlanIntegration_QueryCountInstrumentation(t *testing.T) {
	t.Skip("query-count instrumentation недоступна; фиксированность запросов гарантируется структурой LoadSnapshots + guard")
}
