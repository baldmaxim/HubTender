package reviewpack

import (
	"encoding/json"
	"math"
	"strings"
	"testing"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/quality"
)

func fptr(v float64) *float64 { return &v }

func baseMeta() Metadata {
	return Metadata{
		TenderID: "T1", TenderNumber: "TN-1", TenderVersion: 4, TenderLabel: "Объект",
		FinancialInputRevision: 15, FinancialCalcRevision: 15, FinancialCalcStatus: "calculated",
		GeneratedAt: "2026-07-15T10:00:00Z", AsOfDate: "2026-07-15",
		BenchmarkPeriodMonths: 24, SourceMaxAgeDays: 90,
		CachedGrandTotal:  145000000,
		ReportFingerprint: Fingerprint("T1", 15, ReportSchemaVersion, 24, 90, "B1", "2026-07-15"),
	}
}

func fullInputs() Inputs {
	q := &quality.Report{Summary: quality.Summary{
		Blockers: 2, Warnings: 5, Information: 1,
		CalculationCompletenessPercent: 92.5, ReviewCompletenessPercent: 80,
		BoqItemsWithIssues: 7,
	}, Issues: []quality.Issue{{ID: "i1", Code: "FX_RATE_MISSING", Severity: "blocker",
		Category: "CURRENCY", EntityType: "tender", EntityID: "T1", Title: "t", Message: "m", FixHint: "f"}}}
	plan := &ap.Report{Summary: ap.Summary{
		ActionsTotal: 3, BlockingActions: 1, HighActions: 1, NormalActions: 1,
		AffectedBoqItems: 4, AmountRequiringReview: fptr(120000),
	}, Actions: []ap.Action{{ID: "a1", Rank: 1, Priority: "blocking", Source: "quality",
		Sources: []string{"quality"}, Code: "CALCULATION_STALE", Title: "t", Reason: "r",
		RecommendedAction: "rec", ImpactAmountStatus: "unavailable",
		Navigation: ap.Navigation{Type: ap.NavFinancialIndicators}}}}
	bench := &pb.Report{Summary: pb.Summary{
		EligibleItems: 40, BenchmarkedItems: 30, HighOutliers: 3, LowOutliers: 1,
		InsufficientHistory: 6, NotEligible: 4, WithinRange: 26, CoveragePercent: 75,
	}, Items: []pb.ItemBenchmark{
		{BoqItemID: "b1", ClientPositionID: "p1", Status: pb.StatusHighOutlier, Name: "Бетон", CurrentUnitCost: 300},
		{BoqItemID: "b2", ClientPositionID: "p1", Status: pb.StatusWithinRange, Name: "Арматура", CurrentUnitCost: 100},
	}}
	src := &ps.Report{Summary: ps.Summary{
		SourceCoveragePercent: 66.6, CurrentSourceCoveragePercent: 30,
		StaleItems: 2, ExpiredItems: 1, MissingSourceItems: 3, FreshItems: 5,
		AmountRequiringReview: fptr(50000),
	}, Items: []ps.Row{
		{BoqItemID: "s1", ClientPositionID: "p1", Status: ps.StatusStale, Severity: "warning", Name: "Кабель"},
		{BoqItemID: "s2", ClientPositionID: "p1", Status: ps.StatusFresh, Severity: "none", Name: "Труба"},
	}}
	baseVer := ci.VersionMeta{TenderID: "B1", Version: 3, ApprovedAt: "2026-06-01T00:00:00Z"}
	cimp := &ci.Report{Status: ci.ReportOK,
		Current:  ci.VersionMeta{TenderID: "T1", Version: 4, CachedGrandTotal: 145000000},
		Baseline: &baseVer,
		Summary: ci.Summary{GrandTotalDelta: 13000000, DirectTotalDelta: 9000000,
			CommercialMaterialDelta: 7000000, CommercialWorkDelta: 5500000, InsuranceDelta: 500000,
			ItemsAdded: 24, ItemsRemoved: 7, ItemsModified: 91, ItemsUnchanged: 200,
			IsReconciled: true, ReconciliationStatus: ci.ReconciliationOK},
		Items: []ci.ItemDiff{{ID: "row:b>c", Status: ci.StatusModified, Label: "Бетон",
			PositionLabel: "№1", Direction: "increase"}},
		Bridge: []ci.BridgeEntry{{Code: "INSURANCE", Label: "Страхование", Amount: 500000}},
	}
	return Inputs{Metadata: baseMeta(), Quality: q, ActionPlan: plan,
		Benchmark: bench, Source: src, ChangeImpact: cimp}
}

// 1. Report metadata.
func TestReportMetadata(t *testing.T) {
	m := Build(fullInputs())
	md := m.Metadata
	if md.ReportSchemaVersion != 1 || md.CalculationSource != "server" ||
		md.TenderNumber != "TN-1" || md.FinancialInputRevision != 15 {
		t.Fatalf("metadata wrong: %+v", md)
	}
}

// 2-5. Fingerprint stability и зависимости.
func TestFingerprintStability(t *testing.T) {
	f1 := Fingerprint("T1", 15, 1, 24, 90, "B1", "2026-07-15")
	f2 := Fingerprint("T1", 15, 1, 24, 90, "B1", "2026-07-15")
	if f1 != f2 || len(f1) != 64 {
		t.Fatalf("fingerprint unstable: %s vs %s", f1, f2)
	}
	// 3: generated_at не участвует — одинаковые входы в разное время равны
	// (generated_at вообще не параметр Fingerprint).
	if Fingerprint("T1", 16, 1, 24, 90, "B1", "2026-07-15") == f1 { // 4
		t.Fatal("fingerprint must change with revision")
	}
	if Fingerprint("T1", 15, 1, 12, 90, "B1", "2026-07-15") == f1 || // 5
		Fingerprint("T1", 15, 1, 24, 30, "B1", "2026-07-15") == f1 ||
		Fingerprint("T1", 15, 1, 24, 90, "B2", "2026-07-15") == f1 {
		t.Fatal("fingerprint must change with parameters/baseline")
	}
}

// 6-10. Summary mapping из готовых движков.
func TestSummaryMappings(t *testing.T) {
	m := Build(fullInputs())
	e := m.Executive
	if e.Quality.Blockers != 2 || e.Quality.Warnings != 5 || e.Quality.BoqItemsWithIssues != 7 {
		t.Fatalf("quality mapping wrong: %+v", e.Quality)
	}
	if e.ActionPlan.Blocking != 1 || *e.ActionPlan.AmountRequiringReview != 120000 {
		t.Fatalf("action plan mapping wrong: %+v", e.ActionPlan)
	}
	if e.Benchmark.HighOutliers != 3 || e.Benchmark.WithinRange != 26 || e.Benchmark.CoveragePercent != 75 {
		t.Fatalf("benchmark mapping wrong: %+v", e.Benchmark)
	}
	if e.Source.CoveragePercent != 66.6 || e.Source.MissingSource != 3 {
		t.Fatalf("source mapping wrong: %+v", e.Source)
	}
	if e.ChangeImpact.GrandTotalDelta != 13000000 || e.ChangeImpact.BaselineVersion != 3 ||
		e.ChangeImpact.Reconciliation != ci.ReconciliationOK {
		t.Fatalf("change impact mapping wrong: %+v", e.ChangeImpact)
	}
	if e.Headline != "Обнаружены блокирующие проблемы" {
		t.Fatalf("headline wrong: %s", e.Headline)
	}
}

// 11. Baseline unavailable → section status, не ошибка.
func TestBaselineUnavailableSection(t *testing.T) {
	in := fullInputs()
	in.ChangeImpact = ci.BaselineNotAvailableReport(
		ci.TenderState{ID: "T1", TenderNumber: "TN-1", Version: 1}, nil, "2026-07-15T10:00:00Z")
	m := Build(in)
	if m.Sections.ChangeImpact.Status != SectionBaselineNA {
		t.Fatalf("want baseline_not_available, got %s", m.Sections.ChangeImpact.Status)
	}
	if m.Status != ReportReady {
		t.Fatal("baseline NA must not fail whole report")
	}
}

// 12-13. Expected no-data vs unavailable.
func TestComponentNoDataAndUnavailable(t *testing.T) {
	in := fullInputs()
	in.Benchmark = nil
	m := Build(in)
	if m.Sections.Benchmark.Status != SectionNoData {
		t.Fatalf("nil benchmark → no_data, got %s", m.Sections.Benchmark.Status)
	}
	in2 := fullInputs()
	in2.Quality = nil // неожиданное отсутствие → unavailable (не clean)
	m2 := Build(in2)
	if m2.Sections.Quality.Status != SectionUnavailable {
		t.Fatal("missing quality must be explicit unavailable, not clean")
	}
	if m2.Executive.Quality.Blockers != 0 && m2.Sections.Quality.Status == SectionAvailable {
		t.Fatal("must not fabricate clean quality")
	}
}

// 15. Empty action plan.
func TestEmptyActionPlanHeadline(t *testing.T) {
	in := fullInputs()
	in.Quality = &quality.Report{}
	in.ActionPlan = &ap.Report{}
	in.Benchmark = &pb.Report{}
	in.Source = &ps.Report{}
	m := Build(in)
	if m.Executive.Headline != "Расчёт готов к проверке" {
		t.Fatalf("clean plan headline wrong: %s", m.Executive.Headline)
	}
}

// 21-22. Stable ordering / permutation: model — детерминированная проекция.
func TestModelDeterminism(t *testing.T) {
	j1, _ := json.Marshal(Build(fullInputs()))
	j2, _ := json.Marshal(Build(fullInputs()))
	if string(j1) != string(j2) {
		t.Fatal("same inputs must give identical model")
	}
}

// 23. No NaN/Inf.
func TestNoNaNInModel(t *testing.T) {
	m := Build(fullInputs())
	for _, v := range []float64{
		m.Executive.Benchmark.CoveragePercent, m.Executive.Source.CoveragePercent,
		m.Executive.ChangeImpact.GrandTotalDelta, m.Metadata.CachedGrandTotal,
	} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			t.Fatal("NaN/Inf in model")
		}
	}
}

// 25-30. Formula injection / control chars / обычный текст.
func TestSafeExcelText(t *testing.T) {
	cases := map[string]string{
		"=HYPERLINK(\"http://evil\")": "'=HYPERLINK(\"http://evil\")",
		"+cmd|' /C calc'!A0":          "'+cmd|' /C calc'!A0",
		"-2+3":                        "'-2+3",
		"@SUM(A1:A9)":                 "'@SUM(A1:A9)",
		"  =indented":                 "'  =indented",
		"Бетон М300 (обычный текст)": "Бетон М300 (обычный текст)",
	}
	for in, want := range cases {
		if got := SafeExcelText(in); got != want {
			t.Fatalf("SafeExcelText(%q)=%q, want %q", in, got, want)
		}
	}
	// 29: control chars удаляются, \n и \t сохраняются.
	if got := SafeExcelText("a\x00b\x07c\nd\te"); got != "abc\nd\te" {
		t.Fatalf("control chars: %q", got)
	}
}

// 31-32. Source URL safety переиспользует движок 1.3.
func TestSourceURLSafetyReused(t *testing.T) {
	ok := "https://supplier.kz/q.pdf"
	if ps.SafeSourceURL(&ok) == nil {
		t.Fatal("safe URL rejected")
	}
	bad := "javascript:alert(1)"
	if ps.SafeSourceURL(&bad) != nil {
		t.Fatal("unsafe URL accepted")
	}
}

// 33-34. Filename sanitization + длина.
func TestSafeFilename(t *testing.T) {
	got := SafeFilename("Tender", `12/3:*?"<>|`, "v4", "Review", "2026-07-15")
	if strings.ContainsAny(got, `/\:*?"<>|`) || strings.Contains(got, "..") {
		t.Fatalf("dangerous filename: %q", got)
	}
	if !strings.HasSuffix(got, ".xlsx") || !strings.Contains(got, "12-3") {
		t.Fatalf("filename lost label: %q", got)
	}
	long := SafeFilename("Tender", strings.Repeat("Ы", 500))
	if len([]rune(long)) > 130 {
		t.Fatalf("filename too long: %d runes", len([]rune(long)))
	}
	if SafeFilename("..", "..") == "...xlsx" {
		t.Fatal("path traversal survived")
	}
}

// 35. Row-count limit.
func TestRowLimitGuard(t *testing.T) {
	if err := guardRows("test", MaxDetailRowsPerSheet); err != nil {
		t.Fatal("limit itself must pass")
	}
	err := guardRows("test", MaxDetailRowsPerSheet+1)
	var tooLarge *ErrReportTooLarge
	if err == nil || !strings.Contains(err.Error(), "REVIEW_REPORT_TOO_LARGE") {
		t.Fatalf("limit exceeded must fail typed: %v", err)
	}
	_ = tooLarge
}
