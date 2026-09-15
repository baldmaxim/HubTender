package costbenchmark

import (
	"fmt"
	"testing"
)

func sp(s string) *string   { return &s }
func fp(v float64) *float64 { return &v }

var monolith = Target{Level: LevelCategory, CategoryID: "cat-monolith"}

func metric(total, volume float64) Metric {
	return Metric{Target: monolith, Name: "Монолит", Unit: "м3", Volume: fp(volume), CommercialTotal: total}
}

// history — n тендеров класса class со значениями ₽/м³ base, base+step, …
func history(class string, n int, base, step float64) []Observation {
	out := make([]Observation, n)
	for i := 0; i < n; i++ {
		out[i] = Observation{
			TenderID: fmt.Sprintf("%s-%d", class, i), HousingClass: sp(class), Target: monolith,
			Volume: fp(1), AreaSP: fp(1), CommercialTotal: base + float64(i)*step,
		}
	}
	return out
}

func baseInput() Input {
	return Input{HousingClass: sp("бизнес"), ConstructionScope: sp("генподряд"), AreaSP: fp(1000), CalculationReady: true}
}

func TestManualRangeBeatsHistoryAndPicksMostSpecific(t *testing.T) {
	in := baseInput()
	in.Metrics = []Metric{metric(30000, 1)} // 30 000 ₽/м³
	in.History = history("бизнес", 6, 20000, 100)
	in.Ranges = []Range{
		{ID: "any", MetricKind: MetricPerVolumeUnit, Target: monolith, Min: fp(1000), Max: fp(50000)},
		{ID: "class", MetricKind: MetricPerVolumeUnit, Target: monolith, HousingClass: sp("бизнес"), Max: fp(25000)},
		{ID: "other", MetricKind: MetricPerVolumeUnit, Target: monolith, HousingClass: sp("комфорт"),
			ConstructionScope: sp("генподряд"), Max: fp(1)},
	}
	a := Evaluate(in).Rows[0].PerVolumeUnit
	if a.Reference == nil || *a.Reference.RangeID != "class" || a.Reference.Source != SourceManualClass {
		t.Fatalf("ожидался диапазон класса, получено %+v", a.Reference)
	}
	if a.Status != StatusAbove || a.DeviationPercent == nil || *a.DeviationPercent != 20 {
		t.Fatalf("30000 против максимума 25000: %+v dev=%v", a.Status, a.DeviationPercent)
	}
	if a.HistoryConflict {
		t.Fatal("медиана истории 20250 внутри диапазона — конфликта нет")
	}
}

func TestHistoryConflictWhenMedianOutsideManualRange(t *testing.T) {
	in := baseInput()
	in.Metrics = []Metric{metric(20000, 1)}
	in.History = history("бизнес", 6, 40000, 100)
	in.Ranges = []Range{{ID: "r", MetricKind: MetricPerVolumeUnit, Target: monolith, Min: fp(15000), Max: fp(25000)}}
	a := Evaluate(in).Rows[0].PerVolumeUnit
	if a.Status != StatusWithin || !a.HistoryConflict || a.HistoryMedian == nil {
		t.Fatalf("ожидался конфликт справочника с историей: %+v", a)
	}
}

func TestHistoryClassThenAllThenNoReference(t *testing.T) {
	in := baseInput()
	in.Metrics = []Metric{metric(100000, 1)}

	in.History = append(history("бизнес", 5, 20000, 500), history("комфорт", 5, 90000, 500)...)
	a := Evaluate(in).Rows[0].PerVolumeUnit
	if a.Reference.Source != SourceHistoryClass || a.Status != StatusAbove || a.Reference.TendersCount != 5 {
		t.Fatalf("история своего класса: %+v %+v", a.Status, a.Reference)
	}

	// Своего класса мало — берётся вся история.
	in.History = append(history("бизнес", 2, 20000, 500), history("комфорт", 5, 90000, 500)...)
	a = Evaluate(in).Rows[0].PerVolumeUnit
	if a.Reference.Source != SourceHistoryAll || a.Reference.TendersCount != 7 {
		t.Fatalf("вся история: %+v", a.Reference)
	}

	in.History = history("бизнес", 4, 20000, 500)
	if a = Evaluate(in).Rows[0].PerVolumeUnit; a.Status != StatusNoReference || a.Reference != nil {
		t.Fatalf("4 тендера — эталона нет: %+v", a)
	}
}

func TestNoValueAndNotReady(t *testing.T) {
	in := baseInput()
	in.Metrics = []Metric{{Target: monolith, CommercialTotal: 5000}} // объёма нет
	in.Ranges = []Range{{ID: "r", MetricKind: MetricPerVolumeUnit, Target: monolith, Max: fp(1)}}
	row := Evaluate(in).Rows[0]
	if row.PerVolumeUnit.Status != StatusNoValue || row.PerVolumeUnit.Reference == nil {
		t.Fatalf("без объёма — NO_VALUE с показом эталона: %+v", row.PerVolumeUnit)
	}
	if row.PerAreaSP.Value == nil || *row.PerAreaSP.Value != 5 {
		t.Fatalf("₽/м² считается от площади тендера: %+v", row.PerAreaSP)
	}

	in.CalculationReady = false
	if s := Evaluate(in).Rows[0].PerAreaSP.Status; s != StatusNotReady {
		t.Fatalf("расчёт не актуален — статус %q", s)
	}
}

func TestTotalLevelHasOnlyAreaMetricAndZeroHistoryIgnored(t *testing.T) {
	in := baseInput()
	total := Target{Level: LevelTotal}
	in.Metrics = []Metric{{Target: total, Name: "Итого", CommercialTotal: 150_000_000}}
	obs := make([]Observation, 0, 6)
	for i := 0; i < 5; i++ {
		obs = append(obs, Observation{TenderID: fmt.Sprint(i), HousingClass: sp("бизнес"), Target: total,
			AreaSP: fp(1000), CommercialTotal: 100_000_000 + float64(i)*1_000_000})
	}
	obs = append(obs, Observation{TenderID: "zero", HousingClass: sp("бизнес"), Target: total, AreaSP: fp(1000)})
	in.History = obs

	rep := Evaluate(in)
	row := rep.Rows[0]
	if row.PerVolumeUnit != nil {
		t.Fatal("у тендера целиком нет ₽ на единицу объёма")
	}
	if row.PerAreaSP.Reference == nil || row.PerAreaSP.Reference.TendersCount != 5 {
		t.Fatalf("тендер с нулевым итогом не должен попадать в статистику: %+v", row.PerAreaSP.Reference)
	}
	if row.PerAreaSP.Status != StatusAbove || rep.HistoryTenders != 6 {
		t.Fatalf("150 000 ₽/м² против 100–104 тыс.: %+v, history=%d", row.PerAreaSP.Status, rep.HistoryTenders)
	}
	if rep.Summary.Above != 1 {
		t.Fatalf("сводка: %+v", rep.Summary)
	}
}
