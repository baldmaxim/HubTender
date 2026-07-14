// Package pricesource — этап 1.3: покрытие BOQ-строк источниками цен и
// контроль актуальности КП/прайсов (read-only аналитика).
//
// Жёсткие границы: движок не обращается к БД, не меняет данные, не запускает
// recalc, не меняет approval, не открывает внешние URL; технические
// created_at/updated_at НЕ считаются датой цены; статус источника — не
// доказательство неправильной цены и никогда не blocker согласования.
package pricesource

import (
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"
	"time"
)

// Статусы (канонический порядок классификации — см. Classify).
const (
	StatusFresh              = "FRESH"
	StatusExpiringSoon       = "EXPIRING_SOON"
	StatusStale              = "STALE"
	StatusExpired            = "EXPIRED"
	StatusSourceMissing      = "SOURCE_MISSING"
	StatusPriceDateMissing   = "PRICE_DATE_MISSING"
	StatusInvalidSourceDates = "INVALID_SOURCE_DATES"
	StatusNotApplicable      = "NOT_APPLICABLE"
)

// Severity аналитики (никогда не blocker).
const (
	SeverityWarning     = "warning"
	SeverityInformation = "information"
	SeverityNone        = "none"
)

// Дефолты и разрешённые значения.
const (
	DefaultMaxAgeDays       = 90
	DefaultExpiringSoonDays = 14
)

// AllowedMaxAgeDays — значения max_age_days для API.
var AllowedMaxAgeDays = []int{30, 60, 90, 180, 365}

// Item — нормализованная BOQ-строка для движка.
type Item struct {
	ID               string
	ClientPositionID string
	BoqItemType      string
	Name             string
	UnitCode         string
	Quantity         *float64
	UnitRate         *float64
	TotalAmount      *float64 // authoritative; используется ТОЛЬКО в amount-метриках
	QuoteLink        *string
	PriceDate        *string // YYYY-MM-DD
	ValidUntil       *string // YYYY-MM-DD
	SortIndex        int
}

// Row — классифицированная строка ответа.
type Row struct {
	BoqItemID        string   `json:"boq_item_id"`
	ClientPositionID string   `json:"client_position_id"`
	BoqItemType      string   `json:"boq_item_type"`
	Name             string   `json:"name"`
	UnitCode         string   `json:"unit_code"`
	UnitRate         *float64 `json:"unit_rate"`
	TotalAmount      *float64 `json:"total_amount"`
	Status           string   `json:"status"`
	Severity         string   `json:"severity"`
	SourceLabel      string   `json:"source_label,omitempty"`
	SourceURL        *string  `json:"source_url"` // только безопасная схема
	PriceDate        *string  `json:"price_date"`
	ValidUntil       *string  `json:"valid_until"`
	AgeDays          *int     `json:"age_days"`
	DaysUntilExpiry  *int     `json:"days_until_expiry"`
	Message          string   `json:"message"`
	ReviewHint       string   `json:"review_hint,omitempty"`
}

// Summary — сводка страницы (§6).
type Summary struct {
	PriceBearingItemsTotal       int      `json:"price_bearing_items_total"`
	ItemsWithSource              int      `json:"items_with_source"`
	FreshItems                   int      `json:"fresh_items"`
	ExpiringSoonItems            int      `json:"expiring_soon_items"`
	StaleItems                   int      `json:"stale_items"`
	ExpiredItems                 int      `json:"expired_items"`
	MissingSourceItems           int      `json:"missing_source_items"`
	MissingPriceDateItems        int      `json:"missing_price_date_items"`
	InvalidDateItems             int      `json:"invalid_date_items"`
	DistinctSourcesCount         int      `json:"distinct_sources_count"`
	SourceCoveragePercent        float64  `json:"source_coverage_percent"`
	CurrentSourceCoveragePercent float64  `json:"current_source_coverage_percent"`
	PriceBearingDirectAmount     *float64 `json:"price_bearing_direct_amount"`
	AmountWithSource             *float64 `json:"amount_with_source"`
	CurrentSourceAmount          *float64 `json:"current_source_amount"`
	AmountRequiringReview        *float64 `json:"amount_requiring_review"`
	ExpiringSoonAmount           *float64 `json:"expiring_soon_amount"`
	SourceAmountCoveragePercent  *float64 `json:"source_amount_coverage_percent"`
	CurrentSourceAmountCoverage  *float64 `json:"current_source_amount_coverage_percent"`
}

// Report — полный результат движка (фильтры/пагинация — handler).
type Report struct {
	TenderID                     string  `json:"tender_id"`
	FinancialInputRevision       int64   `json:"financial_input_revision"`
	FinancialCalculationRevision int64   `json:"financial_calculation_revision"`
	FinancialCalculationStatus   string  `json:"financial_calculation_status"`
	GeneratedAt                  string  `json:"generated_at"`
	AsOfDate                     string  `json:"as_of_date"`
	MaxAgeDays                   int     `json:"max_age_days"`
	ExpiringSoonDays             int     `json:"expiring_soon_days"`
	AmountMetricsStatus          string  `json:"amount_metrics_status"` // available | unavailable
	AmountMetricsNote            string  `json:"amount_metrics_note,omitempty"`
	Summary                      Summary `json:"summary"`
	Items                        []Row   `json:"items"`
}

// SafeSourceURL возвращает URL только с допустимой схемой (https/http);
// прочее (javascript:, data:, file:, мусор) → nil.
func SafeSourceURL(raw *string) *string {
	if raw == nil {
		return nil
	}
	s := strings.TrimSpace(*raw)
	if s == "" {
		return nil
	}
	u, err := url.Parse(s)
	if err != nil {
		return nil
	}
	switch strings.ToLower(u.Scheme) {
	case "https", "http": // http допустим: существующие внутренние ссылки проекта
		return &s
	default:
		return nil
	}
}

// hasSource — источник считается указанным при непустом quote_link.
func hasSource(quoteLink *string) bool {
	return quoteLink != nil && strings.TrimSpace(*quoteLink) != ""
}

// isPriceBearing — строка участвует в coverage: положительное количество и
// положительная ставка (черновые нулевые строки уже покрыты quality-warnings
// и считаются NOT_APPLICABLE здесь; presentation-only типов в модели нет).
func isPriceBearing(it *Item) bool {
	return it.Quantity != nil && *it.Quantity > 0 && it.UnitRate != nil && *it.UnitRate > 0
}

func parseDay(s *string) (time.Time, bool) {
	if s == nil || strings.TrimSpace(*s) == "" {
		return time.Time{}, false
	}
	t, err := time.Parse("2006-01-02", strings.TrimSpace(*s))
	return t, err == nil
}

// Classify — канонический порядок (§4): NOT_APPLICABLE → SOURCE_MISSING →
// INVALID_SOURCE_DATES → EXPIRED → PRICE_DATE_MISSING → STALE (приоритет над
// EXPIRING_SOON) → EXPIRING_SOON → FRESH. Возвращает status, ageDays,
// daysUntilExpiry.
func Classify(it *Item, asOf time.Time, maxAgeDays, expiringSoonDays int) (string, *int, *int) {
	if !isPriceBearing(it) {
		return StatusNotApplicable, nil, nil
	}
	if !hasSource(it.QuoteLink) {
		return StatusSourceMissing, nil, nil
	}
	priceDate, hasPrice := parseDay(it.PriceDate)
	validUntil, hasValid := parseDay(it.ValidUntil)

	// малформатные непустые даты → invalid
	if (it.PriceDate != nil && strings.TrimSpace(*it.PriceDate) != "" && !hasPrice) ||
		(it.ValidUntil != nil && strings.TrimSpace(*it.ValidUntil) != "" && !hasValid) {
		return StatusInvalidSourceDates, nil, nil
	}
	if hasPrice && priceDate.After(asOf) {
		return StatusInvalidSourceDates, nil, nil
	}
	if hasPrice && hasValid && validUntil.Before(priceDate) {
		return StatusInvalidSourceDates, nil, nil
	}

	var expiryDays *int
	if hasValid {
		d := int(validUntil.Sub(asOf).Hours() / 24)
		expiryDays = &d
		if validUntil.Before(asOf) {
			return StatusExpired, ageOf(hasPrice, priceDate, asOf), expiryDays
		}
	}
	if !hasPrice {
		return StatusPriceDateMissing, nil, expiryDays
	}
	age := int(asOf.Sub(priceDate).Hours() / 24)
	if age > maxAgeDays {
		return StatusStale, &age, expiryDays // STALE приоритетнее EXPIRING_SOON
	}
	if hasValid {
		until := int(validUntil.Sub(asOf).Hours() / 24)
		if until >= 0 && until <= expiringSoonDays {
			return StatusExpiringSoon, &age, expiryDays
		}
	}
	return StatusFresh, &age, expiryDays
}

func ageOf(hasPrice bool, priceDate, asOf time.Time) *int {
	if !hasPrice {
		return nil
	}
	a := int(asOf.Sub(priceDate).Hours() / 24)
	return &a
}

// SeverityOf — warning: missing/stale/expired/invalid; info: expiring soon.
func SeverityOf(status string) string {
	switch status {
	case StatusSourceMissing, StatusPriceDateMissing, StatusStale, StatusExpired, StatusInvalidSourceDates:
		return SeverityWarning
	case StatusExpiringSoon:
		return SeverityInformation
	default:
		return SeverityNone
	}
}

var statusMessages = map[string][2]string{
	StatusSourceMissing:      {"Для строки не указан источник цены.", "Добавьте ссылку на КП или прайс."},
	StatusPriceDateMissing:   {"Источник указан, но дата цены неизвестна.", "Укажите дату цены источника."},
	StatusExpired:            {"Срок действия источника завершён.", "Запросите актуальное предложение или подтвердите цену."},
	StatusExpiringSoon:       {"Срок действия источника скоро завершится.", "Запланируйте обновление предложения."},
	StatusInvalidSourceDates: {"Даты источника требуют исправления.", "Проверьте дату цены и срок действия."},
	StatusFresh:              {"Источник актуален.", ""},
	StatusNotApplicable:      {"Строка не участвует в покрытии (нет количества или ставки).", ""},
}

// statusPriority — детерминированный порядок вывода (§13).
var statusPriority = map[string]int{
	StatusInvalidSourceDates: 0,
	StatusExpired:            1,
	StatusStale:              2,
	StatusSourceMissing:      3,
	StatusPriceDateMissing:   4,
	StatusExpiringSoon:       5,
	StatusFresh:              6,
	StatusNotApplicable:      7,
}

// reviewStatuses — сумма, требующая проверки (§6).
var reviewStatuses = map[string]bool{
	StatusSourceMissing: true, StatusPriceDateMissing: true,
	StatusStale: true, StatusExpired: true, StatusInvalidSourceDates: true,
}

// Evaluate — детерминированный расчёт отчёта. amountAvailable — актуален ли
// финансовый расчёт (§7): row-метрики доступны всегда, amount-метрики — только
// при available (старый cached total не выдаётся за текущий weighted result).
func Evaluate(
	tenderID string,
	inputRev, calcRev int64, calcStatus string,
	generatedAt, asOfDate string,
	maxAgeDays, expiringSoonDays int,
	items []Item,
) *Report {
	asOf, err := time.Parse("2006-01-02", asOfDate)
	if err != nil {
		asOf = time.Unix(0, 0)
	}
	amountAvailable := calcStatus == "calculated" && calcRev == inputRev

	rep := &Report{
		TenderID:                     tenderID,
		FinancialInputRevision:       inputRev,
		FinancialCalculationRevision: calcRev,
		FinancialCalculationStatus:   calcStatus,
		GeneratedAt:                  generatedAt,
		AsOfDate:                     asOfDate,
		MaxAgeDays:                   maxAgeDays,
		ExpiringSoonDays:             expiringSoonDays,
		AmountMetricsStatus:          "available",
		Items:                        make([]Row, 0, len(items)),
	}
	if !amountAvailable {
		rep.AmountMetricsStatus = "unavailable"
		rep.AmountMetricsNote = "Стоимостные показатели будут доступны после завершения расчёта."
	}

	var s Summary
	sources := map[string]struct{}{}
	var amtTotal, amtWithSource, amtCurrent, amtReview, amtExpiring float64

	for i := range items {
		it := &items[i]
		status, age, untilExpiry := Classify(it, asOf, maxAgeDays, expiringSoonDays)
		row := Row{
			BoqItemID:        it.ID,
			ClientPositionID: it.ClientPositionID,
			BoqItemType:      it.BoqItemType,
			Name:             it.Name,
			UnitCode:         it.UnitCode,
			UnitRate:         it.UnitRate,
			Status:           status,
			Severity:         SeverityOf(status),
			PriceDate:        it.PriceDate,
			ValidUntil:       it.ValidUntil,
			AgeDays:          age,
			DaysUntilExpiry:  untilExpiry,
			SourceURL:        SafeSourceURL(it.QuoteLink),
		}
		if amountAvailable {
			row.TotalAmount = it.TotalAmount
		}
		if hasSource(it.QuoteLink) {
			row.SourceLabel = sourceLabel(*it.QuoteLink, it.PriceDate)
		}
		if m, ok := statusMessages[status]; ok {
			row.Message, row.ReviewHint = m[0], m[1]
		}
		if status == StatusStale && age != nil {
			row.Message = fmt.Sprintf("Цена подтверждена более %d дней назад (возраст %d дн.).", maxAgeDays, *age)
			row.ReviewHint = "Запросите актуальное предложение или подтвердите цену."
		}
		rep.Items = append(rep.Items, row)

		if status == StatusNotApplicable {
			continue
		}
		s.PriceBearingItemsTotal++
		amt := 0.0
		if it.TotalAmount != nil {
			amt = *it.TotalAmount
		}
		amtTotal += amt
		if hasSource(it.QuoteLink) {
			s.ItemsWithSource++
			amtWithSource += amt
			sources[strings.TrimSpace(*it.QuoteLink)] = struct{}{}
		}
		switch status {
		case StatusFresh:
			s.FreshItems++
			amtCurrent += amt
		case StatusExpiringSoon:
			s.ExpiringSoonItems++
			amtCurrent += amt
			amtExpiring += amt
		case StatusStale:
			s.StaleItems++
		case StatusExpired:
			s.ExpiredItems++
		case StatusSourceMissing:
			s.MissingSourceItems++
		case StatusPriceDateMissing:
			s.MissingPriceDateItems++
		case StatusInvalidSourceDates:
			s.InvalidDateItems++
		}
		if reviewStatuses[status] {
			amtReview += amt
		}
	}
	s.DistinctSourcesCount = len(sources)
	// Пустой набор price-bearing строк → 100% (документированная policy §6:
	// «нет непокрытого» — как completeness этапа 1.1; тестом закреплено).
	s.SourceCoveragePercent = pct(s.ItemsWithSource, s.PriceBearingItemsTotal)
	s.CurrentSourceCoveragePercent = pct(s.FreshItems+s.ExpiringSoonItems, s.PriceBearingItemsTotal)

	if amountAvailable {
		s.PriceBearingDirectAmount = fp(round2(amtTotal))
		s.AmountWithSource = fp(round2(amtWithSource))
		s.CurrentSourceAmount = fp(round2(amtCurrent))
		s.AmountRequiringReview = fp(round2(amtReview))
		s.ExpiringSoonAmount = fp(round2(amtExpiring))
		s.SourceAmountCoveragePercent = fp(pctAmt(amtWithSource, amtTotal))
		s.CurrentSourceAmountCoverage = fp(pctAmt(amtCurrent, amtTotal))
	}
	rep.Summary = s

	sortRows(rep.Items, items)
	return rep
}

func sourceLabel(link string, priceDate *string) string {
	l := strings.TrimSpace(link)
	if len(l) > 80 {
		l = l[:77] + "…"
	}
	if priceDate != nil && *priceDate != "" {
		return l + " (цена от " + *priceDate + ")"
	}
	return l
}

func pct(n, d int) float64 {
	if d == 0 {
		return 100
	}
	return math.Round(float64(n)/float64(d)*1000) / 10
}

func pctAmt(n, d float64) float64 {
	if d <= 0 {
		return 100
	}
	v := math.Round(n/d*1000) / 10
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
func fp(v float64) *float64    { return &v }

func sortRows(rows []Row, items []Item) {
	posIdx := make(map[string]int, len(items))
	for i := range items {
		if _, ok := posIdx[items[i].ID]; !ok {
			posIdx[items[i].ID] = items[i].SortIndex
		}
	}
	sevRank := map[string]int{SeverityWarning: 0, SeverityInformation: 1, SeverityNone: 2}
	sort.SliceStable(rows, func(a, b int) bool {
		x, y := &rows[a], &rows[b]
		if sevRank[x.Severity] != sevRank[y.Severity] {
			return sevRank[x.Severity] < sevRank[y.Severity]
		}
		if statusPriority[x.Status] != statusPriority[y.Status] {
			return statusPriority[x.Status] < statusPriority[y.Status]
		}
		if x.ClientPositionID != y.ClientPositionID {
			return x.ClientPositionID < y.ClientPositionID
		}
		return x.BoqItemID < y.BoqItemID
	})
}
