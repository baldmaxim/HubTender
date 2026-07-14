package pricebenchmark

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// ─── Benchmark key + eligibility ─────────────────────────────────────────────

// BuildPriceBenchmarkKey — ЕДИНСТВЕННЫЙ способ построить ключ сопоставления.
// Используется для текущих строк, исторических строк (SQL повторяет те же
// поля), unit-тестов и detail endpoint. ok=false + причина, если у строки нет
// надёжной точной идентичности (description-fallback ЗАПРЕЩЁН — §3).
func BuildPriceBenchmarkKey(boqItemType string, nameID, unitCode *string, hasParent bool) (Key, bool, string) {
	if strings.TrimSpace(boqItemType) == "" {
		return Key{}, false, "INSUFFICIENT_IDENTITY: не задан тип строки"
	}
	if nameID == nil || strings.TrimSpace(*nameID) == "" {
		return Key{}, false, "INSUFFICIENT_IDENTITY: нет номенклатурной привязки (material/work name)"
	}
	if unitCode == nil || strings.TrimSpace(*unitCode) == "" {
		return Key{}, false, "INSUFFICIENT_IDENTITY: не указана единица измерения"
	}
	return Key{
		BoqItemType: boqItemType,
		NameID:      strings.TrimSpace(*nameID),
		UnitCode:    strings.TrimSpace(*unitCode),
		HasParent:   hasParent,
	}, true, ""
}

// eligibleMetric — можно ли посчитать effective direct unit cost.
func eligibleMetric(quantity, total *float64) (float64, bool, string) {
	if quantity == nil || *quantity <= 0 {
		return 0, false, "NOT_ELIGIBLE: количество не задано или не положительно"
	}
	if total == nil || *total <= 0 {
		return 0, false, "NOT_ELIGIBLE: авторитетная сумма строки не положительна"
	}
	v := *total / *quantity
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, false, "NOT_ELIGIBLE: метрика не является конечным числом"
	}
	return v, true, ""
}

// ─── Статистика: детерминированные квартели + Tukey fences ──────────────────

// quantile — линейная интерполяция по ОТСОРТИРОВАННОЙ выборке (детерминирована).
func quantile(sorted []float64, q float64) float64 {
	n := len(sorted)
	if n == 0 {
		return 0
	}
	if n == 1 {
		return sorted[0]
	}
	pos := q * float64(n-1)
	lo := int(math.Floor(pos))
	hi := int(math.Ceil(pos))
	if lo == hi {
		return sorted[lo]
	}
	frac := pos - float64(lo)
	return sorted[lo] + (sorted[hi]-sorted[lo])*frac
}

// ComputeStats строит статистику по representative observations одного key.
// Полностью детерминирована: сортирует копию входа.
func ComputeStats(obs []Observation) Stats {
	st := Stats{TendersCount: len(obs)}
	if len(obs) == 0 {
		return st
	}
	values := make([]float64, 0, len(obs))
	for _, o := range obs {
		values = append(values, o.RepresentativeUnitCost)
		st.RowsCount += o.MatchedRowsCount
		if st.EarliestAt == "" || o.ApprovedAt < st.EarliestAt {
			st.EarliestAt = o.ApprovedAt
		}
		if o.ApprovedAt > st.LatestAt {
			st.LatestAt = o.ApprovedAt
		}
	}
	sort.Float64s(values)
	st.Minimum = values[0]
	st.Maximum = values[len(values)-1]
	st.Median = quantile(values, 0.5)
	st.P25 = quantile(values, 0.25)
	st.P75 = quantile(values, 0.75)
	st.IQR = st.P75 - st.P25
	st.LowerFence = st.P25 - 1.5*st.IQR
	st.UpperFence = st.P75 + 1.5*st.IQR
	if st.Median <= 0 || math.IsNaN(st.Median) || math.IsInf(st.Median, 0) {
		st.MedianInvalid = true // история непригодна; без NaN/Inf наружу
	}
	return st
}

// Classify — статус текущей цены относительно статистики (Tukey fences,
// денежный допуск MoneyTolerance; никакого дополнительного процентного порога).
func Classify(current float64, st Stats) string {
	if st.TendersCount < MinTendersForBenchmark {
		return StatusInsufficientHistory
	}
	if st.MedianInvalid {
		return StatusInsufficientHistory
	}
	upper := st.UpperFence
	lower := math.Max(0, st.LowerFence)
	if current > upper+MoneyTolerance {
		return StatusHighOutlier
	}
	if current < lower-MoneyTolerance {
		return StatusLowOutlier
	}
	return StatusWithinRange
}

// DeviationPercent — (current-median)/median×100; nil при непригодной медиане.
func DeviationPercent(current float64, st Stats) *float64 {
	if st.MedianInvalid || st.Median <= 0 {
		return nil
	}
	d := (current - st.Median) / st.Median * 100
	if math.IsNaN(d) || math.IsInf(d, 0) {
		return nil
	}
	d = math.Round(d*100) / 100
	return &d
}

// ─── Сборка отчёта ────────────────────────────────────────────────────────────

// Evaluate строит отчёт по текущим строкам и карте observations по ключам.
// Детерминирован; вход не мутируется.
func Evaluate(
	tenderID string,
	inputRev, calcRev int64,
	calcStatus string,
	periodMonths int,
	generatedAt string,
	items []CurrentItem,
	observations map[Key][]Observation,
) *Report {
	out := &Report{
		TenderID:                     tenderID,
		FinancialInputRevision:       inputRev,
		FinancialCalculationRevision: calcRev,
		FinancialCalculationStatus:   calcStatus,
		PeriodMonths:                 periodMonths,
		GeneratedAt:                  generatedAt,
		Items:                        make([]ItemBenchmark, 0, len(items)),
	}
	statsCache := map[Key]Stats{}

	for _, it := range items {
		ib := ItemBenchmark{
			BoqItemID:        it.ID,
			ClientPositionID: it.ClientPositionID,
			BoqItemType:      it.BoqItemType,
			Name:             it.Name,
			UnitCode:         derefS(it.UnitCode),
			Quantity:         derefF(it.Quantity),
		}
		key, keyOK, keyReason := BuildPriceBenchmarkKey(it.BoqItemType, it.NameID, it.UnitCode, it.HasParent)
		current, metricOK, metricReason := eligibleMetric(it.Quantity, it.StoredTotalAmount)
		if !keyOK || !metricOK {
			ib.Status = StatusNotEligible
			ib.NotEligibleReason = keyReason
			if !metricOK {
				ib.NotEligibleReason = metricReason
			}
			ib.Message = "Строка не участвует в сравнении: нет точной номенклатурной привязки или расчётной метрики."
			out.Items = append(out.Items, ib)
			continue
		}
		ib.CurrentUnitCost = round2(current)

		obs := observations[key]
		st, cached := statsCache[key]
		if !cached {
			st = ComputeStats(obs)
			statsCache[key] = st
		}
		ib.HistoricalTendersCount = st.TendersCount
		ib.HistoricalRowsCount = st.RowsCount

		status := Classify(current, st)
		ib.Status = status
		if status == StatusInsufficientHistory {
			ib.Message = fmt.Sprintf("Недостаточно истории: %d согласованных тендеров (нужно не менее %d).",
				st.TendersCount, MinTendersForBenchmark)
			out.Items = append(out.Items, ib)
			continue
		}

		ib.Median = fptr(round2(st.Median))
		ib.P25 = fptr(round2(st.P25))
		ib.P75 = fptr(round2(st.P75))
		ib.LowerFence = fptr(round2(math.Max(0, st.LowerFence)))
		ib.UpperFence = fptr(round2(st.UpperFence))
		ib.Minimum = fptr(round2(st.Minimum))
		ib.Maximum = fptr(round2(st.Maximum))
		ib.DeviationFromMedianPercent = DeviationPercent(current, st)
		ib.EarliestObservationAt = st.EarliestAt
		ib.LatestObservationAt = st.LatestAt

		switch status {
		case StatusHighOutlier:
			ib.Message = "Текущая стоимость выше исторического диапазона. Требует проверки."
			ib.ReviewHint = "Проверьте объём, доставку, коэффициенты и источник цены. Высокая цена может быть обоснована условиями проекта."
		case StatusLowOutlier:
			ib.Message = "Текущая стоимость ниже исторического диапазона. Требует проверки."
			ib.ReviewHint = "Проверьте полноту состава цены (доставка, коэффициенты) и актуальность источника."
		default:
			ib.Message = "Текущая стоимость в историческом диапазоне."
		}
		out.Items = append(out.Items, ib)
	}

	sortItems(out.Items)
	out.Summary = buildSummary(out.Items)
	return out
}

// statusRank — HIGH/LOW сначала (требуют внимания), затем остальное.
var statusRank = map[string]int{
	StatusHighOutlier:         0,
	StatusLowOutlier:          1,
	StatusWithinRange:         2,
	StatusInsufficientHistory: 3,
	StatusNotEligible:         4,
}

func sortItems(items []ItemBenchmark) {
	sort.SliceStable(items, func(a, b int) bool {
		x, y := &items[a], &items[b]
		if statusRank[x.Status] != statusRank[y.Status] {
			return statusRank[x.Status] < statusRank[y.Status]
		}
		dx, dy := absDeviation(x), absDeviation(y)
		if dx != dy {
			return dx > dy // большее отклонение выше
		}
		if x.ClientPositionID != y.ClientPositionID {
			return x.ClientPositionID < y.ClientPositionID
		}
		return x.BoqItemID < y.BoqItemID
	})
}

func absDeviation(ib *ItemBenchmark) float64 {
	if ib.DeviationFromMedianPercent == nil {
		return -1
	}
	return math.Abs(*ib.DeviationFromMedianPercent)
}

func buildSummary(items []ItemBenchmark) Summary {
	var s Summary
	for i := range items {
		switch items[i].Status {
		case StatusHighOutlier:
			s.HighOutliers++
		case StatusLowOutlier:
			s.LowOutliers++
		case StatusWithinRange:
			s.WithinRange++
		case StatusInsufficientHistory:
			s.InsufficientHistory++
		case StatusNotEligible:
			s.NotEligible++
		}
	}
	s.EligibleItems = len(items) - s.NotEligible
	s.BenchmarkedItems = s.HighOutliers + s.LowOutliers + s.WithinRange
	if s.EligibleItems > 0 {
		s.CoveragePercent = math.Round(float64(s.BenchmarkedItems)/float64(s.EligibleItems)*1000) / 10
	} else {
		s.CoveragePercent = 0
	}
	return s
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func fptr(v float64) *float64 { return &v }

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func derefF(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}
