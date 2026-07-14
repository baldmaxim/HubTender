package pricesource

import (
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"
)

// Этап 1.3 §14: чистые тесты freshness-движка. as-of фиксирован: 2026-07-14.

const asOf = "2026-07-14"

func f(v float64) *float64 { return &v }
func sp(v string) *string  { return &v }

func mkItem(id string, quote, priceDate, validUntil *string) Item {
	return Item{
		ID: id, ClientPositionID: "pos-1", BoqItemType: "мат", Name: "Тест",
		UnitCode: "шт", Quantity: f(10), UnitRate: f(100), TotalAmount: f(1000),
		QuoteLink: quote, PriceDate: priceDate, ValidUntil: validUntil,
	}
}

func classify(t *testing.T, it Item) (string, *int, *int) {
	t.Helper()
	asOfT, _ := time.Parse("2006-01-02", asOf)
	return Classify(&it, asOfT, DefaultMaxAgeDays, DefaultExpiringSoonDays)
}

// §14.1 — свежий источник.
func TestFresh(t *testing.T) {
	s, age, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-07-01"), nil))
	if s != StatusFresh || age == nil || *age != 13 {
		t.Fatalf("status=%s age=%v", s, age)
	}
}

// §14.2/3 — граница max_age_days.
func TestMaxAgeBoundary(t *testing.T) {
	// ровно 90 дней: 2026-07-14 - 90 = 2026-04-15 → FRESH
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-04-15"), nil)); s != StatusFresh {
		t.Fatalf("exactly max age: %s", s)
	}
	// 91 день → STALE
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-04-14"), nil)); s != StatusStale {
		t.Fatalf("max age + 1: %s", s)
	}
}

// §14.4/5 — expired граница.
func TestExpiredBoundary(t *testing.T) {
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-07-01"), sp("2026-07-13"))); s != StatusExpired {
		t.Fatalf("valid_until вчера: %s", s)
	}
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-07-01"), sp("2026-07-14"))); s == StatusExpired {
		t.Fatalf("valid_until сегодня не expired: %s", s)
	}
}

// §14.6/7 — expiring soon окно 14 дней.
func TestExpiringSoonWindow(t *testing.T) {
	if s, _, d := classify(t, mkItem("a", sp("https://x"), sp("2026-07-01"), sp("2026-07-28"))); s != StatusExpiringSoon || d == nil || *d != 14 {
		t.Fatalf("через 14 дней: %s / %v", s, d)
	}
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-07-01"), sp("2026-07-29"))); s != StatusFresh {
		t.Fatalf("через 15 дней: %s", s)
	}
}

// §14.8 — STALE приоритетнее EXPIRING_SOON.
func TestStaleBeatsExpiringSoon(t *testing.T) {
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-01-01"), sp("2026-07-20"))); s != StatusStale {
		t.Fatalf("stale+expiring: %s", s)
	}
}

// §14.9/10 — отсутствие источника / даты.
func TestMissing(t *testing.T) {
	if s, _, _ := classify(t, mkItem("a", nil, nil, nil)); s != StatusSourceMissing {
		t.Fatalf("no source: %s", s)
	}
	if s, _, _ := classify(t, mkItem("a", sp("  "), nil, nil)); s != StatusSourceMissing {
		t.Fatalf("blank source: %s", s)
	}
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), nil, nil)); s != StatusPriceDateMissing {
		t.Fatalf("no date: %s", s)
	}
}

// §14.11/12 — invalid dates.
func TestInvalidDates(t *testing.T) {
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-08-01"), nil)); s != StatusInvalidSourceDates {
		t.Fatalf("future price date: %s", s)
	}
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("2026-07-01"), sp("2026-06-01"))); s != StatusInvalidSourceDates {
		t.Fatalf("valid_until < price_date: %s", s)
	}
	if s, _, _ := classify(t, mkItem("a", sp("https://x"), sp("мусор"), nil)); s != StatusInvalidSourceDates {
		t.Fatalf("malformed date: %s", s)
	}
}

// §14.13/14 — NOT_APPLICABLE и coverage.
func TestNotApplicable(t *testing.T) {
	it := mkItem("a", nil, nil, nil)
	it.Quantity = f(0)
	if s, _, _ := classify(t, it); s != StatusNotApplicable {
		t.Fatalf("zero qty: %s", s)
	}
	// NOT_APPLICABLE не в знаменателе
	rep := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14,
		[]Item{it, mkItem("b", sp("https://x"), sp("2026-07-01"), nil)})
	if rep.Summary.PriceBearingItemsTotal != 1 || rep.Summary.SourceCoveragePercent != 100 {
		t.Fatalf("summary: %+v", rep.Summary)
	}
}

// §14.15 — пустой набор без NaN (policy: 100%).
func TestEmptySetPolicy(t *testing.T) {
	rep := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, nil)
	if rep.Summary.SourceCoveragePercent != 100 || rep.Summary.CurrentSourceCoveragePercent != 100 {
		t.Fatalf("empty policy: %+v", rep.Summary)
	}
	if math.IsNaN(rep.Summary.SourceCoveragePercent) {
		t.Fatal("NaN")
	}
}

// §14.16/19/20 — amount-метрики при current расчёте.
func TestAmountMetrics(t *testing.T) {
	items := []Item{
		mkItem("fresh", sp("https://x"), sp("2026-07-01"), nil),             // 1000 current
		mkItem("soon", sp("https://x"), sp("2026-07-01"), sp("2026-07-20")), // 1000 current+expiring
		mkItem("stale", sp("https://x"), sp("2026-01-01"), nil),             // 1000 review
		mkItem("missing", nil, nil, nil),                                    // 1000 review
	}
	rep := Evaluate("t", 5, 5, "calculated", "now", asOf, 90, 14, items)
	s := rep.Summary
	if rep.AmountMetricsStatus != "available" {
		t.Fatalf("amount status: %s", rep.AmountMetricsStatus)
	}
	if *s.PriceBearingDirectAmount != 4000 || *s.AmountWithSource != 3000 {
		t.Fatalf("amounts: %+v", s)
	}
	if *s.CurrentSourceAmount != 2000 || *s.AmountRequiringReview != 2000 {
		t.Fatalf("current/review: %v/%v", *s.CurrentSourceAmount, *s.AmountRequiringReview)
	}
	if *s.ExpiringSoonAmount != 1000 { // отдельно, не в review
		t.Fatalf("expiring amount: %v", *s.ExpiringSoonAmount)
	}
	if *s.SourceAmountCoveragePercent != 75 || *s.CurrentSourceAmountCoverage != 50 {
		t.Fatalf("amount coverage: %v/%v", *s.SourceAmountCoveragePercent, *s.CurrentSourceAmountCoverage)
	}
}

// §14.17/18 — stale financial state: amount unavailable, rows остаются.
func TestStaleFinancialState(t *testing.T) {
	items := []Item{mkItem("missing", nil, nil, nil)}
	rep := Evaluate("t", 6, 5, "stale", "now", asOf, 90, 14, items)
	if rep.AmountMetricsStatus != "unavailable" || rep.AmountMetricsNote == "" {
		t.Fatalf("amount must be unavailable: %+v", rep)
	}
	if rep.Summary.PriceBearingDirectAmount != nil || rep.Summary.AmountRequiringReview != nil {
		t.Fatal("amount totals must be nil when unavailable")
	}
	// §18: row-based issues не скрыты
	if rep.Summary.MissingSourceItems != 1 || len(rep.Items) != 1 || rep.Items[0].Status != StatusSourceMissing {
		t.Fatalf("row issues hidden: %+v", rep.Summary)
	}
	if rep.Items[0].TotalAmount != nil {
		t.Fatal("row amount must be hidden when unavailable")
	}
}

// §14.21/23 — приоритет статусов и стабильный порядок вывода.
func TestOrdering(t *testing.T) {
	items := []Item{
		mkItem("fresh", sp("https://x"), sp("2026-07-01"), nil),
		mkItem("expired", sp("https://x"), sp("2026-05-01"), sp("2026-06-01")),
		mkItem("soon", sp("https://x"), sp("2026-07-01"), sp("2026-07-20")),
		mkItem("invalid", sp("https://x"), sp("2026-09-01"), nil),
		mkItem("missing", nil, nil, nil),
	}
	rep := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, items)
	got := []string{}
	for _, r := range rep.Items {
		got = append(got, r.Status)
	}
	want := []string{StatusInvalidSourceDates, StatusExpired, StatusSourceMissing, StatusExpiringSoon, StatusFresh}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("order: %v", got)
	}
}

// §14.22/24 — перестановка входа не меняет результат; повтор идентичен.
func TestDeterminism(t *testing.T) {
	items := []Item{
		mkItem("b", sp("https://x"), sp("2026-01-01"), nil),
		mkItem("a", nil, nil, nil),
		mkItem("c", sp("https://x"), sp("2026-07-01"), nil),
	}
	r1 := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, items)
	perm := []Item{items[2], items[0], items[1]}
	r2 := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, perm)
	if !reflect.DeepEqual(r1.Items, r2.Items) || !reflect.DeepEqual(r1.Summary, r2.Summary) {
		t.Fatal("permutation changed result")
	}
	r3 := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, items)
	if !reflect.DeepEqual(r1, r3) {
		t.Fatal("repeat differs")
	}
}

// §14.25 — другой as-of корректно меняет возраст/статус.
func TestAsOfChangesAge(t *testing.T) {
	it := mkItem("a", sp("https://x"), sp("2026-04-15"), nil)
	if s, _, _ := classify(t, it); s != StatusFresh {
		t.Fatal("fresh at 2026-07-14")
	}
	later, _ := time.Parse("2006-01-02", "2026-08-01")
	if s, age, _ := Classify(&it, later, 90, 14); s != StatusStale || *age != 108 {
		t.Fatalf("later as-of: %s/%v", s, age)
	}
}

// §14.26/27 — URL safety.
func TestURLSafety(t *testing.T) {
	if SafeSourceURL(sp("javascript:alert(1)")) != nil {
		t.Fatal("javascript: must be blocked")
	}
	if SafeSourceURL(sp("data:text/html,x")) != nil {
		t.Fatal("data: must be blocked")
	}
	if SafeSourceURL(sp("file:///etc/passwd")) != nil {
		t.Fatal("file: must be blocked")
	}
	if SafeSourceURL(sp("https://supplier.example/kp.pdf")) == nil {
		t.Fatal("https must pass")
	}
	if SafeSourceURL(sp("http://intranet/kp")) == nil {
		t.Fatal("http must pass (existing model allows)")
	}
	// небезопасная ссылка: строка всё равно классифицируется по датам, но
	// active link отсутствует
	rep := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14,
		[]Item{mkItem("a", sp("javascript:alert(1)"), sp("2026-07-01"), nil)})
	if rep.Items[0].SourceURL != nil {
		t.Fatal("unsafe url leaked as active link")
	}
	if rep.Items[0].Status != StatusFresh {
		t.Fatalf("classification must not depend on scheme: %s", rep.Items[0].Status)
	}
}

// §14.28 — много строк без NaN/Inf; §13 perf.
func TestScaleNoNaN(t *testing.T) {
	items := make([]Item, 0, 5000)
	for i := 0; i < 5000; i++ {
		var q, pd, vu *string
		switch i % 5 {
		case 0:
			q, pd = sp(fmt.Sprintf("https://s/%d", i%50)), sp("2026-07-01")
		case 1:
			q, pd, vu = sp("https://shared"), sp("2026-07-01"), sp("2026-07-20")
		case 2:
			q, pd = sp("https://old"), sp("2025-01-01")
		case 3:
			q = sp("https://nodate")
		}
		it := mkItem(fmt.Sprintf("i-%05d", i), q, pd, vu)
		it.TotalAmount = f(float64(i + 1))
		items = append(items, it)
	}
	start := time.Now()
	rep := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, items)
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("5k rows took %v", d)
	}
	for _, v := range []*float64{rep.Summary.SourceAmountCoveragePercent, rep.Summary.CurrentSourceAmountCoverage} {
		if v != nil && (math.IsNaN(*v) || math.IsInf(*v, 0)) {
			t.Fatal("NaN/Inf in coverage")
		}
	}
}

// §14.29 — общий источник классифицируется одинаково на всех строках.
func TestSharedSourceConsistent(t *testing.T) {
	a := mkItem("a", sp("https://shared/kp"), sp("2026-01-01"), nil)
	b := mkItem("b", sp("https://shared/kp"), sp("2026-01-01"), nil)
	rep := Evaluate("t", 1, 1, "calculated", "now", asOf, 90, 14, []Item{a, b})
	if rep.Items[0].Status != StatusStale || rep.Items[1].Status != StatusStale {
		t.Fatalf("shared source diverged: %s/%s", rep.Items[0].Status, rep.Items[1].Status)
	}
	if rep.Summary.DistinctSourcesCount != 1 {
		t.Fatalf("distinct sources: %d", rep.Summary.DistinctSourcesCount)
	}
}

// §14.30 — metadata-only семантика фиксируется repo-слоем (isQuoteMetadataOnlyPatch)
// и интеграционным тестом O; движок финансовое состояние только читает.
func TestEngineDoesNotJudgeFinancialState(t *testing.T) {
	rep := Evaluate("t", 7, 7, "calculated", "now", asOf, 90, 14, nil)
	if rep.FinancialInputRevision != 7 || rep.FinancialCalculationStatus != "calculated" {
		t.Fatal("engine must pass state through untouched")
	}
}
