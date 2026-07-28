// Package quality — этап 1.1: read-only движок «Качество расчёта тендера».
//
// Границы (жёсткие):
//   - только чтение: никаких DB-мутаций, cache invalidation, enqueue,
//     изменения approval;
//   - никакой собственной финансовой математики: ожидаемые суммы считаются
//     ТОЛЬКО существующими ядрами backend/internal/calc;
//   - детерминированность: одинаковый snapshot → байт-в-байт одинаковый
//     отчёт (стабильные issue ID, стабильный порядок).
//
// Слои: repository грузит Snapshot фиксированным числом batched-запросов в
// одной REPEATABLE READ READ ONLY транзакции; чистые checks (evaluate.go)
// работают только со Snapshot; service связывает их; handler — тонкий HTTP.
package quality

// Severity — три уровня. Blocker = финальный расчёт нельзя считать готовым
// (approve/final export уже блокируются этапом 0); warning = расчёт возможен,
// строка требует проверки; information = диагностика без блокировки.
const (
	SeverityBlocker     = "blocker"
	SeverityWarn        = "warning"
	SeverityInformation = "information"
)

// Категории MVP.
const (
	CategoryCalculationState   = "CALCULATION_STATE"
	CategoryCurrency           = "CURRENCY"
	CategoryBoqInput           = "BOQ_INPUT"
	CategoryRelations          = "RELATIONS"
	CategoryDerivedConsistency = "DERIVED_CONSISTENCY"
	CategoryRedistribution     = "REDISTRIBUTION"
	CategoryApproval           = "APPROVAL"
	CategoryCompleteness       = "COMPLETENESS"
	CategoryDuplicates         = "DUPLICATES"
)

// Issue — одна конкретная проблема с привязкой к сущности и полю.
// ID детерминирован (code|entity_type|entity_id|field) — без случайных UUID.
type Issue struct {
	ID               string   `json:"id"`
	Code             string   `json:"code"`
	Severity         string   `json:"severity"`
	Category         string   `json:"category"`
	EntityType       string   `json:"entity_type"` // tender | client_position | boq_item
	EntityID         string   `json:"entity_id"`
	ClientPositionID string   `json:"client_position_id,omitempty"`
	Field            string   `json:"field,omitempty"`
	Title            string   `json:"title"`
	Message          string   `json:"message"`
	FixHint          string   `json:"fix_hint"`
	CurrentValue     *string  `json:"current_value"`
	AffectedItemIDs  []string `json:"affected_item_ids,omitempty"`
	AffectedCount    int      `json:"affected_count,omitempty"`
	GroupTotalAmount *float64 `json:"group_total_amount,omitempty"`
}

// CategorySummary — счётчики по категории.
type CategorySummary struct {
	Code        string `json:"code"`
	Blockers    int    `json:"blockers"`
	Warnings    int    `json:"warnings"`
	Information int    `json:"information"`
}

// Summary — верхняя сводка панели.
type Summary struct {
	Blockers                       int     `json:"blockers"`
	Warnings                       int     `json:"warnings"`
	Information                    int     `json:"information"`
	CalculationCompletenessPercent float64 `json:"calculation_completeness_percent"`
	ReviewCompletenessPercent      float64 `json:"review_completeness_percent"`
	PositionsTotal                 int     `json:"positions_total"`
	BoqItemsTotal                  int     `json:"boq_items_total"`
	BoqItemsWithIssues             int     `json:"boq_items_with_issues"`
}

// Report — полный ответ движка по одному snapshot.
type Report struct {
	TenderID                     string            `json:"tender_id"`
	FinancialInputRevision       int64             `json:"financial_input_revision"`
	FinancialCalculationRevision int64             `json:"financial_calculation_revision"`
	FinancialCalculationStatus   string            `json:"financial_calculation_status"`
	GeneratedAt                  string            `json:"generated_at"`
	Summary                      Summary           `json:"summary"`
	Categories                   []CategorySummary `json:"categories"`
	Issues                       []Issue           `json:"issues"`
}

// ─── Snapshot: нормализованный read-only срез тендера ────────────────────────

// SnapshotTender — конфигурация тендера, влияющая на качество расчёта.
type SnapshotTender struct {
	ID                           string
	USDRate                      *float64
	EURRate                      *float64
	CNYRate                      *float64
	CachedGrandTotal             string // numeric::text — сравнение без float-потерь
	MarkupTacticID               *string
	FinancialApproved            bool
	FinancialInputRevision       int64
	FinancialCalculationRevision int64
	FinancialCalculationStatus   string
	FinancialCalculationError    *string // безопасный code
}

// SnapshotPosition — позиция заказчика (порядок = position_number ASC).
type SnapshotPosition struct {
	ID             string
	PositionNumber float64
	WorkName       string
	TotalMaterial  float64
	TotalWorks     float64
	SortIndex      int // детерминированный порядок в snapshot
}

// SnapshotItem — BOQ-строка: только входы + persisted derived для сравнения.
type SnapshotItem struct {
	ID                     string
	ClientPositionID       string
	BoqItemType            string
	MaterialType           *string
	Description            *string
	NameID                 *string // material_name_id | work_name_id (по типу)
	UnitCode               *string
	Quantity               *float64
	UnitRate               *float64
	CurrencyType           string // '' → RUB-семантика calc
	DeliveryPriceType      *string
	DeliveryAmount         *float64
	ConsumptionCoefficient *float64
	ParentWorkItemID       *string
	DetailCostCategoryID   *string
	QuoteLink              *string
	// persisted derived (для consistency-проверок; НЕ входы движка)
	StoredTotalAmount             *float64
	TotalCommercialMaterialCost   *float64
	TotalCommercialWorkCost       *float64
	CommercialMaterialCostPresent bool
	CommercialWorkCostPresent     bool
}

// SnapshotRedistribution — облегчённый статус снапшота перераспределения,
// прочитанный в ТОЙ ЖЕ транзакции (полные prepared-проверки живут на странице
// «Перераспределение»; здесь — признаки, ловимые из metadata).
type SnapshotRedistribution struct {
	Configured             bool
	SchemaVersion          int
	CalculationSource      string
	FinancialInputRevision *int64 // marker из rules; nil у пре-0-F2 снапшотов
	RowCount               int
}

// SnapshotInsurance — страхование как exact-строки (numeric::text) для
// пересчёта cached_grand_total существующим decimal-ядром calc.
type SnapshotInsurance struct {
	Present bool
	// поля в порядке calc.InsuranceDecimalInput
	JudicialPct, TotalPct                                string
	AptPriceM2, AptArea, ParkingPriceM2, ParkingArea     string
	StoragePriceM2, StorageArea                          string
	CommercialMaterialTotalText, CommercialWorkTotalText string // SUM(...)::text
}

// Snapshot — всё, что нужно чистым checks. Собирается фиксированным числом
// запросов (5) в одной REPEATABLE READ READ ONLY tx.
type Snapshot struct {
	Tender         SnapshotTender
	Positions      []SnapshotPosition
	Items          []SnapshotItem
	Redistribution SnapshotRedistribution
	Insurance      SnapshotInsurance
	GeneratedAt    string
}
