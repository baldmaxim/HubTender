// Package costbenchmark — сравнение удельных показателей тендера с эталонами:
// ₽ на единицу объёма категории затрат (монолит за м³, кладка за м²) и ₽ на м²
// общей площади по СП.
//
// Эталон — либо ручной диапазон из справочника benchmark_ranges, либо статистика
// ранее посчитанных и согласованных тендеров. Ручной диапазон важнее: он выражает
// решение проверяющего, а истории одного класса бывает мало.
//
// Границы, унаследованные от pricebenchmark: отбор истории тот же (согласованный,
// актуально рассчитанный, последняя версия номера тендера), выбросы — по Тьюки,
// минимум тендеров и денежный допуск — те же константы. Отклонение — повод
// посмотреть, никогда не ошибка и не блокировка.
//
// Пакет чистый: ни БД, ни времени, ни случайности.
package costbenchmark

// Показатели.
const (
	MetricPerVolumeUnit = "per_volume_unit" // ₽ на единицу объёма категории
	MetricPerAreaSP     = "per_area_sp"     // ₽ на м² общей площади по СП
)

// Уровни цели.
const (
	LevelTotal    = "total"    // тендер целиком (только ₽/м²)
	LevelCategory = "category" // cost_categories
	LevelDetail   = "detail"   // detail_cost_categories
)

// Статусы оценки.
const (
	StatusWithin      = "WITHIN_RANGE"
	StatusAbove       = "ABOVE_RANGE"
	StatusBelow       = "BELOW_RANGE"
	StatusNoValue     = "NO_VALUE"     // нет объёма или площади — показатель не посчитать
	StatusNoReference = "NO_REFERENCE" // ни диапазона, ни достаточной истории
	StatusNotReady    = "CALCULATION_NOT_READY"
)

// Источники эталона — в порядке приоритета.
const (
	SourceManualExact  = "manual_exact"  // класс и объём строительства совпали
	SourceManualClass  = "manual_class"  // класс совпал, объём — любой
	SourceManualScope  = "manual_scope"  // объём совпал, класс — любой
	SourceManualAny    = "manual_any"    // диапазон для любых объектов
	SourceHistoryClass = "history_class" // тендеры того же класса
	SourceHistoryAll   = "history_all"   // все тендеры
)

// Target — цель показателя. Для total оба id пусты, для category пуст DetailID.
type Target struct {
	Level      string `json:"level"`
	CategoryID string `json:"category_id"`
	DetailID   string `json:"detail_id"`
}

func (t Target) key() string { return t.Level + "|" + t.CategoryID + "|" + t.DetailID }

// Metric — удельные показатели текущего тендера по одной цели.
type Metric struct {
	Target
	Name            string   `json:"name"`
	Location        string   `json:"location"`
	Unit            string   `json:"unit"`
	Volume          *float64 `json:"volume"`
	CommercialTotal float64  `json:"commercial_total"`
}

// Range — ручной диапазон из справочника.
type Range struct {
	ID                string
	MetricKind        string
	Target            Target
	HousingClass      *string
	ConstructionScope *string
	Min               *float64
	Max               *float64
	Note              *string
}

// Observation — показатели одного исторического тендера по одной цели.
type Observation struct {
	TenderID        string
	TenderNumber    string
	HousingClass    *string
	Target          Target
	Volume          *float64
	AreaSP          *float64
	CommercialTotal float64
}

// Reference — эталон, с которым сравнивали.
type Reference struct {
	Source       string   `json:"source"`
	RangeID      *string  `json:"range_id,omitempty"`
	Note         *string  `json:"note,omitempty"`
	Min          *float64 `json:"min"`
	Max          *float64 `json:"max"`
	Median       *float64 `json:"median,omitempty"`
	TendersCount int      `json:"tenders_count,omitempty"`
}

// Assessment — оценка одного показателя.
type Assessment struct {
	Value            *float64   `json:"value"`
	Status           string     `json:"status"`
	Reference        *Reference `json:"reference"`
	DeviationPercent *float64   `json:"deviation_percent"`
	// HistoryConflict — ручной диапазон использован, но медиана истории того же
	// класса вне его: справочник мог устареть.
	HistoryConflict bool     `json:"history_conflict"`
	HistoryMedian   *float64 `json:"history_median"`
	HistoryTenders  int      `json:"history_tenders"`
}

// Row — строка отчёта.
type Row struct {
	Target
	Name            string      `json:"name"`
	Location        string      `json:"location"`
	Unit            string      `json:"unit"`
	Volume          *float64    `json:"volume"`
	CommercialTotal float64     `json:"commercial_total"`
	PerVolumeUnit   *Assessment `json:"per_volume_unit"`
	PerAreaSP       Assessment  `json:"per_area_sp"`
}

// Input — всё, что нужно для оценки.
type Input struct {
	HousingClass      *string
	ConstructionScope *string
	AreaSP            *float64
	CalculationReady  bool
	Metrics           []Metric
	Ranges            []Range
	History           []Observation
}

// Summary — счётчики статусов по всем показателям отчёта.
type Summary struct {
	Above       int `json:"above"`
	Below       int `json:"below"`
	Within      int `json:"within"`
	NoReference int `json:"no_reference"`
	Conflicts   int `json:"conflicts"`
}

// Report — результат оценки.
type Report struct {
	CalculationReady bool    `json:"calculation_ready"`
	HistoryTenders   int     `json:"history_tenders"`
	Rows             []Row   `json:"rows"`
	Summary          Summary `json:"summary"`
}
