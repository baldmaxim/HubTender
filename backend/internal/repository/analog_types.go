package repository

import (
	"fmt"
	"time"
)

// Пилот «Расценивание по реальному аналогу»: типы ответов API и ошибки.
// Контракт — api/ENDPOINTS.md (раздел «Расценка по аналогу»).

// Служебные значения черновой сессии тендера, куда пишутся строки аналогов.
const (
	AnalogRunLabel    = "Аналоги из архива"
	AnalogRunFileName = "analog-pilot"
)

// Состояния целевой позиции.
const (
	AnalogStateEmpty       = "empty"
	AnalogStateDraftOnly   = "draft_only"
	AnalogStateForeign     = "has_foreign_rows"
	AnalogStateLocked      = "locked"
	AnalogStatusApplied    = "applied"
	AnalogStatusSuperseded = "superseded"
	AnalogStatusReverted   = "reverted"
)

// Коды предупреждений предпросмотра.
const (
	AnalogWarnUnitsDiffer = "UNITS_DIFFER"
)

// AnalogRow — строка состава (источник, цель или предпросмотр).
type AnalogRow struct {
	ID                     *string  `json:"id"`
	Index                  int      `json:"index"`
	ParentIndex            *int     `json:"parent_index"`
	BoqItemType            string   `json:"boq_item_type"`
	MaterialType           *string  `json:"material_type"`
	Name                   string   `json:"name"`
	UnitCode               *string  `json:"unit_code"`
	Quantity               *float64 `json:"quantity"`
	ConversionCoefficient  *float64 `json:"conversion_coefficient"`
	ConsumptionCoefficient *float64 `json:"consumption_coefficient"`
	UnitRate               *float64 `json:"unit_rate"`
	CurrencyType           *string  `json:"currency_type"`
	DeliveryPriceType      *string  `json:"delivery_price_type"`
	DeliveryAmount         *float64 `json:"delivery_amount"`
	TotalAmount            *float64 `json:"total_amount"`
	QuotePriceDate         *string  `json:"quote_price_date"`
	QuoteValidUntil        *string  `json:"quote_valid_until"`
	QuoteLink              *string  `json:"quote_link"`
	SourceItemID           *string  `json:"source_item_id"`
	IsDraft                bool     `json:"is_draft"`
}

// AnalogTarget — целевая позиция (та, которую расцениваем).
type AnalogTarget struct {
	PositionID       string      `json:"position_id"`
	TenderID         string      `json:"tender_id"`
	TenderNumber     *string     `json:"tender_number"`
	TenderVersion    *int        `json:"tender_version"`
	PositionNumber   *float64    `json:"position_number"`
	ItemNo           *string     `json:"item_no"`
	WorkName         string      `json:"work_name"`
	UnitCode         *string     `json:"unit_code"`
	Volume           *float64    `json:"volume"`
	ClientNote       *string     `json:"client_note"`
	ManualNote       *string     `json:"manual_note"`
	State            string      `json:"state"`
	ReviewStatus     *string     `json:"review_status"`
	RunID            *string     `json:"run_id"`
	DraftRowsCount   int         `json:"draft_rows_count"`
	ForeignRowsCount int         `json:"foreign_rows_count"`
	Items            []AnalogRow `json:"items"`
}

// AnalogSourcePosition — позиция-источник (укороченный вид для ответов).
type AnalogSourcePosition struct {
	ID             string   `json:"id"`
	PositionNumber *float64 `json:"position_number"`
	ItemNo         *string  `json:"item_no"`
	WorkName       string   `json:"work_name"`
	PositionName   *string  `json:"position_name"`
	UnitCode       *string  `json:"unit_code"`
	Volume         *float64 `json:"volume"`
	ClientNote     *string  `json:"client_note"`
	ManualNote     *string  `json:"manual_note"`
}

// AnalogSourceTender — тендер источника.
type AnalogSourceTender struct {
	ID                string  `json:"id"`
	TenderNumber      *string `json:"tender_number"`
	Version           *int    `json:"version"`
	Title             *string `json:"title"`
	ObjectName        *string `json:"object_name"`
	ClientName        *string `json:"client_name"`
	CreatedAt         *string `json:"created_at"`
	FinancialApproved *bool   `json:"financial_approved"`
}

// AnalogSource — ответ GET /analogs/sources/{id}.
type AnalogSource struct {
	Position AnalogSourcePosition `json:"position"`
	Tender   AnalogSourceTender   `json:"tender"`
	Items    []AnalogRow          `json:"items"`
}

// AnalogPreviewSource — краткая сводка источника в предпросмотре.
type AnalogPreviewSource struct {
	AnalogSourceTender
	PositionID string   `json:"position_id"`
	WorkName   string   `json:"work_name"`
	UnitCode   *string  `json:"unit_code"`
	Volume     *float64 `json:"volume"`
}

// AnalogPreviewScale — как пересчитаны количества.
type AnalogPreviewScale struct {
	Mode         string   `json:"mode"`
	Factor       float64  `json:"factor"`
	SourceVolume *float64 `json:"source_volume"`
	TargetVolume *float64 `json:"target_volume"`
	UnitsMatch   bool     `json:"units_match"`
}

// AnalogPreviewTotals — итоги позиции после переноса (по курсам цели).
type AnalogPreviewTotals struct {
	WorksCount          int     `json:"works_count"`
	MaterialsCount      int     `json:"materials_count"`
	ParentLinksRestored int     `json:"parent_links_restored"`
	TotalMaterial       float64 `json:"total_material"`
	TotalWorks          float64 `json:"total_works"`
}

// AnalogWarning — предупреждение предпросмотра.
type AnalogWarning struct {
	Code         string   `json:"code"`
	Message      string   `json:"message"`
	SourceItemID string   `json:"source_item_id,omitempty"`
	Stored       *float64 `json:"stored,omitempty"`
	Rederived    *float64 `json:"rederived,omitempty"`
}

// AnalogPreview — ответ POST /positions/{id}/analog:preview.
type AnalogPreview struct {
	Target        AnalogTarget        `json:"target"`
	Source        AnalogPreviewSource `json:"source"`
	Scale         AnalogPreviewScale  `json:"scale"`
	Items         []AnalogRow         `json:"items"`
	Totals        AnalogPreviewTotals `json:"totals"`
	Warnings      []AnalogWarning     `json:"warnings"`
	CanApply      bool                `json:"can_apply"`
	BlockedReason *string             `json:"blocked_reason"`
	PreviewToken  string              `json:"preview_token"`
}

// AnalogApplication — решение «взять расценку из аналога».
type AnalogApplication struct {
	ID                  string     `json:"id"`
	Status              string     `json:"status"`
	TenderID            string     `json:"tender_id"`
	ClientPositionID    string     `json:"client_position_id"`
	RunID               string     `json:"run_id"`
	SourcePositionID    string     `json:"source_position_id"`
	SourceTenderID      string     `json:"source_tender_id"`
	SourceTenderNumber  *string    `json:"source_tender_number"`
	SourceTenderVersion *int       `json:"source_tender_version"`
	SourceWorkName      string     `json:"source_work_name"`
	ScaleMode           string     `json:"scale_mode"`
	ScaleFactor         float64    `json:"scale_factor"`
	SourceVolume        *float64   `json:"source_volume"`
	TargetVolume        *float64   `json:"target_volume"`
	CopyPrices          bool       `json:"copy_prices"`
	ItemsCreated        int        `json:"items_created"`
	CreatedBy           string     `json:"created_by"`
	CreatedByName       *string    `json:"created_by_name"`
	CreatedAt           time.Time  `json:"created_at"`
	RevertedByName      *string    `json:"reverted_by_name"`
	RevertedAt          *time.Time `json:"reverted_at"`
}

// AnalogApplyResult — ответ POST /positions/{id}/analog:apply.
type AnalogApplyResult struct {
	Application AnalogApplication `json:"application"`
	RunID       string            `json:"run_id"`
	Replayed    bool              `json:"replayed"`
	// TenderID нужен сервису для сброса кэшей и пересчёта; в JSON не отдаётся.
	TenderID string `json:"-"`
}

// AnalogRevertResult — итог отмены решения.
type AnalogRevertResult struct {
	Application AnalogApplication
	// Changed — строки действительно удалены (повтор отмены ничего не меняет).
	Changed bool
}

// AnalogNext — следующая позиция тендера, ещё не расценённая.
type AnalogNext struct {
	PositionID     string   `json:"position_id"`
	PositionNumber *float64 `json:"position_number"`
	ItemNo         *string  `json:"item_no"`
	WorkName       string   `json:"work_name"`
}

// ─── типизированные ошибки ──────────────────────────────────────────────────

// AnalogError — ошибка контракта с кодом ANALOG_* (HTTP-статус и текст задаёт
// хендлер по коду). Extras уходят в тело ответа как есть.
type AnalogError struct {
	Code    string
	Message string
	Extras  map[string]any
}

func (e *AnalogError) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

// Коды ошибок пилота.
const (
	AnalogCodeTargetNotFound    = "ANALOG_TARGET_NOT_FOUND"
	AnalogCodeSourceNotFound    = "ANALOG_SOURCE_NOT_FOUND"
	AnalogCodeSourceEmpty       = "ANALOG_SOURCE_EMPTY"
	AnalogCodeSourceSameTender  = "ANALOG_SOURCE_SAME_TENDER"
	AnalogCodeScaleNeedsChoice  = "ANALOG_SCALE_NEEDS_DECISION"
	AnalogCodeVolumeUnknown     = "ANALOG_VOLUME_UNKNOWN"
	AnalogCodeScaleInvalid      = "ANALOG_SCALE_INVALID"
	AnalogCodeStale             = "ANALOG_STALE"
	AnalogCodeTargetLocked      = "ANALOG_TARGET_LOCKED"
	AnalogCodeTargetHasRows     = "ANALOG_TARGET_HAS_ROWS"
	AnalogCodeIdempotencyClash  = "ANALOG_IDEMPOTENCY_CONFLICT"
	AnalogCodeForeignChildren   = "ANALOG_FOREIGN_CHILDREN"
	AnalogCodeNotActive         = "ANALOG_NOT_ACTIVE"
	AnalogCodeApplicationAbsent = "ANALOG_APPLICATION_NOT_FOUND"
)

func analogErr(code, message string, extras map[string]any) *AnalogError {
	return &AnalogError{Code: code, Message: message, Extras: extras}
}
