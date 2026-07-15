// Package changeimpact — этап 1.5: read-only сравнение сохранённых версий
// тендера («Изменения расчёта»).
//
// Жёсткие границы:
//   - сравниваются ТОЛЬКО сохранённые версии одного tender_number; никаких
//     calculation_runs/снапшотов внутри версии/произвольных моментов времени;
//   - matching строго exact (persisted lineage в модели нет — аудит §1):
//     никакого fuzzy/similarity/LLM; дубли exact-ключа сравниваются группой;
//   - деньги — server-authoritative numeric::text → big.Rat (decimal-хелперы
//     этапа 0); никаких client totals/markup повторно/redistribution preview;
//   - изменение конфигурации — объясняющий контекст, НЕ доказанная денежная
//     причина; residual сверки не прячется в «прочее».
package changeimpact

// Статусы строк/групп (§5).
const (
	StatusUnchanged      = "UNCHANGED"
	StatusModified       = "MODIFIED"
	StatusAdded          = "ADDED"
	StatusRemoved        = "REMOVED"
	StatusAmbiguousGroup = "AMBIGUOUS_GROUP"
)

// Статусы отчёта/сверки.
const (
	ReportOK                   = "OK"
	ReportBaselineNotAvailable = "BASELINE_NOT_AVAILABLE"

	ReconciliationOK       = "RECONCILED"
	ReconciliationMismatch = "RECONCILIATION_MISMATCH"
)

// MoneyTolerance — каноническая денежная точность сверки, ₽.
const MoneyTolerance = 0.01

// TenderState — версия тендера + конфигурация коммерческого расчёта.
type TenderState struct {
	ID           string
	TenderNumber string
	Version      int
	ApprovedAt   string // '' если нет
	Approved     bool
	InputRev     int64
	CalcRev      int64
	CalcStatus   string

	CachedGrandTotal string // numeric::text — EXACT

	USDRate      *float64
	EURRate      *float64
	CNYRate      *float64
	TacticID     *string
	TacticLabel  string
	ApplySubW    bool
	ApplySubM    bool
	Distribution *Distribution
	Percentages  []Percentage // отсортированы по label
	Exclusions   []string     // canonical "категория|тип", отсортированы
	Insurance    Insurance
}

// Distribution — tender_pricing_distribution (6 target-полей).
type Distribution struct {
	BasicMaterialBase, BasicMaterialMarkup       string
	AuxiliaryMaterialBase, AuxiliaryMaterialMark string
	WorkBase, WorkMarkup                         string
}

// Percentage — процент наценки по параметру.
type Percentage struct {
	Label string
	Value string // numeric::text
}

// Insurance — конфигурация страхования (numeric::text; формула этапа 0 не
// зависит от commercial-сумм — CalculateInsuranceTotalDecimal).
type Insurance struct {
	Present                  bool
	JudicialPct, TotalPct    string
	AptPriceM2, AptArea      string
	ParkingPriceM2, ParkingA string
	StoragePriceM2, StorageA string
}

// Position — позиция версии.
type Position struct {
	ID             string
	PositionNumber float64
	ItemNo         string
	WorkName       string
	UnitCode       string
	SortIndex      int
}

// Item — BOQ-строка версии (входы + authoritative money как text).
type Item struct {
	ID               string
	ClientPositionID string
	BoqItemType      string
	MaterialType     *string
	NameID           *string
	Name             string // display
	UnitCode         *string
	DetailCategoryID *string
	ParentWorkItemID *string
	Description      *string
	CurrencyType     string
	DeliveryType     *string

	Quantity        *float64
	UnitRate        *float64
	BaseQuantity    *float64
	ConsumptionCoef *float64
	ConversionCoef  *float64
	DeliveryAmount  *float64

	QuoteLink       *string
	QuotePriceDate  *string
	QuoteValidUntil *string

	TotalAmountText        string // numeric::text ('0' если NULL)
	CommercialMaterialText string
	CommercialWorkText     string

	SortIndex int
}

// Inputs — один снапшот версии для движка.
type VersionData struct {
	Tender    TenderState
	Positions []Position
	Items     []Item
}

// Candidate — допустимый baseline.
type Candidate struct {
	TenderID         string  `json:"tender_id"`
	Version          int     `json:"version"`
	ApprovedAt       string  `json:"approved_at"`
	CachedGrandTotal float64 `json:"cached_grand_total"`
	Label            string  `json:"label"`
}

// ─── Report ──────────────────────────────────────────────────────────────────

// MoneyPair — было/стало/дельта (2dp float для JSON; сверка — exact rat).
type MoneyPair struct {
	Baseline float64 `json:"baseline"`
	Current  float64 `json:"current"`
	Delta    float64 `json:"delta"`
}

// FieldChange — изменённое поле matched-строки.
type FieldChange struct {
	Field        string `json:"field"`
	Label        string `json:"label"`
	OldValue     string `json:"old_value"`
	NewValue     string `json:"new_value"`
	EvidenceOnly bool   `json:"evidence_only,omitempty"` // quote/source metadata
}

// ItemDiff — строка/группа сравнения.
type ItemDiff struct {
	ID                 string        `json:"id"` // стабильный: cur:<id> | base:<id> | group:<posKey>|<boqKey>
	Status             string        `json:"status"`
	BoqItemType        string        `json:"boq_item_type"`
	Label              string        `json:"label"`
	PositionLabel      string        `json:"position_label"`
	ClientPositionID   *string       `json:"client_position_id"` // текущая позиция (если есть)
	BaselinePositionID *string       `json:"baseline_position_id,omitempty"`
	CurrentItemID      *string       `json:"current_item_id"`
	BaselineItemID     *string       `json:"baseline_item_id"`
	CurrentItemIDs     []string      `json:"current_item_ids,omitempty"` // группы
	BaselineItemIDs    []string      `json:"baseline_item_ids,omitempty"`
	CurrentCount       int           `json:"current_count,omitempty"`
	BaselineCount      int           `json:"baseline_count,omitempty"`
	ChangedFields      []FieldChange `json:"changed_fields,omitempty"`
	Quantity           *MoneyPair    `json:"quantity,omitempty"`
	UnitRate           *MoneyPair    `json:"unit_rate,omitempty"`
	Direct             MoneyPair     `json:"direct"`
	Commercial         MoneyPair     `json:"commercial"`
	Direction          string        `json:"direction"` // increase | decrease | unchanged
	Note               string        `json:"note,omitempty"`

	posSort int // внутренняя сортировка
	absImp  float64
}

// BridgeEntry — компонент точного согласования итога (§7).
type BridgeEntry struct {
	Code   string  `json:"code"`
	Label  string  `json:"label"`
	Amount float64 `json:"amount"`
}

// ConfigChange — изменение настройки тендера (§8): контекст, не причина.
type ConfigChange struct {
	Code       string `json:"code"`
	Label      string `json:"label"`
	OldValue   string `json:"old_value"`
	NewValue   string `json:"new_value"`
	Changed    bool   `json:"changed"`
	Navigation string `json:"navigation"` // typed target: tender_currency | markup | distribution | exclusions | insurance
}

// PositionSummary — вклад позиции (§9).
type PositionSummary struct {
	PositionKey     string    `json:"position_key"`
	PositionLabel   string    `json:"position_label"`
	CurrentID       *string   `json:"current_position_id"`
	BaselineID      *string   `json:"baseline_position_id"`
	Status          string    `json:"status"` // matched | added | removed | ambiguous
	Direct          MoneyPair `json:"direct"`
	Commercial      MoneyPair `json:"commercial"`
	ItemsAdded      int       `json:"items_added"`
	ItemsRemoved    int       `json:"items_removed"`
	ItemsModified   int       `json:"items_modified"`
	AmbiguousGroups int       `json:"ambiguous_groups"`
	TopContributors []string  `json:"top_contributors,omitempty"` // ItemDiff IDs
}

// Contributor — крупнейший вклад (§10). Основной ranking — commercial delta;
// direct — отдельное evidence.
type Contributor struct {
	Type          string   `json:"type"` // boq_item | boq_group | position | insurance
	ID            string   `json:"id"`   // ItemDiff ID / "insurance"
	Label         string   `json:"label"`
	PositionLabel string   `json:"position_label,omitempty"`
	Baseline      float64  `json:"baseline"`
	Current       float64  `json:"current"`
	Delta         float64  `json:"delta"`
	DirectDelta   *float64 `json:"direct_delta,omitempty"`
	Direction     string   `json:"direction"`
	ChangedFields []string `json:"changed_fields,omitempty"`
	CurrentItemID *string  `json:"current_item_id,omitempty"`
	PositionID    *string  `json:"client_position_id,omitempty"`
}

// Summary — сводка полного сравнения (§15: не зависит от фильтров/пагинации).
type Summary struct {
	BaselineGrandTotal      float64 `json:"baseline_grand_total"`
	CurrentGrandTotal       float64 `json:"current_grand_total"`
	GrandTotalDelta         float64 `json:"grand_total_delta"`
	DirectTotalDelta        float64 `json:"direct_total_delta"`
	CommercialMaterialDelta float64 `json:"commercial_material_delta"`
	CommercialWorkDelta     float64 `json:"commercial_work_delta"`
	BoqCommercialDelta      float64 `json:"boq_commercial_delta"`
	InsuranceDelta          float64 `json:"insurance_delta"`
	ReconciledTotalDelta    float64 `json:"reconciled_total_delta"`
	PositionsChanged        int     `json:"positions_changed"`
	ItemsAdded              int     `json:"items_added"`
	ItemsRemoved            int     `json:"items_removed"`
	ItemsModified           int     `json:"items_modified"`
	ItemsUnchanged          int     `json:"items_unchanged"`
	AmbiguousGroups         int     `json:"ambiguous_groups"`
	IsReconciled            bool    `json:"is_reconciled"`
	ReconciliationResidual  float64 `json:"reconciliation_residual"`
	ReconciliationStatus    string  `json:"reconciliation_status"`
}

// VersionMeta — краткая карточка версии в ответе.
type VersionMeta struct {
	TenderID         string  `json:"tender_id"`
	TenderNumber     string  `json:"tender_number"`
	Version          int     `json:"version"`
	ApprovedAt       string  `json:"approved_at,omitempty"`
	InputRevision    int64   `json:"financial_input_revision"`
	CachedGrandTotal float64 `json:"cached_grand_total"`
}

// Report — полный результат сравнения (фильтры/пагинация — handler).
type Report struct {
	Status             string            `json:"status"` // OK | BASELINE_NOT_AVAILABLE
	Current            VersionMeta       `json:"current"`
	Baseline           *VersionMeta      `json:"baseline"`
	BaselineCandidates []Candidate       `json:"baseline_candidates"`
	GeneratedAt        string            `json:"generated_at"`
	Summary            Summary           `json:"summary"`
	Bridge             []BridgeEntry     `json:"bridge"`
	ConfigChanges      []ConfigChange    `json:"configuration_changes"`
	PositionSummaries  []PositionSummary `json:"position_summaries"`
	TopContributors    []Contributor     `json:"top_contributors"`
	Items              []ItemDiff        `json:"items"`
}

// FilteredSummary — сводка по substantive-фильтрам (§15), отдельно от общей.
type FilteredSummary struct {
	FilteredItems           int     `json:"filtered_items"`
	FilteredCommercialDelta float64 `json:"filtered_commercial_delta"`
	FilteredDirectDelta     float64 `json:"filtered_direct_delta"`
}
