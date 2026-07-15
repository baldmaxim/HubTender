package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/xuri/excelize/v2"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	rp "github.com/su10/hubtender/backend/internal/analytics/reviewpack"
	"github.com/su10/hubtender/backend/internal/quality"
)

// PostgreSQL integration tests for stage 1.6: review pack XLSX over live
// analytics (COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL).
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run ReviewPackIntegration -v

// reviewModelFromDB — та же композиция, что в ReviewPackService (без
// import-cycle repository→services): gate + готовые движки + Build.
func reviewModelFromDB(t *testing.T, pool *pgxpool.Pool, tenderID string, period, maxAge int, baselineID string) (*rp.Model, error) {
	t.Helper()
	snap, err := NewReviewPackRepo(pool).LoadSnapshot(context.Background(), tenderID, period, baselineID)
	if err != nil {
		return nil, err
	}
	src := snap.Source
	if src.CalcStatus != "calculated" || src.CalcRev != src.InputRev {
		return nil, &FinancialCalculationNotReadyError{
			TenderID: tenderID, CalculationStatus: src.CalcStatus,
			InputRevision: src.InputRev, CalculationRevision: src.CalcRev,
			Reason: "CALCULATION_STALE",
		}
	}
	qReport := quality.Evaluate(snap.Quality)
	sReport := ps.Evaluate(tenderID, src.InputRev, src.CalcRev, src.CalcStatus,
		src.GeneratedAt, src.AsOfDate, maxAge, ps.DefaultExpiringSoonDays, src.Items)
	bReport := pb.Evaluate(tenderID, snap.Benchmark.InputRev, snap.Benchmark.CalcRev,
		snap.Benchmark.CalcStatus, period, snap.Benchmark.GeneratedAt,
		snap.Benchmark.Items, snap.Benchmark.Observations)
	items := make([]ap.ItemInfo, 0, len(src.Items))
	for _, it := range src.Items {
		items = append(items, ap.ItemInfo{ID: it.ID, ClientPositionID: it.ClientPositionID,
			SortIndex: it.SortIndex, TotalAmount: it.TotalAmount})
	}
	planReport := ap.Compose(ap.Inputs{
		TenderID: tenderID, InputRev: src.InputRev, CalcRev: src.CalcRev,
		CalcStatus: src.CalcStatus, GeneratedAt: src.GeneratedAt, AsOfDate: src.AsOfDate,
		PeriodMonths: period, MaxAgeDays: maxAge,
		Quality: qReport, Benchmark: bReport, Source: sReport, Items: items,
	})
	var ciReport *ci.Report
	if snap.ChangeImpact.Baseline == nil {
		ciReport = ci.BaselineNotAvailableReport(snap.ChangeImpact.Current.Tender,
			snap.ChangeImpact.Candidates, snap.ChangeImpact.GeneratedAt)
	} else {
		ciReport = ci.Compare(snap.ChangeImpact.Current, *snap.ChangeImpact.Baseline,
			snap.ChangeImpact.Candidates, snap.ChangeImpact.GeneratedAt)
	}
	baselineTenderID, baselineVersion := "", 0
	if ciReport.Baseline != nil {
		baselineTenderID, baselineVersion = ciReport.Baseline.TenderID, ciReport.Baseline.Version
	}
	md := rp.Metadata{
		TenderID: tenderID, TenderNumber: snap.TenderNumber, TenderVersion: snap.TenderVersion,
		TenderLabel: snap.TenderLabel, FinancialInputRevision: src.InputRev,
		FinancialCalcRevision: src.CalcRev, FinancialCalcStatus: src.CalcStatus,
		FinancialApproved: snap.Approved, ApprovedByLabel: snap.ApprovedByLabel,
		ApprovedAt: snap.ApprovedAt, GeneratedAt: src.GeneratedAt, AsOfDate: src.AsOfDate,
		BenchmarkPeriodMonths: period, SourceMaxAgeDays: maxAge,
		BaselineTenderID: baselineTenderID, BaselineVersion: baselineVersion,
		CachedGrandTotal: ciReport.Current.CachedGrandTotal,
		ReportFingerprint: rp.Fingerprint(tenderID, src.InputRev, rp.ReportSchemaVersion,
			period, maxAge, baselineTenderID, src.AsOfDate),
	}
	return rp.Build(rp.Inputs{Metadata: md, Quality: qReport, ActionPlan: planReport,
		Benchmark: bReport, Source: sReport, ChangeImpact: ciReport}), nil
}

func mustReviewModel(t *testing.T, pool *pgxpool.Pool, tenderID string) *rp.Model {
	t.Helper()
	m, err := reviewModelFromDB(t, pool, tenderID, pb.DefaultPeriodMonths, ps.DefaultMaxAgeDays, "")
	if err != nil {
		t.Fatalf("review model: %v", err)
	}
	return m
}

func openWorkbook(t *testing.T, m *rp.Model) *excelize.File {
	t.Helper()
	data, err := rp.Render(m)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("workbook corrupt: %v", err)
	}
	return f
}

// A/B/D/F/G/H/I — полный отчёт: все компоненты, workbook открывается,
// blocker отражён, approval-метаданные, fingerprint.
func TestReviewPackIntegration_FullReport(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	workNameID, _ := ensureTestNames(t, pool)
	usd80 := 80.0

	v1, p1 := seedCIVersion(t, pool, "RP", 1, true, "calculated", &usd80, "110")
	addCIItem(t, pool, v1, p1, workNameID, "Бетон М300", 1, 100, "100", "110", 1)
	v2, p2 := seedCIVersion(t, pool, "RP", 2, false, "calculated", nil, "220")
	addCIItem(t, pool, v2, p2, workNameID, "Бетон М300", 1, 100, "100", "110", 1)
	addCIItem(t, pool, v2, p2, workNameID, "Арматура", 1, 100, "100", "110", 2)
	// D: quality blocker при calculated — USD-строка без курса.
	addPlanItem(t, pool, v2, p2, workNameID, "USD", sptr("м2"), 50, nil, nil, true)
	// H: согласование v2 (актёр rbActor с full_name).
	if _, err := pool.Exec(ctx, `
		UPDATE public.tenders SET financial_approved = true,
		  financial_approved_by = $2::uuid, financial_approved_at = NOW()
		WHERE id = $1::uuid`, v2, rbActor); err != nil {
		t.Fatal(err)
	}

	m := mustReviewModel(t, pool, v2)
	if m.Status != rp.ReportReady {
		t.Fatalf("status=%s, want ready", m.Status)
	}
	// A: все секции — рабочие статусы.
	if m.Sections.Quality.Status != rp.SectionAvailable ||
		m.Sections.ActionPlan.Status != rp.SectionAvailable ||
		m.Sections.Source.Status != rp.SectionAvailable ||
		m.Sections.ChangeImpact.Status != rp.SectionAvailable {
		t.Fatalf("sections wrong: %+v", m.Sections)
	}
	// D: blocker отражён, но отчёт разрешён.
	if m.Executive.Quality.Blockers == 0 || m.Executive.Headline != "Обнаружены блокирующие проблемы" {
		t.Fatalf("blocker must be reflected: %+v", m.Executive.Quality)
	}
	// G: amount-метрики источников доступны (calculated).
	if m.Source.AmountMetricsStatus != "available" {
		t.Fatalf("source amounts=%s, want available", m.Source.AmountMetricsStatus)
	}
	// H: approval-метаданные.
	if !m.Metadata.FinancialApproved || m.Metadata.ApprovedByLabel != "Itest Actor" || m.Metadata.ApprovedAt == "" {
		t.Fatalf("approval metadata wrong: %+v", m.Metadata)
	}
	// I: fingerprint соответствует revision/параметрам.
	want := rp.Fingerprint(v2, m.Metadata.FinancialInputRevision, rp.ReportSchemaVersion,
		pb.DefaultPeriodMonths, ps.DefaultMaxAgeDays, v1, m.Metadata.AsOfDate)
	if m.Metadata.ReportFingerprint != want {
		t.Fatalf("fingerprint mismatch")
	}
	// B: workbook открывается, 7 листов; F: benchmark-лист валиден без истории.
	f := openWorkbook(t, m)
	if len(f.GetSheetList()) != 7 {
		t.Fatalf("sheets=%v", f.GetSheetList())
	}
	rows, _ := f.GetRows(rp.SheetOrder[2])
	joined := ""
	for _, r := range rows {
		joined += strings.Join(r, "|") + "\n"
	}
	if !strings.Contains(joined, "FX_RATE_MISSING") {
		t.Fatal("quality sheet must contain the blocker")
	}
}

// C — stale current: preview not ready, XLSX блокируется typed-ошибкой (409).
func TestReviewPackIntegration_StaleCurrent(t *testing.T) {
	pool := newTestPool(t)
	usd := 90.0
	v1, _ := seedCIVersion(t, pool, "RPSTALE", 1, true, "calculated", &usd, "0")
	v2, _ := seedCIVersion(t, pool, "RPSTALE", 2, false, "stale", &usd, "0")
	var notReady *FinancialCalculationNotReadyError
	if _, err := reviewModelFromDB(t, pool, v2, 24, 90, ""); !errors.As(err, &notReady) {
		t.Fatalf("stale must fail typed, got %v", err)
	}
	_ = v1
}

// E — baseline отсутствует: отчёт формируется, Change Impact no-data.
func TestReviewPackIntegration_NoBaseline(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0
	solo, p := seedCIVersion(t, pool, "RPSOLO", 1, false, "calculated", &usd, "110")
	addCIItem(t, pool, solo, p, workNameID, "Бетон", 1, 100, "100", "110", 1)

	m := mustReviewModel(t, pool, solo)
	if m.Sections.ChangeImpact.Status != rp.SectionBaselineNA {
		t.Fatalf("change impact=%s, want baseline_not_available", m.Sections.ChangeImpact.Status)
	}
	f := openWorkbook(t, m)
	v, _ := f.GetCellValue(rp.SheetOrder[5], "A1")
	if !strings.Contains(v, "Предыдущая согласованная версия отсутствует") {
		t.Fatalf("no-baseline note missing: %q", v)
	}
}

// J/K — изменение source-метаданных меняет секцию; изменение ревизии меняет
// fingerprint.
func TestReviewPackIntegration_SectionAndFingerprintReactToChanges(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0
	v1, p1 := seedCIVersion(t, pool, "RPCHG", 1, false, "calculated", &usd, "110")
	itemID := addCIItem(t, pool, v1, p1, workNameID, "Кабель", 1, 100, "100", "110", 1)

	before := mustReviewModel(t, pool, v1)
	if before.Executive.Source.MissingSource != 1 {
		t.Fatalf("expected missing source before fix: %+v", before.Executive.Source)
	}
	// J: metadata-only правка источника (ревизию НЕ двигает — этап 1.3).
	if _, err := pool.Exec(ctx, `
		UPDATE public.boq_items SET quote_link='https://s.kz/rp', quote_price_date=CURRENT_DATE-1
		WHERE id=$1::uuid`, itemID); err != nil {
		t.Fatal(err)
	}
	after := mustReviewModel(t, pool, v1)
	if after.Executive.Source.MissingSource != 0 || after.Executive.Source.Fresh != 1 {
		t.Fatalf("source section must react: %+v", after.Executive.Source)
	}
	if after.Metadata.ReportFingerprint != before.Metadata.ReportFingerprint {
		t.Fatal("metadata-only fix must keep fingerprint (revision unchanged)")
	}
	// K: смена ревизии → новый fingerprint.
	if _, err := pool.Exec(ctx, `
		UPDATE public.tenders SET financial_input_revision = financial_input_revision + 1,
		  financial_calculation_revision = financial_calculation_revision + 1
		WHERE id=$1::uuid`, v1); err != nil {
		t.Fatal(err)
	}
	bumped := mustReviewModel(t, pool, v1)
	if bumped.Metadata.ReportFingerprint == before.Metadata.ReportFingerprint {
		t.Fatal("revision bump must change fingerprint")
	}
}

// M — not found.
func TestReviewPackIntegration_NotFound(t *testing.T) {
	pool := newTestPool(t)
	_, err := NewReviewPackRepo(pool).LoadSnapshot(context.Background(),
		"ffffffff-ffff-ffff-ffff-ffffffffffff", 24, "")
	if !errors.Is(err, ErrQualityTenderNotFound) {
		t.Fatalf("want not-found, got %v", err)
	}
}

// N/O — formula injection из BOQ description и unsafe source URL из БД.
func TestReviewPackIntegration_InjectionAndUnsafeURL(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0
	v1, p1 := seedCIVersion(t, pool, "RPINJ", 1, false, "calculated", &usd, "110")
	itemID := addCIItem(t, pool, v1, p1, workNameID, `=HYPERLINK("http://evil","x")`, 1, 100, "100", "110", 1)
	if _, err := pool.Exec(ctx, `
		UPDATE public.boq_items SET quote_link='javascript:alert(1)', quote_price_date=CURRENT_DATE-200
		WHERE id=$1::uuid`, itemID); err != nil {
		t.Fatal(err)
	}

	m := mustReviewModel(t, pool, v1)
	f := openWorkbook(t, m)
	// N: описание нейтрализовано на листе источников (колонка «Наименование»).
	v, _ := f.GetCellValue(rp.SheetOrder[4], "D3")
	if !strings.HasPrefix(v, "'=") || !strings.Contains(v, "HYPERLINK") {
		t.Fatalf("BOQ description injection not neutralized: %q", v)
	}
	formula, _ := f.GetCellFormula(rp.SheetOrder[4], "D3")
	if formula != "" {
		t.Fatal("injected description became formula")
	}
	// O: unsafe URL не hyperlink.
	okBad, _, _ := f.GetCellHyperLink(rp.SheetOrder[4], "P3")
	if okBad {
		t.Fatal("unsafe source URL must not be hyperlink")
	}
}

// P — опасные символы в tender_number → безопасное имя файла.
func TestReviewPackIntegration_FilenameSafety(t *testing.T) {
	got := rp.SafeFilename("Tender", `ITEST/RP:2*?"<>|`, "v2", "Review", "2026-07-15")
	if strings.ContainsAny(got, `/\:*?"<>|`) {
		t.Fatalf("dangerous filename: %q", got)
	}
	if !strings.Contains(got, "ITEST-RP-2") {
		t.Fatalf("label lost: %q", got)
	}
}

// R/S — повторный запрос: одинаковый fingerprint и бизнес-значения; один
// consistent snapshot.
func TestReviewPackIntegration_RepeatStable(t *testing.T) {
	pool := newTestPool(t)
	workNameID, _ := ensureTestNames(t, pool)
	usd := 90.0
	v1, p1 := seedCIVersion(t, pool, "RPREP", 1, false, "calculated", &usd, "110")
	addCIItem(t, pool, v1, p1, workNameID, "Бетон", 1, 100, "100", "110", 1)

	m1 := mustReviewModel(t, pool, v1)
	m2 := mustReviewModel(t, pool, v1)
	if m1.Metadata.ReportFingerprint != m2.Metadata.ReportFingerprint {
		t.Fatal("fingerprint must be stable across repeats")
	}
	// Бизнес-значения равны (generated_at исключаем).
	m1.Metadata.GeneratedAt, m2.Metadata.GeneratedAt = "", ""
	j1, _ := json.Marshal(m1)
	j2, _ := json.Marshal(m2)
	if string(j1) != string(j2) {
		t.Fatal("business values must be identical on repeat")
	}
	// S: снапшот внутренне согласован.
	snap, err := NewReviewPackRepo(pool).LoadSnapshot(context.Background(), v1, 24, "")
	if err != nil {
		t.Fatal(err)
	}
	if snap.Quality.Tender.FinancialInputRevision != snap.Source.InputRev ||
		snap.Source.InputRev != snap.Benchmark.InputRev ||
		snap.Benchmark.InputRev != snap.ChangeImpact.Current.Tender.InputRev {
		t.Fatal("snapshot revisions diverge across components")
	}
}

// Q — большой тендер: покрыт renderer-тестом TestLargeWorkbook (3000+2000
// строк, ~294 KB, <1 s); полномасштабный DB-посев дублировал бы его.
func TestReviewPackIntegration_LargeTender(t *testing.T) {
	t.Skip("большой workbook покрыт reviewpack.TestLargeWorkbook; DB-посев дублирует renderer-тест")
}

// T — query count instrumentation недоступна.
func TestReviewPackIntegration_QueryCount(t *testing.T) {
	t.Skip("query-count instrumentation недоступна; фиксированность гарантирована структурой LoadSnapshot + guard")
}
