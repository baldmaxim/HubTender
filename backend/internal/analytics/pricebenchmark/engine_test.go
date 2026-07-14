package pricebenchmark

import (
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"
)

// Этап 1.2 §13: чистые тесты движка бенчмарка. Все фикстуры детерминированы.

func f(v float64) *float64 { return &v }
func sp(v string) *string  { return &v }

func obsN(values ...float64) []Observation {
	out := make([]Observation, len(values))
	for i, v := range values {
		out[i] = Observation{
			TenderID: fmt.Sprintf("t-%02d", i), TenderLabel: fmt.Sprintf("T-%02d", i),
			Version: 1, ApprovedAt: fmt.Sprintf("2026-0%d-01T00:00:00Z", i%9+1),
			RepresentativeUnitCost: v, MatchedRowsCount: 1, QuantitySum: 1,
		}
	}
	return out
}

func item(id string, t string, nameID, unit *string, qty, total *float64, parent bool) CurrentItem {
	return CurrentItem{
		ID: id, ClientPositionID: "pos-1", BoqItemType: t, Name: "Тест",
		NameID: nameID, UnitCode: unit, Quantity: qty, StoredTotalAmount: total, HasParent: parent,
	}
}

// §13.1-6 — ключ: материал/работа, unit, name, parent.
func TestKey_ExactMatching(t *testing.T) {
	m1, ok, _ := BuildPriceBenchmarkKey("мат", sp("mn-1"), sp("м3"), false)
	if !ok {
		t.Fatal("material key must build")
	}
	w1, ok, _ := BuildPriceBenchmarkKey("раб", sp("wn-1"), sp("м2"), false)
	if !ok {
		t.Fatal("work key must build")
	}
	// 3. разные unit_code
	m2, _, _ := BuildPriceBenchmarkKey("мат", sp("mn-1"), sp("шт"), false)
	if m1 == m2 {
		t.Fatal("different unit codes must not match")
	}
	// 4. material vs work (разные типы)
	m3, _, _ := BuildPriceBenchmarkKey("раб", sp("mn-1"), sp("м3"), false)
	if m1 == m3 {
		t.Fatal("material and work must not match")
	}
	_ = w1
	// 5. разные name IDs
	m4, _, _ := BuildPriceBenchmarkKey("мат", sp("mn-2"), sp("м3"), false)
	if m1 == m4 {
		t.Fatal("different name ids must not match")
	}
	// 6. parent vs standalone
	m5, _, _ := BuildPriceBenchmarkKey("мат", sp("mn-1"), sp("м3"), true)
	if m1 == m5 {
		t.Fatal("child and standalone must not match")
	}
}

// §13.7-9 — eligibility.
func TestEligibility(t *testing.T) {
	items := []CurrentItem{
		item("no-name", "мат", nil, sp("м3"), f(1), f(100), false),      // 7
		item("zero-qty", "мат", sp("m"), sp("м3"), f(0), f(100), false), // 8
		item("neg-total", "мат", sp("m"), sp("м3"), f(1), f(0), false),  // 9
		item("no-unit", "мат", sp("m"), nil, f(1), f(100), false),
	}
	r := Evaluate("t", 1, 1, "calculated", 24, "now", items, nil)
	for _, it := range r.Items {
		if it.Status != StatusNotEligible {
			t.Fatalf("%s: status=%s, want NOT_ELIGIBLE", it.BoqItemID, it.Status)
		}
		if it.NotEligibleReason == "" {
			t.Fatalf("%s: missing reason", it.BoqItemID)
		}
	}
	if r.Summary.NotEligible != 4 || r.Summary.EligibleItems != 0 {
		t.Fatalf("summary: %+v", r.Summary)
	}
}

func evalOne(t *testing.T, current float64, obs []Observation) ItemBenchmark {
	t.Helper()
	key, _, _ := BuildPriceBenchmarkKey("мат", sp("mn-1"), sp("м3"), false)
	items := []CurrentItem{item("cur", "мат", sp("mn-1"), sp("м3"), f(1), f(current), false)}
	r := Evaluate("t", 1, 1, "calculated", 24, "now", items, map[Key][]Observation{key: obs})
	if len(r.Items) != 1 {
		t.Fatalf("items=%d", len(r.Items))
	}
	return r.Items[0]
}

// §13.10/11 — минимум 5 логических тендеров.
func TestMinTenders(t *testing.T) {
	if ib := evalOne(t, 100, obsN(90, 100, 110, 105)); ib.Status != StatusInsufficientHistory {
		t.Fatalf("4 tenders: %s", ib.Status)
	}
	if ib := evalOne(t, 100, obsN(90, 95, 100, 105, 110)); ib.Status != StatusWithinRange {
		t.Fatalf("5 tenders: %s", ib.Status)
	}
}

// §13.12-14 — median/квартели/IQR/fences (детерминированная интерполяция).
func TestStats(t *testing.T) {
	st := ComputeStats(obsN(10, 20, 30, 40, 50))
	if st.Median != 30 || st.P25 != 20 || st.P75 != 40 {
		t.Fatalf("median/p25/p75 = %v/%v/%v", st.Median, st.P25, st.P75)
	}
	if st.IQR != 20 || st.LowerFence != -10 || st.UpperFence != 70 {
		t.Fatalf("iqr/fences = %v/%v/%v", st.IQR, st.LowerFence, st.UpperFence)
	}
	if st.Minimum != 10 || st.Maximum != 50 {
		t.Fatalf("min/max = %v/%v", st.Minimum, st.Maximum)
	}
}

// §13.15-17 — классификация.
func TestClassification(t *testing.T) {
	obs := obsN(90, 95, 100, 105, 110) // p25=95 p75=105 iqr=10 fences 80..120
	if ib := evalOne(t, 121, obs); ib.Status != StatusHighOutlier {
		t.Fatalf("high: %s", ib.Status)
	}
	if ib := evalOne(t, 79, obs); ib.Status != StatusLowOutlier {
		t.Fatalf("low: %s", ib.Status)
	}
	if ib := evalOne(t, 100, obs); ib.Status != StatusWithinRange {
		t.Fatalf("within: %s", ib.Status)
	}
}

// §13.18/19 — IQR=0 + tolerance.
func TestIQRZero(t *testing.T) {
	obs := obsN(100, 100, 100, 100, 100)
	if ib := evalOne(t, 100.009, obs); ib.Status != StatusWithinRange {
		t.Fatalf("within tolerance: %s", ib.Status)
	}
	if ib := evalOne(t, 100.02, obs); ib.Status != StatusHighOutlier {
		t.Fatalf("above tolerance: %s", ib.Status)
	}
	if ib := evalOne(t, 99.98, obs); ib.Status != StatusLowOutlier {
		t.Fatalf("below tolerance: %s", ib.Status)
	}
}

// §13.20 — median<=0 не создаёт NaN и не классифицирует.
func TestMedianZeroSafe(t *testing.T) {
	ib := evalOne(t, 100, obsN(0, 0, 0, 0, 0))
	if ib.Status != StatusInsufficientHistory {
		t.Fatalf("invalid history status: %s", ib.Status)
	}
	if ib.DeviationFromMedianPercent != nil {
		t.Fatal("deviation must be nil for invalid median")
	}
}

// §13.21 — deviation percent.
func TestDeviation(t *testing.T) {
	ib := evalOne(t, 134.26, obsN(90, 95, 100, 105, 110))
	if ib.DeviationFromMedianPercent == nil || *ib.DeviationFromMedianPercent != 34.26 {
		t.Fatalf("deviation = %v", ib.DeviationFromMedianPercent)
	}
}

// §13.22-24 — стабильный порядок/статус; перестановка входа не меняет результат.
func TestDeterminism(t *testing.T) {
	key, _, _ := BuildPriceBenchmarkKey("мат", sp("mn-1"), sp("м3"), false)
	items := []CurrentItem{
		item("b", "мат", sp("mn-1"), sp("м3"), f(1), f(300), false),
		item("a", "мат", sp("mn-1"), sp("м3"), f(1), f(50), false),
		item("c", "мат", nil, sp("м3"), f(1), f(10), false),
	}
	obs := map[Key][]Observation{key: obsN(90, 95, 100, 105, 110)}
	r1 := Evaluate("t", 1, 1, "calculated", 24, "now", items, obs)

	perm := []CurrentItem{items[2], items[0], items[1]}
	obs2 := map[Key][]Observation{key: {obs[key][3], obs[key][0], obs[key][4], obs[key][2], obs[key][1]}}
	r2 := Evaluate("t", 1, 1, "calculated", 24, "now", perm, obs2)

	if !reflect.DeepEqual(r1.Items, r2.Items) {
		t.Fatalf("permutation changed result:\n%v\nvs\n%v", r1.Items, r2.Items)
	}
	if r1.Items[0].BoqItemID != "b" || r1.Items[0].Status != StatusHighOutlier {
		t.Fatalf("ordering: first=%s/%s", r1.Items[0].BoqItemID, r1.Items[0].Status)
	}
}

// §13.25 — десять одинаковых строк одного тендера = одна observation
// (representative формируется в SQL; здесь фиксируем контракт: одна
// Observation на тендер с MatchedRowsCount=10 не размножает выборку).
func TestPerTenderRepresentative(t *testing.T) {
	obs := obsN(100, 101, 102, 103)
	obs = append(obs, Observation{TenderID: "big", TenderLabel: "BIG", Version: 1,
		ApprovedAt: "2026-05-01T00:00:00Z", RepresentativeUnitCost: 500, MatchedRowsCount: 10, QuantitySum: 10})
	st := ComputeStats(obs)
	if st.TendersCount != 5 {
		t.Fatalf("tenders=%d, want 5 (10 rows collapse into 1 observation)", st.TendersCount)
	}
	if st.RowsCount != 14 {
		t.Fatalf("rows=%d, want 14", st.RowsCount)
	}
	if st.Maximum != 500 || st.Median != 102 {
		t.Fatalf("median/max = %v/%v", st.Median, st.Maximum)
	}
}

// §13.26-31 — выборка тендеров формируется SQL; на pure-уровне фиксируем, что
// движок не изобретает observations: пустая карта → insufficient (см. §13.34)
// и что версии/текущий тендер не дублируются в готовых observations (контракт
// SQL проверяется integration-тестами B/D/E/F/G).

// §13.32 — граница ±0.01 не создаёт ложный outlier.
func TestMonetaryBoundaryTolerance(t *testing.T) {
	obs := obsN(90, 95, 100, 105, 110) // upper fence 120
	if ib := evalOne(t, 120.01, obs); ib.Status != StatusWithinRange {
		t.Fatalf("boundary+0.01 must stay within: %s", ib.Status)
	}
	if ib := evalOne(t, 120.02, obs); ib.Status != StatusHighOutlier {
		t.Fatalf("boundary+0.02 must flag: %s", ib.Status)
	}
}

// §13.33 — большие конечные значения без NaN/Inf.
func TestLargeValues(t *testing.T) {
	big := 1e12
	ib := evalOne(t, big, obsN(big-2, big-1, big, big+1, big+2))
	if ib.Status != StatusWithinRange {
		t.Fatalf("large within: %s", ib.Status)
	}
	if ib.DeviationFromMedianPercent == nil || math.IsNaN(*ib.DeviationFromMedianPercent) {
		t.Fatal("NaN deviation on large values")
	}
}

// §13.34 — пустая история безопасна.
func TestEmptyHistory(t *testing.T) {
	ib := evalOne(t, 100, nil)
	if ib.Status != StatusInsufficientHistory || ib.HistoricalTendersCount != 0 {
		t.Fatalf("empty history: %+v", ib)
	}
	r := Evaluate("t", 1, 1, "calculated", 24, "now", nil, nil)
	if r.Summary.CoveragePercent != 0 || len(r.Items) != 0 {
		t.Fatalf("empty tender summary: %+v", r.Summary)
	}
}

// §12 perf — 3000 текущих строк × история: не квадратично.
func TestPerformanceScale(t *testing.T) {
	build := func(n int) ([]CurrentItem, map[Key][]Observation) {
		items := make([]CurrentItem, 0, n)
		obs := map[Key][]Observation{}
		for i := 0; i < n; i++ {
			nameID := fmt.Sprintf("mn-%04d", i%500) // 500 уникальных ключей
			items = append(items, CurrentItem{
				ID: fmt.Sprintf("i-%05d", i), ClientPositionID: "pos-1",
				BoqItemType: "мат", Name: "x", NameID: sp(nameID), UnitCode: sp("м3"),
				Quantity: f(1), StoredTotalAmount: f(float64(100 + i%50)),
			})
			key, _, _ := BuildPriceBenchmarkKey("мат", sp(nameID), sp("м3"), false)
			if len(obs[key]) == 0 {
				obs[key] = obsN(90, 95, 100, 105, 110, 115, 120)
			}
		}
		return items, obs
	}
	run := func(n int) time.Duration {
		items, obs := build(n)
		start := time.Now()
		Evaluate("t", 1, 1, "calculated", 24, "now", items, obs)
		return time.Since(start)
	}
	d3k := run(3000)
	if d3k > 2*time.Second {
		t.Fatalf("3k items took %v (budget 2s)", d3k)
	}
	d6k := run(6000)
	if d6k > 6*d3k+50*time.Millisecond {
		t.Fatalf("quadratic smell: 3k=%v 6k=%v", d3k, d6k)
	}
}
