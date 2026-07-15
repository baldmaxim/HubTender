// Package importanalysis — этап 2.1: серверный анализ Excel для «Умного
// импорта BOQ».
//
// Жёсткие границы:
//   - анализ ТОЛЬКО предлагает и нормализует входы; финансовый результат
//     (total_amount, position totals, commercial, cached grand total) считает
//     существующий server-authoritative контур этапа 0 — ни Excel, ни
//     frontend, ни preview не являются authority;
//   - никакого OCR/PDF/LLM/embeddings/fuzzy matching; номенклатура — только
//     exact normalized unique match; авто-создание номенклатуры запрещено;
//   - формулы и macros НИКОГДА не исполняются (policy §9);
//   - workbook не хранится между analyze и execute: клиент повторно передаёт
//     тот же файл, совпадение проверяется SHA-256 fingerprint.
package importanalysis

// Лимиты workbook (§15) — выбраны после аудита типичных смет проекта
// (сотни-тысячи строк, ≤30 колонок, единицы листов) с многократным запасом.
const (
	MaxCompressedBytes   = 20 << 20  // 20 MB upload
	MaxZipEntries        = 500       // защитный предел структуры xlsx
	MaxUncompressedBytes = 200 << 20 // 200 MB суммарно (zip-bomb guard)
	MaxCompressionRatio  = 400       // suspicious ratio
	MaxSheets            = 20
	MaxRowsPerSheet      = 60000
	MaxColumnsPerSheet   = 120
	MaxCellChars         = 32767 // предел Excel
	HeaderScanRows       = 50    // §6: документированная константа
	PreviewRowsLimit     = 200
	CloseSheetScoreDelta = 0.15 // §6: близкие score → подтверждение пользователя
)

// Confidence.
const (
	ConfidenceHigh       = "high"
	ConfidenceMedium     = "medium"
	ConfidenceLow        = "low"
	ConfidenceUnresolved = "unresolved"
)

// Severity строковых issues (§11).
const (
	SeverityBlocker     = "blocker"
	SeverityWarning     = "warning"
	SeverityInformation = "information"
)

// Статусы строк preview.
const (
	RowReady   = "ready"
	RowWarning = "warning"
	RowBlocked = "blocked"
	RowSkipped = "skipped"
)

// Коды пропуска строк (§12).
const (
	SkipEmpty        = "SKIPPED_EMPTY"
	SkipFooter       = "SKIPPED_FOOTER"
	SkipRepeatHeader = "SKIPPED_REPEAT_HEADER"
	SkipSectionRow   = "SKIPPED_SECTION_ROW"
)

// Field codes (§5) — только поля, поддерживаемые текущим import flow.
const (
	FieldPositionRef     = "position_ref" // № позиции заказчика (существующей)
	FieldBoqType         = "boq_item_type"
	FieldDescription     = "description"
	FieldUnit            = "unit_code"
	FieldQuantity        = "quantity"
	FieldBaseQuantity    = "base_quantity"
	FieldConversionCoeff = "conversion_coefficient"
	FieldUnitRate        = "unit_rate"
	FieldCurrency        = "currency_type"
	FieldConsumption     = "consumption_coefficient"
	FieldDeliveryType    = "delivery_price_type"
	FieldDeliveryAmount  = "delivery_amount"
	FieldNomenclature    = "nomenclature" // exact match в work/material names по типу
	FieldDetailCategory  = "detail_cost_category"
	FieldParentRef       = "parent_ref" // явная ссылка на temp/row работодателя
	FieldTempID          = "temp_id"
	FieldQuoteLink       = "quote_link"
	FieldQuotePriceDate  = "quote_price_date"
	FieldQuoteValidUntil = "quote_valid_until"
	// Diagnostic-only (§5): НИКОГДА не входит в financial persistence mapping.
	FieldClientTotal = "client_total_diagnostic"
)

// ValueKind — профиль значений колонки.
const (
	KindNumber = "number"
	KindText   = "text"
	KindDate   = "date"
	KindEnum   = "enum"
)

// FieldSpec — канонический registry-элемент (§7).
type FieldSpec struct {
	Code           string
	Label          string
	Required       bool
	Kind           string
	Aliases        []string // нормализованные exact-алиасы заголовков
	DiagnosticOnly bool
}

// Cell — нормализованное представление ячейки (§2A).
type Cell struct {
	Raw       string // отображаемое/каше-значение
	IsFormula bool
	Formula   string
}

// Sheet — лист workbook.
type Sheet struct {
	Name    string
	Visible bool
	Rows    [][]Cell
}

// Workbook — прочитанный файл (reader не считает финансы).
type Workbook struct {
	FileName    string
	Fingerprint string // SHA-256 исходных bytes
	Sheets      []Sheet
}

// SheetInfo — сводка листа в ответе analyze.
type SheetInfo struct {
	Name            string  `json:"name"`
	RowsDetected    int     `json:"rows_detected"`
	ColumnsDetected int     `json:"columns_detected"`
	Suggested       bool    `json:"suggested"`
	Score           float64 `json:"score"`
}

// MappingCandidate — альтернативный вариант колонки.
type MappingCandidate struct {
	SourceColumn string  `json:"source_column"`
	SourceHeader string  `json:"source_header"`
	Score        float64 `json:"score"`
}

// Mapping — предложение сопоставления (§7).
type Mapping struct {
	TargetField       string             `json:"target_field"`
	Label             string             `json:"label"`
	SourceColumn      string             `json:"source_column,omitempty"` // "" = не назначено
	SourceHeader      string             `json:"source_header,omitempty"`
	Confidence        string             `json:"confidence"`
	ConfidencePercent int                `json:"confidence_percent"`
	Reasons           []string           `json:"reasons,omitempty"`
	Required          bool               `json:"required"`
	Candidates        []MappingCandidate `json:"candidates,omitempty"`
	FixedValue        string             `json:"fixed_value,omitempty"` // §8: фиксированный тип/валюта
	DiagnosticOnly    bool               `json:"diagnostic_only,omitempty"`
}

// Issue — проблема строки/файла (§11). ID стабилен:
// fingerprint+sheet+row+field+code.
type Issue struct {
	ID           string `json:"id"`
	Code         string `json:"code"`
	Severity     string `json:"severity"`
	Sheet        string `json:"sheet"`
	ExcelRow     int    `json:"excel_row"` // 1-based как в Excel; 0 = файл/лист
	SourceColumn string `json:"source_column,omitempty"`
	TargetField  string `json:"target_field,omitempty"`
	RawValue     string `json:"raw_value,omitempty"`
	Normalized   string `json:"normalized_value,omitempty"`
	Message      string `json:"message"`
	FixHint      string `json:"fix_hint,omitempty"`
}

// Transformation — что именно система изменила (§8).
type Transformation struct {
	Field      string `json:"field"`
	Raw        string `json:"raw"`
	Normalized string `json:"normalized"`
	Code       string `json:"code"`
	Message    string `json:"message"`
}

// PreviewRow — строка preview (§13).
type PreviewRow struct {
	ExcelRow        int               `json:"excel_row"`
	Status          string            `json:"status"` // ready|warning|blocked|skipped
	SkipCode        string            `json:"skip_code,omitempty"`
	PositionRef     string            `json:"position_ref,omitempty"`
	BoqType         string            `json:"boq_item_type,omitempty"`
	Description     string            `json:"description,omitempty"`
	Unit            string            `json:"unit_code,omitempty"`
	Quantity        *float64          `json:"quantity,omitempty"`
	UnitRate        *float64          `json:"unit_rate,omitempty"`
	Currency        string            `json:"currency_type,omitempty"`
	Nomenclature    string            `json:"nomenclature,omitempty"`
	Raw             map[string]string `json:"raw,omitempty"`
	Transformations []Transformation  `json:"transformations,omitempty"`
	IssueIDs        []string          `json:"issue_ids,omitempty"`
}

// Summary — счётчики analyze.
type Summary struct {
	RowsTotal               int `json:"rows_total"`
	RowsReady               int `json:"rows_ready"`
	RowsWithWarnings        int `json:"rows_with_warnings"`
	RowsBlocked             int `json:"rows_blocked"`
	RowsSkipped             int `json:"rows_skipped"`
	RequiredMappingsMissing int `json:"required_mappings_missing"`
	FormulaConfirmations    int `json:"formula_confirmations_required"`
}

// DetectedFormats — распознанные форматы (§3).
type DetectedFormats struct {
	DecimalSeparator   string   `json:"decimal_separator"` // ',' | '.' | 'mixed'
	ThousandsSeparator string   `json:"thousands_separator,omitempty"`
	Currencies         []string `json:"currencies,omitempty"`
	DateLayouts        []string `json:"date_layouts,omitempty"`
}

// Result — полный результат analyze (§3).
type Result struct {
	WorkbookFingerprint string          `json:"workbook_fingerprint"`
	FileName            string          `json:"file_name"`
	Sheets              []SheetInfo     `json:"sheets"`
	SelectedSheet       string          `json:"selected_sheet"`
	SheetConfidence     string          `json:"sheet_confidence"`
	DetectedHeaderRow   int             `json:"detected_header_row"` // 1-based Excel row
	Mapping             []Mapping       `json:"mapping"`
	DetectedFormats     DetectedFormats `json:"detected_formats"`
	Summary             Summary         `json:"summary"`
	PreviewRows         []PreviewRow    `json:"preview_rows"`
	Issues              []Issue         `json:"issues"`
}

// Options — параметры analyze/execute.
type Options struct {
	SheetName string
	HeaderRow int // 1-based; 0 = auto
	Locale    string
	// Overrides mapping: target field → source column ("" = снять; "=<v>" =
	// фиксированное значение для всего диапазона).
	MappingOverrides map[string]string
	// Confirmed options (§9/§11): подтверждения пользователя.
	AcceptFormulaCached bool
	DefaultCurrency     string // подтверждённая валюта при отсутствии колонки
	DefaultBoqType      string // подтверждённый тип при отсутствии колонки
	AcceptParentIndent  bool   // подтверждение parent-предложений (не используется без надёжной колонки)

	// Этап 2.2: подтверждённые пользователем выборы номенклатуры для
	// unresolved-строк: row reference ("sheet|excelRow") → catalog ID.
	// Источник (exact|ai_confirmed|manual) валидируется сервисом; сами ID
	// повторно проверяются против справочника (§13).
	NomenclatureSelections map[string]string
	SelectionSources       map[string]string
}

// Refs — точные справочники для enrichment (§2C; батч-загрузка без N+1).
type Refs struct {
	Units          map[string]string   // normalized alias → canonical code
	Currencies     map[string]string   // normalized alias → canonical enum
	BoqTypes       map[string]string   // normalized alias → canonical enum
	WorkNames      map[string][]string // normalized name → IDs (для exact/ambiguous)
	MaterialNames  map[string][]string
	WorkNameUnits  map[string]string // ID → unit (валидация выбора, этап 2.2)
	MatNameUnits   map[string]string
	DetailCats     map[string][]string // normalized "name" и "name|location" → IDs
	Positions      map[string]string   // normalized position ref (номер/item_no) → position ID
	PositionLabels map[string]string   // position ID → label
}
