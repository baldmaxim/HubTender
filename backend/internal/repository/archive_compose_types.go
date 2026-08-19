package repository

import "fmt"

// Режимы масштабирования количеств при переносе исторических строк.
const (
	ScaleModeNone        = "none"
	ScaleModeFactor      = "factor"
	ScaleModeVolumeRatio = "volume_ratio"
)

// Поведение при отсутствующей позиции-источнике.
const (
	OnMissingSourceFail = "fail"
	OnMissingSourceSkip = "skip"
)

// Границы батча.
const (
	MaxComposeGroups         = 200
	MaxComposeSourcesInGroup = 50
)

// Коды предупреждений (не ошибки: результат записан, но требует внимания).
const (
	WarnLinkedQuantityRederived = "LINKED_QUANTITY_REDERIVED"
	WarnSourcePositionSkipped   = "SOURCE_POSITION_SKIPPED"
)

// ComposeOptions — опции всей команды.
type ComposeOptions struct {
	// OnMissingSource: fail (по умолчанию) | skip.
	OnMissingSource string
	// CopyQuoteDates — переносить quote_price_date/quote_valid_until.
	// По умолчанию false: старые даты источника цены искажают аналитику свежести.
	CopyQuoteDates bool
	// CopyDetailCostCategory — переносить detail_cost_category_id (по умолчанию true).
	CopyDetailCostCategory bool
	// QuantityDecimals — округление масштабированных количеств; nil = без округления.
	QuantityDecimals *int
}

// ScaleSpec — как пересчитывать количества конкретного источника.
type ScaleSpec struct {
	Mode         string
	Factor       *float64
	SourceVolume *float64
	TargetVolume *float64
}

// ComposeSource — одна историческая позиция-источник.
type ComposeSource struct {
	SourcePositionID string
	// SourceItemIDs — подмножество строк; пусто = все строки позиции.
	SourceItemIDs []string
	Scale         *ScaleSpec
}

// NewTargetPosition — параметры создаваемой позиции заказчика.
type NewTargetPosition struct {
	PositionNumber   *float64
	ItemNo           *string
	SectionNumber    *string
	PositionName     *string
	WorkName         string
	UnitCode         *string
	Volume           *float64
	ManualVolume     *float64
	ClientNote       *string
	ManualNote       *string
	HierarchyLevel   *int
	IsAdditional     bool
	ParentPositionID *string
}

// ComposeGroup — одна целевая позиция и её источники.
//
// Одна группа = одна целевая позиция. Это не эргономика API, а требование БД:
// FK boq_items_parent_scope_fkey не даёт связи «материал → работа» пересекать
// позицию, поэтому ремап родителей возможен только в пределах одной позиции.
type ComposeGroup struct {
	TempID           string
	TargetPositionID *string
	NewPosition      *NewTargetPosition
	Sources          []ComposeSource
}

// ComposeInput — вход команды сборки.
type ComposeInput struct {
	TargetTenderID string
	ChangedBy      string
	DryRun         bool
	Verbose        bool
	Options        ComposeOptions
	Groups         []ComposeGroup
}

// ComposeWarning — предупреждение по конкретной строке/источнику.
type ComposeWarning struct {
	Code             string   `json:"code"`
	GroupTempID      string   `json:"group_temp_id,omitempty"`
	SourcePositionID string   `json:"source_position_id,omitempty"`
	SourceItemID     string   `json:"source_item_id,omitempty"`
	Stored           *float64 `json:"stored,omitempty"`
	Rederived        *float64 `json:"rederived,omitempty"`
}

// ComposeSourceStat — что именно взяли из источника.
type ComposeSourceStat struct {
	SourcePositionID string  `json:"source_position_id"`
	SourceTenderID   string  `json:"source_tender_id,omitempty"`
	ScaleMode        string  `json:"scale_mode"`
	ScaleFactor      float64 `json:"scale_factor"`
	ItemsCopied      int     `json:"items_copied"`
	Skipped          bool    `json:"skipped,omitempty"`
}

// ComposeItemResult — построчный результат (только при verbose).
type ComposeItemResult struct {
	Index          int      `json:"index"`
	SourceItemID   string   `json:"source_item_id"`
	SourceTenderID string   `json:"source_tender_id"`
	NewItemID      string   `json:"new_item_id,omitempty"`
	BoqItemType    string   `json:"boq_item_type"`
	Quantity       *float64 `json:"quantity"`
	UnitRate       *float64 `json:"unit_rate"`
	CurrencyType   *string  `json:"currency_type"`
	TotalAmount    *float64 `json:"total_amount,omitempty"`
	ParentIndex    *int     `json:"parent_index,omitempty"`
}

// ComposeGroupResult — результат по одной целевой позиции.
type ComposeGroupResult struct {
	TempID           string              `json:"temp_id"`
	TargetPositionID string              `json:"target_position_id,omitempty"`
	PositionCreated  bool                `json:"position_created"`
	PositionNumber   *float64            `json:"position_number,omitempty"`
	ItemsCreated     int                 `json:"items_created"`
	TotalMaterial    *float64            `json:"total_material,omitempty"`
	TotalWorks       *float64            `json:"total_works,omitempty"`
	Sources          []ComposeSourceStat `json:"sources"`
	Items            []ComposeItemResult `json:"items,omitempty"`
}

// ComposeTotals — сводка по всей команде.
type ComposeTotals struct {
	PositionsCreated    int `json:"positions_created"`
	PositionsTargeted   int `json:"positions_targeted"`
	ItemsCreated        int `json:"items_created"`
	WorksCount          int `json:"works_count"`
	MaterialsCount      int `json:"materials_count"`
	ParentLinksRestored int `json:"parent_links_restored"`
}

// ComposeResult — ответ команды.
type ComposeResult struct {
	DryRun                 bool                 `json:"dry_run"`
	TargetTenderID         string               `json:"target_tender_id"`
	FinancialInputRevision int64                `json:"financial_input_revision"`
	CachedGrandTotal       string               `json:"cached_grand_total,omitempty"`
	Totals                 ComposeTotals        `json:"totals"`
	Groups                 []ComposeGroupResult `json:"groups"`
	Warnings               []ComposeWarning     `json:"warnings,omitempty"`
}

// ─── типизированные ошибки ──────────────────────────────────────────────────

// ArchiveTargetSpecError — target задан неверно (ни одного либо оба ключа).
type ArchiveTargetSpecError struct {
	GroupTempID string
	Reason      string
}

func (e *ArchiveTargetSpecError) Error() string {
	return fmt.Sprintf("ARCHIVE_TARGET_SPEC_INVALID: группа %q: %s", e.GroupTempID, e.Reason)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveTargetSpecError) Code() string { return "ARCHIVE_TARGET_SPEC_INVALID" }

// ArchiveDuplicateTargetError — один temp_id / одна целевая позиция дважды.
type ArchiveDuplicateTargetError struct {
	GroupTempID string
	PositionID  string
}

func (e *ArchiveDuplicateTargetError) Error() string {
	if e.PositionID != "" {
		return fmt.Sprintf("ARCHIVE_DUPLICATE_TARGET: позиция %s указана более одного раза", e.PositionID)
	}
	return fmt.Sprintf("ARCHIVE_DUPLICATE_TARGET: temp_id %q повторяется", e.GroupTempID)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveDuplicateTargetError) Code() string { return "ARCHIVE_DUPLICATE_TARGET" }

// ArchiveTargetNotFoundError — целевой позиции нет.
type ArchiveTargetNotFoundError struct {
	PositionID string
}

func (e *ArchiveTargetNotFoundError) Error() string {
	return fmt.Sprintf("ARCHIVE_TARGET_POSITION_NOT_FOUND: %s", e.PositionID)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveTargetNotFoundError) Code() string { return "ARCHIVE_TARGET_POSITION_NOT_FOUND" }

// ArchiveTargetScopeError — целевая позиция принадлежит другому тендеру.
type ArchiveTargetScopeError struct {
	PositionID       string
	ExpectedTenderID string
	ActualTenderID   string
}

func (e *ArchiveTargetScopeError) Error() string {
	return fmt.Sprintf("ARCHIVE_TARGET_TENDER_MISMATCH: позиция %s принадлежит тендеру %s, ожидался %s",
		e.PositionID, e.ActualTenderID, e.ExpectedTenderID)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveTargetScopeError) Code() string { return "ARCHIVE_TARGET_TENDER_MISMATCH" }

// ArchiveSourceNotFoundError — нет позиции-источника или её строки.
type ArchiveSourceNotFoundError struct {
	PositionID string
	ItemID     string
}

func (e *ArchiveSourceNotFoundError) Error() string {
	if e.ItemID != "" {
		return fmt.Sprintf("ARCHIVE_SOURCE_ITEM_NOT_FOUND: строка %s не найдена в позиции %s", e.ItemID, e.PositionID)
	}
	return fmt.Sprintf("ARCHIVE_SOURCE_POSITION_NOT_FOUND: %s", e.PositionID)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveSourceNotFoundError) Code() string {
	if e.ItemID != "" {
		return "ARCHIVE_SOURCE_ITEM_NOT_FOUND"
	}
	return "ARCHIVE_SOURCE_POSITION_NOT_FOUND"
}

// ArchiveNothingToComposeError — после фильтрации копировать нечего.
type ArchiveNothingToComposeError struct{}

func (e *ArchiveNothingToComposeError) Error() string {
	return "ARCHIVE_NOTHING_TO_COMPOSE: ни одной строки к переносу"
}

// Code returns the stable machine-readable error code.
func (e *ArchiveNothingToComposeError) Code() string { return "ARCHIVE_NOTHING_TO_COMPOSE" }

// ArchiveScaleError — некорректный коэффициент масштабирования.
type ArchiveScaleError struct {
	GroupTempID string
	Reason      string
	Undefined   bool // true → объём источника/цели не задан
}

func (e *ArchiveScaleError) Error() string {
	return fmt.Sprintf("%s: группа %q: %s", e.Code(), e.GroupTempID, e.Reason)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveScaleError) Code() string {
	if e.Undefined {
		return "ARCHIVE_SCALE_UNDEFINED"
	}
	return "ARCHIVE_SCALE_INVALID"
}

// ArchiveQuantityUnderflowError — после масштабирования количество стало 0,
// что нарушает CHECK quantity > 0. Молча зажимать к минимуму нельзя.
type ArchiveQuantityUnderflowError struct {
	GroupTempID  string
	SourceItemID string
	Factor       float64
}

func (e *ArchiveQuantityUnderflowError) Error() string {
	return fmt.Sprintf("ARCHIVE_QUANTITY_UNDERFLOW: строка %s при коэффициенте %g даёт нулевое количество",
		e.SourceItemID, e.Factor)
}

// Code returns the stable machine-readable error code.
func (e *ArchiveQuantityUnderflowError) Code() string { return "ARCHIVE_QUANTITY_UNDERFLOW" }
