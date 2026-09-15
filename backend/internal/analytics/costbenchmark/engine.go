package costbenchmark

import (
	"math"

	"github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
)

// Evaluate оценивает удельные показатели тендера. Детерминирован, вход не мутирует.
func Evaluate(in Input) Report {
	ranges := make(map[string][]Range, len(in.Ranges))
	for _, r := range in.Ranges {
		k := r.MetricKind + "#" + r.Target.key()
		ranges[k] = append(ranges[k], r)
	}
	hist, tenders := indexHistory(in.History)

	rep := Report{CalculationReady: in.CalculationReady, HistoryTenders: tenders, Rows: make([]Row, 0, len(in.Metrics))}
	for _, m := range in.Metrics {
		row := Row{
			Target: m.Target, Name: m.Name, Location: m.Location, Unit: m.Unit,
			Volume: m.Volume, CommercialTotal: m.CommercialTotal,
		}
		row.PerAreaSP = assess(in, MetricPerAreaSP, m, in.AreaSP, ranges, hist)
		if m.Level != LevelTotal {
			a := assess(in, MetricPerVolumeUnit, m, m.Volume, ranges, hist)
			row.PerVolumeUnit = &a
		}
		rep.Rows = append(rep.Rows, row)
		count(&rep.Summary, row.PerAreaSP)
		if row.PerVolumeUnit != nil {
			count(&rep.Summary, *row.PerVolumeUnit)
		}
	}
	return rep
}

func count(s *Summary, a Assessment) {
	switch a.Status {
	case StatusAbove:
		s.Above++
	case StatusBelow:
		s.Below++
	case StatusWithin:
		s.Within++
	case StatusNoReference:
		s.NoReference++
	}
	if a.HistoryConflict {
		s.Conflicts++
	}
}

// unitValue — ₽ на единицу знаменателя. Нулевой итог — не показатель: категория
// без денег ничего не говорит о цене, а в истории такие точки исказили бы медиану.
func unitValue(total float64, denom *float64) *float64 {
	if denom == nil || *denom <= 0 || total <= 0 {
		return nil
	}
	v := round2(total / *denom)
	return &v
}

type historyBucket struct {
	byClass map[string][]float64
	all     []float64
}

// indexHistory раскладывает значения истории по показателю и цели. Возвращает
// и число различных тендеров истории — для подписи «сравнивали с N объектами».
func indexHistory(obs []Observation) (map[string]*historyBucket, int) {
	out := make(map[string]*historyBucket)
	seen := make(map[string]struct{})
	add := func(kind string, o Observation, v *float64) {
		if v == nil {
			return
		}
		k := kind + "#" + o.Target.key()
		b, ok := out[k]
		if !ok {
			b = &historyBucket{byClass: make(map[string][]float64)}
			out[k] = b
		}
		b.all = append(b.all, *v)
		if o.HousingClass != nil {
			b.byClass[*o.HousingClass] = append(b.byClass[*o.HousingClass], *v)
		}
	}
	for _, o := range obs {
		seen[o.TenderID] = struct{}{}
		add(MetricPerAreaSP, o, unitValue(o.CommercialTotal, o.AreaSP))
		if o.Target.Level != LevelTotal {
			add(MetricPerVolumeUnit, o, unitValue(o.CommercialTotal, o.Volume))
		}
	}
	return out, len(seen)
}

func stats(values []float64) pricebenchmark.Stats {
	obs := make([]pricebenchmark.Observation, len(values))
	for i, v := range values {
		obs[i] = pricebenchmark.Observation{RepresentativeUnitCost: v}
	}
	return pricebenchmark.ComputeStats(obs)
}

func usable(st pricebenchmark.Stats) bool {
	return st.TendersCount >= pricebenchmark.MinTendersForBenchmark && !st.MedianInvalid
}

func assess(
	in Input,
	kind string,
	m Metric,
	denom *float64,
	ranges map[string][]Range,
	hist map[string]*historyBucket,
) Assessment {
	a := Assessment{Value: unitValue(m.CommercialTotal, denom)}
	k := kind + "#" + m.Target.key()

	var classStats *pricebenchmark.Stats
	if b := hist[k]; b != nil {
		if in.HousingClass != nil {
			if vals := b.byClass[*in.HousingClass]; len(vals) > 0 {
				st := stats(vals)
				classStats = &st
				a.HistoryTenders = st.TendersCount
				if usable(st) {
					med := round2(st.Median)
					a.HistoryMedian = &med
				}
			}
		}
	}

	if r := pickRange(ranges[k], in.HousingClass, in.ConstructionScope); r != nil {
		a.Reference = &Reference{Source: r.source, RangeID: &r.ID, Note: r.Note, Min: r.Min, Max: r.Max}
		if classStats != nil && usable(*classStats) && outside(classStats.Median, r.Min, r.Max) {
			a.HistoryConflict = true
		}
	} else if b := hist[k]; b != nil {
		if classStats != nil && usable(*classStats) {
			a.Reference = historyReference(SourceHistoryClass, *classStats)
		} else if st := stats(b.all); usable(st) {
			a.Reference = historyReference(SourceHistoryAll, st)
		}
	}

	switch {
	case !in.CalculationReady:
		a.Status = StatusNotReady
	case a.Value == nil:
		a.Status = StatusNoValue
	case a.Reference == nil:
		a.Status = StatusNoReference
	default:
		a.Status, a.DeviationPercent = classify(*a.Value, a.Reference)
	}
	return a
}

type pickedRange struct {
	Range
	source string
}

// pickRange выбирает самый конкретный подходящий диапазон: класс и объём
// строительства → только класс → только объём → любой объект. Диапазон с
// заданным, но не совпавшим классом или объёмом не подходит вовсе.
func pickRange(cands []Range, class, scope *string) *pickedRange {
	var best *pickedRange
	bestRank := -1
	for _, r := range cands {
		classOK := r.HousingClass == nil || (class != nil && *r.HousingClass == *class)
		scopeOK := r.ConstructionScope == nil || (scope != nil && *r.ConstructionScope == *scope)
		if !classOK || !scopeOK {
			continue
		}
		rank, src := 0, SourceManualAny
		switch {
		case r.HousingClass != nil && r.ConstructionScope != nil:
			rank, src = 3, SourceManualExact
		case r.HousingClass != nil:
			rank, src = 2, SourceManualClass
		case r.ConstructionScope != nil:
			rank, src = 1, SourceManualScope
		}
		if rank > bestRank {
			best, bestRank = &pickedRange{Range: r, source: src}, rank
		}
	}
	return best
}

func historyReference(source string, st pricebenchmark.Stats) *Reference {
	lo := round2(math.Max(0, st.LowerFence))
	hi := round2(st.UpperFence)
	med := round2(st.Median)
	return &Reference{Source: source, Min: &lo, Max: &hi, Median: &med, TendersCount: st.TendersCount}
}

func outside(v float64, lo, hi *float64) bool {
	return (lo != nil && v < *lo-pricebenchmark.MoneyTolerance) ||
		(hi != nil && v > *hi+pricebenchmark.MoneyTolerance)
}

// classify — статус и отклонение. Для истории отклонение считается от медианы
// (как в pricebenchmark), для ручного диапазона — от нарушенной границы: у
// диапазона нет «нормы», есть только допустимые пределы.
func classify(v float64, ref *Reference) (string, *float64) {
	tol := pricebenchmark.MoneyTolerance
	status := StatusWithin
	switch {
	case ref.Max != nil && v > *ref.Max+tol:
		status = StatusAbove
	case ref.Min != nil && v < *ref.Min-tol:
		status = StatusBelow
	}

	var base *float64
	switch {
	case ref.Median != nil:
		base = ref.Median
	case status == StatusAbove:
		base = ref.Max
	case status == StatusBelow:
		base = ref.Min
	}
	if base == nil || *base <= 0 {
		return status, nil
	}
	d := round2((v - *base) / *base * 100)
	return status, &d
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
