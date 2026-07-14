// Package pricebenchmark — этап 1.2: исторические ценовые ориентиры и
// выявление подозрительных цен (read-only аналитика).
//
// Жёсткие границы:
//   - только внутренняя согласованная история HUBTender, только точное
//     catalog-сопоставление (никакого fuzzy/embeddings/LLM/description-fallback);
//   - метрика: authoritative total_amount / quantity (сервером рассчитанный
//     total уже учитывает валюту, доставку и коэффициенты); никаких
//     commercial/markup/НДС/insurance в исторической базовой цене;
//   - отклонение — предупреждение «требует проверки», НИКОГДА не blocker и не
//     утверждение об ошибке цены;
//   - ничего не мутируется: ни BOQ, ни ставки, ни approval, ни кэш.
package pricebenchmark

// Статусы строки.
const (
	StatusHighOutlier         = "HIGH_OUTLIER"
	StatusLowOutlier          = "LOW_OUTLIER"
	StatusWithinRange         = "WITHIN_RANGE"
	StatusInsufficientHistory = "INSUFFICIENT_HISTORY"
	StatusNotEligible         = "NOT_ELIGIBLE"
)

// MinTendersForBenchmark — минимум различных логических тендеров для
// outlier-классификации.
const MinTendersForBenchmark = 5

// MoneyTolerance — денежный допуск сравнения границ (одна копейка
// представления не создаёт warning).
const MoneyTolerance = 0.01

// AllowedPeriods — разрешённые периоды истории, месяцы.
var AllowedPeriods = []int{6, 12, 24, 36}

// DefaultPeriodMonths — период по умолчанию.
const DefaultPeriodMonths = 24

// Key — точный benchmark key (подтверждён аудитом §1):
// канонический тип строки + номенклатурный ID + единица измерения + наличие
// родителя (child-материал имеет derived-количество → другая ценовая
// семантика, со standalone не смешивается).
type Key struct {
	BoqItemType string
	NameID      string // material_name_id | work_name_id (по типу)
	UnitCode    string
	HasParent   bool
}

// CurrentItem — строка текущего тендера (входы для eligibility и метрики).
type CurrentItem struct {
	ID                string
	ClientPositionID  string
	BoqItemType       string
	Name              string // display (номенклатурное имя/описание)
	NameID            *string
	UnitCode          *string
	Quantity          *float64
	StoredTotalAmount *float64 // authoritative server total
	HasParent         bool
	SortIndex         int // детерминированный порядок позиций/строк
}

// Observation — одна representative-точка: один логический тендер × key.
// RepresentativeUnitCost — медиана direct unit costs его совпавших строк
// (крупный тендер с повторами не доминирует в статистике).
type Observation struct {
	TenderID               string  `json:"tender_id,omitempty"`
	TenderLabel            string  `json:"tender_label"`
	Version                int     `json:"version"`
	ApprovedAt             string  `json:"approved_at"`
	RepresentativeUnitCost float64 `json:"representative_unit_cost"`
	MatchedRowsCount       int     `json:"matched_rows_count"`
	QuantitySum            float64 `json:"quantity_sum"`
}

// Stats — статистика по representative observations одного key.
type Stats struct {
	TendersCount  int
	RowsCount     int
	Median        float64
	P25           float64
	P75           float64
	IQR           float64
	LowerFence    float64
	UpperFence    float64
	Minimum       float64
	Maximum       float64
	EarliestAt    string
	LatestAt      string
	MedianInvalid bool // median <= 0 → история непригодна (без NaN/Inf)
}

// ItemBenchmark — результат по одной текущей строке.
type ItemBenchmark struct {
	BoqItemID                  string   `json:"boq_item_id"`
	ClientPositionID           string   `json:"client_position_id"`
	BoqItemType                string   `json:"boq_item_type"`
	Name                       string   `json:"name"`
	UnitCode                   string   `json:"unit_code"`
	Quantity                   float64  `json:"quantity"`
	CurrentUnitCost            float64  `json:"current_unit_cost"`
	Status                     string   `json:"status"`
	NotEligibleReason          string   `json:"not_eligible_reason,omitempty"`
	HistoricalTendersCount     int      `json:"historical_tenders_count"`
	HistoricalRowsCount        int      `json:"historical_rows_count"`
	Median                     *float64 `json:"median"`
	P25                        *float64 `json:"p25"`
	P75                        *float64 `json:"p75"`
	LowerFence                 *float64 `json:"lower_fence"`
	UpperFence                 *float64 `json:"upper_fence"`
	Minimum                    *float64 `json:"minimum"`
	Maximum                    *float64 `json:"maximum"`
	DeviationFromMedianPercent *float64 `json:"deviation_from_median_percent"`
	EarliestObservationAt      string   `json:"earliest_observation_at,omitempty"`
	LatestObservationAt        string   `json:"latest_observation_at,omitempty"`
	Message                    string   `json:"message"`
	ReviewHint                 string   `json:"review_hint,omitempty"`
}

// Summary — сводка страницы.
type Summary struct {
	EligibleItems       int     `json:"eligible_items"`
	BenchmarkedItems    int     `json:"benchmarked_items"`
	HighOutliers        int     `json:"high_outliers"`
	LowOutliers         int     `json:"low_outliers"`
	WithinRange         int     `json:"within_range"`
	InsufficientHistory int     `json:"insufficient_history"`
	NotEligible         int     `json:"not_eligible"`
	CoveragePercent     float64 `json:"coverage_percent"`
}

// Report — полный ответ основного endpoint (до фильтров/пагинации handler'а).
type Report struct {
	TenderID                     string          `json:"tender_id"`
	FinancialInputRevision       int64           `json:"financial_input_revision"`
	FinancialCalculationRevision int64           `json:"financial_calculation_revision"`
	FinancialCalculationStatus   string          `json:"financial_calculation_status"`
	PeriodMonths                 int             `json:"period_months"`
	GeneratedAt                  string          `json:"generated_at"`
	Summary                      Summary         `json:"summary"`
	Items                        []ItemBenchmark `json:"items"`
}
