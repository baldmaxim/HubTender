package actionplan

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"strings"
	"testing"
	"time"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/quality"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

func qIssue(code, severity, category, entityType, entityID, posID, field string, affected []string) quality.Issue {
	return quality.Issue{
		ID:   code + "|" + entityType + "|" + entityID + "|" + field,
		Code: code, Severity: severity, Category: category,
		EntityType: entityType, EntityID: entityID, ClientPositionID: posID,
		Field: field, Title: "t:" + code, Message: "m:" + code, FixHint: "f:" + code,
		AffectedItemIDs: affected, AffectedCount: len(affected),
	}
}

func pbOutlier(id, posID, status string) pb.ItemBenchmark {
	med := 100.0
	dev := 50.0
	return pb.ItemBenchmark{
		BoqItemID: id, ClientPositionID: posID, Status: status,
		CurrentUnitCost: 150, Median: &med, DeviationFromMedianPercent: &dev,
		HistoricalTendersCount: 6, Message: "msg", ReviewHint: "hint",
	}
}

func pbNotEligible(id, posID, reason string) pb.ItemBenchmark {
	return pb.ItemBenchmark{
		BoqItemID: id, ClientPositionID: posID,
		Status: pb.StatusNotEligible, NotEligibleReason: reason,
	}
}

func psRow(id, posID, status string) ps.Row {
	return ps.Row{
		BoqItemID: id, ClientPositionID: posID, Status: status,
		Severity: ps.SeverityWarning, Message: "src:" + status,
	}
}

func baseInputs() Inputs {
	return Inputs{
		TenderID: "T1", InputRev: 5, CalcRev: 5, CalcStatus: "calculated",
		GeneratedAt: "2026-07-14T10:00:00Z", AsOfDate: "2026-07-14",
		PeriodMonths: 24, MaxAgeDays: 90,
		Quality:   &quality.Report{Summary: quality.Summary{BoqItemsTotal: 3}},
		Benchmark: &pb.Report{},
		Source:    &ps.Report{},
		Items: []ItemInfo{
			{ID: "i1", ClientPositionID: "p1", SortIndex: 0, TotalAmount: fptr(1000)},
			{ID: "i2", ClientPositionID: "p1", SortIndex: 1, TotalAmount: fptr(500)},
			{ID: "i3", ClientPositionID: "p2", SortIndex: 2, TotalAmount: fptr(200)},
		},
	}
}

func actionByCode(t *testing.T, r *Report, code string) *Action {
	t.Helper()
	for i := range r.Actions {
		if r.Actions[i].Code == code {
			return &r.Actions[i]
		}
	}
	t.Fatalf("action %s not found; have %d actions", code, len(r.Actions))
	return nil
}

// ─── 1-3: quality severity mapping ───────────────────────────────────────────

func TestQualityBlockerBecomesBlocking(t *testing.T) { // §16.1
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("FX_RATE_MISSING", quality.SeverityBlocker, quality.CategoryCurrency, "tender", "T1", "", "usd_rate", []string{"i1"}),
	}
	r := Compose(in)
	a := actionByCode(t, r, "FX_RATE_MISSING")
	if a.Priority != PriorityBlocking || r.Summary.BlockingActions != 1 {
		t.Fatalf("blocker must map to blocking: %+v", a)
	}
}

func TestQualityWarningMapping(t *testing.T) { // §16.2
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("QUANTITY_ZERO", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", "i1", "p1", "quantity", nil),
		qIssue("UNIT_RATE_ZERO", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", "i2", "p1", "unit_rate", nil),
		qIssue("EXACT_DUPLICATE_GROUP", quality.SeverityWarning, quality.CategoryDuplicates, "client_position", "p1", "p1", "", []string{"i1", "i2"}),
		qIssue("UNIT_CODE_MISSING", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", "i3", "p2", "unit_code", nil),
	}
	r := Compose(in)
	for code, want := range map[string]string{
		"QUANTITY_ZERO": PriorityHigh, "UNIT_RATE_ZERO": PriorityHigh,
		"EXACT_DUPLICATE_GROUP": PriorityHigh, "UNIT_CODE_MISSING": PriorityNormal,
	} {
		if got := actionByCode(t, r, code).Priority; got != want {
			t.Fatalf("%s: priority=%s, want %s", code, got, want)
		}
	}
}

func TestQualityInformationBecomesLow(t *testing.T) { // §16.3
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("DESCRIPTION_EMPTY", quality.SeverityInformation, quality.CategoryBoqInput, "boq_item", "i1", "p1", "description", nil),
	}
	r := Compose(in)
	if actionByCode(t, r, "DESCRIPTION_EMPTY").Priority != PriorityLow {
		t.Fatal("information must map to low")
	}
}

// ─── 4-8: benchmark mapping ──────────────────────────────────────────────────

func TestHighAndLowOutlierAreHigh(t *testing.T) { // §16.4-5
	in := baseInputs()
	in.Benchmark.Items = []pb.ItemBenchmark{
		pbOutlier("i1", "p1", pb.StatusHighOutlier),
		pbOutlier("i2", "p1", pb.StatusLowOutlier),
	}
	r := Compose(in)
	if actionByCode(t, r, "HIGH_OUTLIER").Priority != PriorityHigh ||
		actionByCode(t, r, "LOW_OUTLIER").Priority != PriorityHigh {
		t.Fatal("outliers must be high")
	}
	// §16.42 / §5: не blocker.
	for _, a := range r.Actions {
		if a.Source == SourcePriceBenchmark && a.Priority == PriorityBlocking {
			t.Fatal("price anomaly must never be blocking")
		}
	}
}

func TestWithinRangeAndInsufficientHistoryNoAction(t *testing.T) { // §16.6-7
	in := baseInputs()
	in.Benchmark.Items = []pb.ItemBenchmark{
		{BoqItemID: "i1", ClientPositionID: "p1", Status: pb.StatusWithinRange},
		{BoqItemID: "i2", ClientPositionID: "p1", Status: pb.StatusInsufficientHistory},
	}
	in.Benchmark.Summary.WithinRange = 1
	in.Benchmark.Summary.InsufficientHistory = 1
	r := Compose(in)
	if len(r.Actions) != 0 {
		t.Fatalf("context statuses must not create actions: %+v", r.Actions)
	}
	if r.Summary.PriceItemsWithinRange != 1 || r.Summary.PriceItemsInsufficientHistory != 1 {
		t.Fatal("contextual counts lost")
	}
}

func TestNotEligibleIdentityBecomesNormalAction(t *testing.T) { // §16.8
	in := baseInputs()
	in.Benchmark.Items = []pb.ItemBenchmark{
		pbNotEligible("i1", "p1", "INSUFFICIENT_IDENTITY: нет номенклатурной привязки (material/work name)"),
		pbNotEligible("i2", "p1", "NOT_ELIGIBLE: количество не задано или не положительно"), // метрика → нет action
	}
	r := Compose(in)
	if len(r.Actions) != 1 {
		t.Fatalf("want exactly 1 identity action, got %d", len(r.Actions))
	}
	a := &r.Actions[0]
	if a.Code != "BENCHMARK_IDENTITY_MISSING" || a.Priority != PriorityNormal {
		t.Fatalf("identity action wrong: %+v", a)
	}
}

// ─── 9-16: price source mapping ──────────────────────────────────────────────

func TestSourceStatusMapping(t *testing.T) { // §16.9-14
	in := baseInputs()
	in.Source.Items = []ps.Row{
		psRow("i1", "p1", ps.StatusSourceMissing),
		psRow("i2", "p1", ps.StatusExpired),
		psRow("i3", "p2", ps.StatusInvalidSourceDates),
		psRow("i1", "p1", ps.StatusStale),
		psRow("i2", "p1", ps.StatusPriceDateMissing),
		psRow("i3", "p2", ps.StatusExpiringSoon),
	}
	r := Compose(in)
	for code, want := range map[string]string{
		ps.StatusSourceMissing: PriorityHigh, ps.StatusExpired: PriorityHigh,
		ps.StatusInvalidSourceDates: PriorityHigh, ps.StatusStale: PriorityNormal,
		ps.StatusPriceDateMissing: PriorityNormal, ps.StatusExpiringSoon: PriorityLow,
	} {
		if got := actionByCode(t, r, code).Priority; got != want {
			t.Fatalf("%s: priority=%s, want %s", code, got, want)
		}
	}
	for _, a := range r.Actions { // никогда не blocking
		if a.Source == SourcePriceSource && a.Priority == PriorityBlocking {
			t.Fatal("source freshness must never be blocking")
		}
	}
}

func TestFreshAndNotApplicableNoAction(t *testing.T) { // §16.15-16
	in := baseInputs()
	in.Source.Items = []ps.Row{
		psRow("i1", "p1", ps.StatusFresh),
		psRow("i2", "p1", ps.StatusNotApplicable),
	}
	in.Source.Summary.FreshItems = 1
	r := Compose(in)
	if len(r.Actions) != 0 {
		t.Fatalf("FRESH/NOT_APPLICABLE must not create actions: %+v", r.Actions)
	}
	if r.Summary.PriceSourcesFresh != 1 || r.Summary.PriceSourcesNotApplicable != 1 {
		t.Fatal("contextual source counts lost")
	}
}

// ─── 17-19: merge rules ──────────────────────────────────────────────────────

func TestBenchmarkUnavailableNotDuplicatedAsAction(t *testing.T) { // §16.17, rule A
	in := baseInputs()
	in.CalcStatus = "stale"
	in.CalcRev = 4
	in.Benchmark = nil // расчёт не актуален → компонент, не action
	in.Quality.Issues = []quality.Issue{
		qIssue("CALCULATION_STALE", quality.SeverityBlocker, quality.CategoryCalculationState, "tender", "T1", "", "", nil),
	}
	r := Compose(in)
	if len(r.Actions) != 1 || r.Actions[0].Code != "CALCULATION_STALE" {
		t.Fatalf("only quality blocker expected, got %+v", r.Actions)
	}
	if r.Components.PriceBenchmark.Status != ComponentCalculationNotReady {
		t.Fatalf("component=%s, want calculation_not_ready", r.Components.PriceBenchmark.Status)
	}
}

func TestNomenclatureMergeCombinesSources(t *testing.T) { // §16.18, rule B
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("UNIT_CODE_MISSING", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", "i1", "p1", "unit_code", nil),
	}
	in.Benchmark.Items = []pb.ItemBenchmark{
		pbNotEligible("i1", "p1", "INSUFFICIENT_IDENTITY: не указана единица измерения"),
	}
	r := Compose(in)
	if len(r.Actions) != 1 {
		t.Fatalf("must merge into ONE action, got %d", len(r.Actions))
	}
	a := &r.Actions[0]
	if len(a.Sources) != 2 || a.Sources[0] != SourceQuality || a.Sources[1] != SourcePriceBenchmark {
		t.Fatalf("sources=%v, want [quality price_benchmark]", a.Sources)
	}
	if a.ID != "merged:ITEM_IDENTITY_MISSING:i1:unit_code" { // §16.21 stable merged ID
		t.Fatalf("merged ID=%s", a.ID)
	}
}

func TestDuplicateGroupStaysOneAction(t *testing.T) { // §16.19, rule C
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("EXACT_DUPLICATE_GROUP", quality.SeverityWarning, quality.CategoryDuplicates, "client_position", "p1", "p1", "", []string{"i1", "i2"}),
	}
	r := Compose(in)
	if len(r.Actions) != 1 || len(r.Actions[0].BoqItemIDs) != 2 {
		t.Fatalf("duplicate group must stay one action with member IDs: %+v", r.Actions)
	}
	if r.Actions[0].Navigation.Type != NavDuplicateGroup || *r.Actions[0].Navigation.ItemID != "i1" {
		t.Fatalf("duplicate navigation → first row: %+v", r.Actions[0].Navigation)
	}
}

// ─── 20-25: stability / ordering / determinism ───────────────────────────────

func mixedInputs() Inputs {
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("FX_RATE_MISSING", quality.SeverityBlocker, quality.CategoryCurrency, "tender", "T1", "", "usd_rate", []string{"i1"}),
		qIssue("CALCULATION_STALE", quality.SeverityBlocker, quality.CategoryCalculationState, "tender", "T1", "", "", nil),
		qIssue("QUANTITY_ZERO", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", "i2", "p1", "quantity", nil),
		qIssue("DESCRIPTION_EMPTY", quality.SeverityInformation, quality.CategoryBoqInput, "boq_item", "i3", "p2", "description", nil),
	}
	in.Benchmark.Items = []pb.ItemBenchmark{pbOutlier("i1", "p1", pb.StatusHighOutlier)}
	in.Source.Items = []ps.Row{psRow("i3", "p2", ps.StatusSourceMissing)}
	return in
}

func TestStableActionIDs(t *testing.T) { // §16.20
	r1, r2 := Compose(mixedInputs()), Compose(mixedInputs())
	for i := range r1.Actions {
		if r1.Actions[i].ID != r2.Actions[i].ID {
			t.Fatalf("IDs unstable at %d: %s vs %s", i, r1.Actions[i].ID, r2.Actions[i].ID)
		}
		if strings.Contains(r1.Actions[i].ID, r1.GeneratedAt) {
			t.Fatal("ID must not depend on generated_at")
		}
	}
}

func TestStableOrderingAndRank(t *testing.T) { // §16.22-23
	r := Compose(mixedInputs())
	// blocking: CALCULATION_STATE раньше CURRENCY.
	if r.Actions[0].Code != "CALCULATION_STALE" || r.Actions[1].Code != "FX_RATE_MISSING" {
		t.Fatalf("blocking order wrong: %s, %s", r.Actions[0].Code, r.Actions[1].Code)
	}
	for i, a := range r.Actions {
		if a.Rank != i+1 {
			t.Fatalf("rank must be 1..N: at %d rank=%d", i, a.Rank)
		}
	}
	// приоритеты не возрастают.
	for i := 1; i < len(r.Actions); i++ {
		if priorityRank[r.Actions[i-1].Priority] > priorityRank[r.Actions[i].Priority] {
			t.Fatal("priority order violated")
		}
	}
}

func TestDeterministicRepeat(t *testing.T) { // §16.24
	j1, _ := json.Marshal(Compose(mixedInputs()))
	j2, _ := json.Marshal(Compose(mixedInputs()))
	if string(j1) != string(j2) {
		t.Fatal("same inputs must produce identical output")
	}
}

func TestInputPermutationDoesNotChangeOutput(t *testing.T) { // §16.25
	in1 := mixedInputs()
	in2 := mixedInputs()
	rnd := rand.New(rand.NewSource(7))
	rnd.Shuffle(len(in2.Quality.Issues), func(i, j int) {
		in2.Quality.Issues[i], in2.Quality.Issues[j] = in2.Quality.Issues[j], in2.Quality.Issues[i]
	})
	rnd.Shuffle(len(in2.Items), func(i, j int) {
		in2.Items[i], in2.Items[j] = in2.Items[j], in2.Items[i]
	})
	j1, _ := json.Marshal(Compose(in1).Actions)
	j2, _ := json.Marshal(Compose(in2).Actions)
	if string(j1) != string(j2) {
		t.Fatal("input permutation must not change composed actions")
	}
}

// ─── 26-31: impact amount ────────────────────────────────────────────────────

func TestKnownImpactAmount(t *testing.T) { // §16.26
	in := baseInputs()
	in.Source.Items = []ps.Row{psRow("i1", "p1", ps.StatusSourceMissing)}
	r := Compose(in)
	a := actionByCode(t, r, ps.StatusSourceMissing)
	if a.ImpactAmount == nil || *a.ImpactAmount != 1000 || a.ImpactAmountStatus != "available" {
		t.Fatalf("impact=%v/%s, want 1000/available", a.ImpactAmount, a.ImpactAmountStatus)
	}
}

func TestImpactUnavailableWhenStale(t *testing.T) { // §16.27
	in := baseInputs()
	in.CalcStatus = "stale"
	in.Benchmark = nil
	in.Source.Items = []ps.Row{psRow("i1", "p1", ps.StatusSourceMissing)}
	r := Compose(in)
	a := actionByCode(t, r, ps.StatusSourceMissing)
	if a.ImpactAmount != nil || a.ImpactAmountStatus != "unavailable" {
		t.Fatalf("stale: impact must be nil/unavailable: %v/%s", a.ImpactAmount, a.ImpactAmountStatus)
	}
	if r.Summary.AmountRequiringReview != nil || r.Summary.AmountMetricsStatus != "unavailable" {
		t.Fatal("summary amount must be unavailable at stale")
	}
}

func TestGroupImpactDoesNotDoubleCountItem(t *testing.T) { // §16.28
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("EXACT_DUPLICATE_GROUP", quality.SeverityWarning, quality.CategoryDuplicates,
			"client_position", "p1", "p1", "", []string{"i1", "i2", "i1"}), // i1 дважды
	}
	r := Compose(in)
	a := actionByCode(t, r, "EXACT_DUPLICATE_GROUP")
	if a.ImpactAmount == nil || *a.ImpactAmount != 1500 {
		t.Fatalf("impact=%v, want 1500 (i1 counted once)", a.ImpactAmount)
	}
}

func TestSummaryAmountCountsItemOnce(t *testing.T) { // §16.29
	in := baseInputs()
	// одна строка i1 в трёх действиях из трёх источников.
	in.Quality.Issues = []quality.Issue{
		qIssue("QUANTITY_ZERO", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", "i1", "p1", "quantity", nil),
	}
	in.Benchmark.Items = []pb.ItemBenchmark{pbOutlier("i1", "p1", pb.StatusHighOutlier)}
	in.Source.Items = []ps.Row{psRow("i1", "p1", ps.StatusStale)}
	r := Compose(in)
	if len(r.Actions) != 3 {
		t.Fatalf("want 3 actions, got %d", len(r.Actions))
	}
	if r.Summary.AmountRequiringReview == nil || *r.Summary.AmountRequiringReview != 1000 {
		t.Fatalf("summary amount=%v, want 1000 (union, not 3000)", r.Summary.AmountRequiringReview)
	}
	if r.Summary.AffectedBoqItems != 1 {
		t.Fatalf("affected items=%d, want 1", r.Summary.AffectedBoqItems)
	}
}

func TestTenderLevelActionAddsNoAmount(t *testing.T) { // §16.30
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("APPROVAL_ON_STALE_CALCULATION", quality.SeverityBlocker, quality.CategoryApproval, "tender", "T1", "", "", nil),
	}
	r := Compose(in)
	a := actionByCode(t, r, "APPROVAL_ON_STALE_CALCULATION")
	if a.ImpactAmount != nil || a.ImpactAmountStatus != "unavailable" {
		t.Fatalf("tender-level impact must be unavailable: %+v", a)
	}
	if r.Summary.AmountRequiringReview == nil || *r.Summary.AmountRequiringReview != 0 {
		t.Fatalf("summary amount=%v, want 0", r.Summary.AmountRequiringReview)
	}
}

// ─── 31-32: summary counts ───────────────────────────────────────────────────

func TestSummaryAndSourceCounts(t *testing.T) { // §16.31-32
	r := Compose(mixedInputs())
	s := r.Summary
	if s.ActionsTotal != 6 || s.BlockingActions != 2 || s.HighActions != 3 ||
		s.NormalActions != 0 || s.LowActions != 1 {
		t.Fatalf("summary counts wrong: %+v", s)
	}
	if s.ActionsBySource[SourceQuality] != 4 || s.ActionsBySource[SourcePriceBenchmark] != 1 ||
		s.ActionsBySource[SourcePriceSource] != 1 {
		t.Fatalf("source counts wrong: %+v", s.ActionsBySource)
	}
	if s.AffectedPositions != 2 {
		t.Fatalf("affected positions=%d, want 2", s.AffectedPositions)
	}
}

// ─── 33-36: filters/search/pagination живут в handler; здесь Summarize ───────

func TestSummarizeOnFilteredSubset(t *testing.T) { // §16.33 (substantive filters → summary)
	r := Compose(mixedInputs())
	var filtered []Action
	for _, a := range r.Actions {
		if a.Priority == PriorityBlocking {
			filtered = append(filtered, a)
		}
	}
	s := Summarize(filtered, r.ItemAmounts, r.AmountAvailable)
	if s.ActionsTotal != 2 || s.BlockingActions != 2 || s.HighActions != 0 {
		t.Fatalf("filtered summary wrong: %+v", s)
	}
}

func TestEmptyPlan(t *testing.T) { // §16.36
	r := Compose(baseInputs())
	if r.Summary.ActionsTotal != 0 || len(r.Actions) != 0 {
		t.Fatal("empty inputs must give empty plan")
	}
	if r.Summary.AmountRequiringReview == nil || *r.Summary.AmountRequiringReview != 0 {
		t.Fatalf("empty plan amount=%v, want 0 (available)", r.Summary.AmountRequiringReview)
	}
}

// ─── 37: navigation fallback ─────────────────────────────────────────────────

func TestUnknownCategoryNavigationFallback(t *testing.T) { // §16.37
	in := baseInputs()
	in.Quality.Issues = []quality.Issue{
		qIssue("SOME_FUTURE_CODE", quality.SeverityBlocker, "FUTURE_CATEGORY", "tender", "T1", "", "", nil),
	}
	r := Compose(in)
	if r.Actions[0].Navigation.Type != NavAnalyticsPage {
		t.Fatalf("unknown tender-level category must fall back to analytics_page, got %s", r.Actions[0].Navigation.Type)
	}
}

// ─── 38-39: component status ─────────────────────────────────────────────────

func TestComponentStatusBenchmarkNotReady(t *testing.T) { // §16.38
	in := baseInputs()
	in.CalcStatus = "calculating"
	in.Benchmark = nil
	r := Compose(in)
	c := r.Components
	if c.Quality.Status != ComponentAvailable || c.PriceSource.Status != ComponentAvailable {
		t.Fatal("quality/source must stay available")
	}
	if c.PriceBenchmark.Status != ComponentCalculationNotReady || c.PriceBenchmark.Note == "" {
		t.Fatalf("benchmark component wrong: %+v", c.PriceBenchmark)
	}
}

func TestPartialComponentIsNotCleanResult(t *testing.T) { // §16.39
	in := baseInputs()
	in.Quality = nil // компонент недоступен — НЕ «всё чисто»
	r := Compose(in)
	if r.Components.Quality.Status != ComponentUnavailable {
		t.Fatal("missing quality must be explicit unavailable")
	}
}

// ─── 40-41: performance / NaN ────────────────────────────────────────────────

func TestLargePlanNoQuadraticBehavior(t *testing.T) { // §16.40
	build := func(n int) Inputs {
		in := baseInputs()
		in.Quality = &quality.Report{Summary: quality.Summary{BoqItemsTotal: n}}
		in.Benchmark = &pb.Report{}
		in.Source = &ps.Report{}
		in.Items = make([]ItemInfo, n)
		for i := 0; i < n; i++ {
			id := fmt.Sprintf("i%06d", i)
			pos := fmt.Sprintf("p%04d", i/10)
			in.Items[i] = ItemInfo{ID: id, ClientPositionID: pos, SortIndex: i, TotalAmount: fptr(float64(100 + i%500))}
			switch i % 3 {
			case 0:
				in.Quality.Issues = append(in.Quality.Issues,
					qIssue("QUANTITY_ZERO", quality.SeverityWarning, quality.CategoryBoqInput, "boq_item", id, pos, "quantity", nil))
			case 1:
				in.Benchmark.Items = append(in.Benchmark.Items, pbOutlier(id, pos, pb.StatusHighOutlier))
			default:
				in.Source.Items = append(in.Source.Items, psRow(id, pos, ps.StatusStale))
			}
		}
		return in
	}
	measure := func(n int) time.Duration {
		in := build(n)
		start := time.Now()
		r := Compose(in)
		d := time.Since(start)
		if len(r.Actions) != n {
			t.Fatalf("want %d actions, got %d", n, len(r.Actions))
		}
		return d
	}
	d1 := measure(2500)
	d2 := measure(5000)
	if d2 > 2*time.Second {
		t.Fatalf("5000 actions took %v (>2s)", d2)
	}
	// анти-квадратичный контроль: 2× входа не должно давать ~4× время.
	if d1 > 20*time.Millisecond && d2 > d1*3+50*time.Millisecond {
		t.Fatalf("quadratic behavior: %v → %v", d1, d2)
	}
}

func TestNoNaNInfInSummary(t *testing.T) { // §16.41
	r := Compose(mixedInputs())
	if r.Summary.AmountRequiringReview != nil &&
		(math.IsNaN(*r.Summary.AmountRequiringReview) || math.IsInf(*r.Summary.AmountRequiringReview, 0)) {
		t.Fatal("NaN/Inf in summary amount")
	}
	for _, a := range r.Actions {
		if a.ImpactAmount != nil && (math.IsNaN(*a.ImpactAmount) || math.IsInf(*a.ImpactAmount, 0)) {
			t.Fatal("NaN/Inf in action impact")
		}
	}
}

// §16.42 покрыт в TestHighAndLowOutlierAreHigh + TestSourceStatusMapping:
// blocking приходит только из quality blocker-семантики.
func TestBlockingOnlyFromQuality(t *testing.T) {
	r := Compose(mixedInputs())
	for _, a := range r.Actions {
		if a.Priority == PriorityBlocking && a.Source != SourceQuality {
			t.Fatalf("blocking from non-quality source: %+v", a)
		}
	}
}
