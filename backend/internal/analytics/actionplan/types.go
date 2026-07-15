// Package actionplan — этап 1.4: единый read-only «План действий» расчётчика.
//
// Композиция трёх ГОТОВЫХ аналитик (quality, price benchmark, price source)
// в одну приоритетную очередь действий. Жёсткие границы:
//   - только чтение: никаких мутаций, сохранения action items, статусов
//     выполнения, назначений, recalc и изменений approval;
//   - никакой новой финансовой математики: суммы — только authoritative
//     boq_items.total_amount из снапшота;
//   - никакого fuzzy/LLM-мержа: только явные детерминированные merge rules;
//   - никакого непрозрачного score: четыре понятных priority band;
//   - blocking может прийти ТОЛЬКО из quality blocker-семантики.
package actionplan

// Priority bands (§5) — без магического числового score.
const (
	PriorityBlocking = "blocking"
	PriorityHigh     = "high"
	PriorityNormal   = "normal"
	PriorityLow      = "low"
)

// Источники действий.
const (
	SourceQuality        = "quality"
	SourcePriceBenchmark = "price_benchmark"
	SourcePriceSource    = "price_source"
)

// Статусы компонентов аналитики (§9).
const (
	ComponentAvailable           = "available"
	ComponentCalculationNotReady = "calculation_not_ready"
	ComponentNoHistory           = "no_history"
	ComponentUnavailable         = "unavailable"
)

// Типы навигации (§13) — typed contract; URL строит frontend.
const (
	NavBoqItem             = "boq_item"
	NavTenderCurrency      = "tender_currency"
	NavFinancialIndicators = "financial_indicators"
	NavRedistribution      = "redistribution"
	NavDuplicateGroup      = "duplicate_group"
	NavAnalyticsPage       = "analytics_page"
)

// Navigation — куда ведёт основная кнопка действия.
type Navigation struct {
	Type       string  `json:"type"`
	PositionID *string `json:"position_id"`
	ItemID     *string `json:"item_id"`
	Field      string  `json:"field,omitempty"`
}

// SourceNavigation — переход к исходной аналитике (secondary action).
type SourceNavigation struct {
	AnalyticsPage string  `json:"analytics_page"` // quality | price_benchmark | price_source
	ItemID        *string `json:"item_id,omitempty"`
}

// Action — один пункт плана (§4). ID стабилен и детерминирован:
// немерженный — source:<source item/issue id>:<code>;
// merged — merged:<canonical code>:<entity id>:<field>.
type Action struct {
	ID                 string            `json:"id"`
	Rank               int               `json:"rank"`
	Priority           string            `json:"priority"`
	Source             string            `json:"source"`
	Sources            []string          `json:"sources"`
	Code               string            `json:"code"`
	Category           string            `json:"category"`
	EntityType         string            `json:"entity_type"` // tender | client_position | boq_item
	EntityID           string            `json:"entity_id"`
	ClientPositionID   *string           `json:"client_position_id"`
	BoqItemIDs         []string          `json:"boq_item_ids,omitempty"`
	Field              string            `json:"field,omitempty"`
	Title              string            `json:"title"`
	Reason             string            `json:"reason"`
	RecommendedAction  string            `json:"recommended_action"`
	PriorityReason     string            `json:"priority_reason"`
	AffectedItemsCount int               `json:"affected_items_count"`
	ImpactAmount       *float64          `json:"impact_amount"`
	ImpactAmountStatus string            `json:"impact_amount_status"` // available | unavailable
	Navigation         Navigation        `json:"navigation"`
	SourceNavigation   SourceNavigation  `json:"source_navigation"`
	Evidence           map[string]string `json:"evidence,omitempty"`

	posSort int // внутренний ключ сортировки (позиция), не сериализуется
}

// Component — состояние одного аналитического источника.
type Component struct {
	Status          string `json:"status"`
	ItemsConsidered int    `json:"items_considered,omitempty"`
	PeriodMonths    int    `json:"period_months,omitempty"`
	MaxAgeDays      int    `json:"max_age_days,omitempty"`
	Note            string `json:"note,omitempty"`
}

// Components — все три источника (§9): partial result не скрывается.
type Components struct {
	Quality        Component `json:"quality"`
	PriceBenchmark Component `json:"price_benchmark"`
	PriceSource    Component `json:"price_source"`
}

// Summary — сводка плана (§10).
type Summary struct {
	ActionsTotal          int            `json:"actions_total"`
	BlockingActions       int            `json:"blocking_actions"`
	HighActions           int            `json:"high_actions"`
	NormalActions         int            `json:"normal_actions"`
	LowActions            int            `json:"low_actions"`
	AffectedBoqItems      int            `json:"affected_boq_items"`
	AffectedPositions     int            `json:"affected_positions"`
	AmountMetricsStatus   string         `json:"amount_metrics_status"` // available | unavailable
	AmountRequiringReview *float64       `json:"amount_requiring_review"`
	ActionsBySource       map[string]int `json:"actions_by_source"`

	// Контекстные счётчики (НЕ действия) — объясняют coverage.
	PriceItemsWithinRange         int `json:"price_items_within_range"`
	PriceItemsInsufficientHistory int `json:"price_items_insufficient_history"`
	PriceSourcesFresh             int `json:"price_sources_fresh"`
	PriceSourcesNotApplicable     int `json:"price_sources_not_applicable"`
}

// Report — полный результат композиции (фильтры/пагинация — handler).
type Report struct {
	TenderID                     string     `json:"tender_id"`
	FinancialInputRevision       int64      `json:"financial_input_revision"`
	FinancialCalculationRevision int64      `json:"financial_calculation_revision"`
	FinancialCalculationStatus   string     `json:"financial_calculation_status"`
	GeneratedAt                  string     `json:"generated_at"`
	AsOfDate                     string     `json:"as_of_date"`
	BenchmarkPeriodMonths        int        `json:"benchmark_period_months"`
	SourceMaxAgeDays             int        `json:"source_max_age_days"`
	Components                   Components `json:"components"`
	Summary                      Summary    `json:"summary"`
	Actions                      []Action   `json:"actions"`

	// ItemAmounts — authoritative total_amount по строкам; нужен handler'у для
	// пересчёта summary после substantive-фильтров (§11). Не сериализуется.
	ItemAmounts map[string]float64 `json:"-"`
	// AmountAvailable — расчёт актуален (calculated + ревизии совпали).
	AmountAvailable bool `json:"-"`
}

// ItemInfo — метаданные BOQ-строки для impact/sort (из общего снапшота).
type ItemInfo struct {
	ID               string
	ClientPositionID string
	SortIndex        int
	TotalAmount      *float64 // authoritative server total; НЕ commercial
}
