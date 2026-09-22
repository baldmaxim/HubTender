package pricing

import (
	"encoding/json"
	"time"
)

type Principal struct {
	UserID   string
	Email    string
	RoleCode string
	Scopes   []string
	ClientID string
}

type Page struct {
	Limit      int  `json:"limit"`
	Offset     int  `json:"offset"`
	TotalCount int  `json:"total_count"`
	HasMore    bool `json:"has_more"`
	NextOffset *int `json:"next_offset,omitempty"`
}

type TenderSummary struct {
	ID                 string     `json:"id"`
	TenderNumber       string     `json:"tender_number"`
	Title              string     `json:"title"`
	ClientName         string     `json:"client_name"`
	Version            *int64     `json:"version,omitempty"`
	IsArchived         bool       `json:"is_archived"`
	HousingClass       *string    `json:"housing_class,omitempty"`
	ConstructionScope  *string    `json:"construction_scope,omitempty"`
	SubmissionDeadline *time.Time `json:"submission_deadline,omitempty"`
	UpdatedAt          time.Time  `json:"updated_at"`
}

type PositionPricingState struct {
	ID                string   `json:"id"`
	PositionNumber    float64  `json:"position_number"`
	WorkName          string   `json:"work_name"`
	UnitCode          *string  `json:"unit_code,omitempty"`
	Volume            *float64 `json:"volume,omitempty"`
	ManualVolume      *float64 `json:"manual_volume,omitempty"`
	ItemsCount        int      `json:"items_count"`
	PricedItems       int      `json:"priced_items"`
	MissingRates      int      `json:"missing_rates"`
	MissingCategories int      `json:"missing_categories"`
	DirectTotal       float64  `json:"direct_total"`
}

type PricingState struct {
	Tender           TenderSummary          `json:"tender"`
	PositionCount    int                    `json:"position_count"`
	ItemCount        int                    `json:"item_count"`
	PricedItemCount  int                    `json:"priced_item_count"`
	MissingRateCount int                    `json:"missing_rate_count"`
	DirectTotal      float64                `json:"direct_total"`
	Positions        []PositionPricingState `json:"positions"`
	Pagination       Page                   `json:"pagination"`
}

type ArchiveSearchInput struct {
	Query                string
	Kind                 string
	UnitCode             string
	DetailCostCategoryID string
	HousingClass         string
	ConstructionScope    string
	IncludeActive        bool
	Limit                int
	Offset               int
}

type ArchiveCandidate struct {
	ItemID                 string    `json:"item_id"`
	TenderID               string    `json:"tender_id"`
	TenderTitle            string    `json:"tender_title"`
	TenderNumber           string    `json:"tender_number"`
	TenderVersion          *int64    `json:"tender_version,omitempty"`
	TenderArchived         bool      `json:"tender_archived"`
	TenderDate             time.Time `json:"tender_date"`
	HousingClass           *string   `json:"housing_class,omitempty"`
	ConstructionScope      *string   `json:"construction_scope,omitempty"`
	PositionID             string    `json:"position_id"`
	PositionName           string    `json:"position_name"`
	ItemName               string    `json:"item_name"`
	ItemKind               string    `json:"item_kind"`
	BoqItemType            string    `json:"boq_item_type"`
	UnitCode               *string   `json:"unit_code,omitempty"`
	Quantity               *float64  `json:"quantity,omitempty"`
	UnitRate               *float64  `json:"unit_rate,omitempty"`
	CurrencyType           *string   `json:"currency_type,omitempty"`
	DeliveryPriceType      *string   `json:"delivery_price_type,omitempty"`
	DeliveryAmount         *float64  `json:"delivery_amount,omitempty"`
	ConsumptionCoefficient *float64  `json:"consumption_coefficient,omitempty"`
	DetailCostCategoryID   *string   `json:"detail_cost_category_id,omitempty"`
	DetailCostCategoryName *string   `json:"detail_cost_category_name,omitempty"`
	MaterialNameID         *string   `json:"material_name_id,omitempty"`
	WorkNameID             *string   `json:"work_name_id,omitempty"`
	MaterialType           *string   `json:"material_type,omitempty"`
	Description            *string   `json:"description,omitempty"`
	QuoteLink              *string   `json:"quote_link,omitempty"`
	QuotePriceDate         *string   `json:"quote_price_date,omitempty"`
	QuoteValidUntil        *string   `json:"quote_valid_until,omitempty"`
	HistoricalRUBUnitRate  *float64  `json:"historical_rub_unit_rate,omitempty"`
	RawSimilarity          float64   `json:"raw_similarity"`
	Confidence             float64   `json:"confidence"`
	MatchLevel             string    `json:"match_level"`
	Warnings               []string  `json:"warnings"`
	Rationale              string    `json:"rationale"`
}

type LibraryCandidate struct {
	ID                     string   `json:"id"`
	Kind                   string   `json:"kind"`
	Name                   string   `json:"name"`
	NameID                 string   `json:"name_id"`
	UnitCode               string   `json:"unit_code"`
	ItemType               string   `json:"item_type"`
	MaterialType           *string  `json:"material_type,omitempty"`
	UnitRate               float64  `json:"unit_rate"`
	CurrencyType           string   `json:"currency_type"`
	DeliveryPriceType      *string  `json:"delivery_price_type,omitempty"`
	DeliveryAmount         *float64 `json:"delivery_amount,omitempty"`
	ConsumptionCoefficient *float64 `json:"consumption_coefficient,omitempty"`
	Confidence             float64  `json:"confidence"`
}

type TemplateSummary struct {
	ID                   string    `json:"id"`
	Name                 string    `json:"name"`
	DetailCostCategoryID *string   `json:"detail_cost_category_id,omitempty"`
	FolderID             *string   `json:"folder_id,omitempty"`
	ItemsCount           int       `json:"items_count"`
	UpdatedAt            time.Time `json:"updated_at"`
}

type TemplateItem struct {
	ID                     string   `json:"id"`
	Kind                   string   `json:"kind"`
	Position               int      `json:"position"`
	ParentTemplateItemID   *string  `json:"parent_template_item_id,omitempty"`
	ItemType               string   `json:"item_type"`
	Name                   string   `json:"name"`
	NameID                 string   `json:"name_id"`
	UnitCode               string   `json:"unit_code"`
	UnitRate               float64  `json:"unit_rate"`
	CurrencyType           string   `json:"currency_type"`
	MaterialType           *string  `json:"material_type,omitempty"`
	DeliveryPriceType      *string  `json:"delivery_price_type,omitempty"`
	DeliveryAmount         *float64 `json:"delivery_amount,omitempty"`
	ConsumptionCoefficient *float64 `json:"consumption_coefficient,omitempty"`
	ConversionCoefficient  *float64 `json:"conversion_coefficient,omitempty"`
	DetailCostCategoryID   *string  `json:"detail_cost_category_id,omitempty"`
	Note                   *string  `json:"note,omitempty"`
}

type TemplateDetail struct {
	TemplateSummary
	Items []TemplateItem `json:"items"`
}

type ProposedItem struct {
	BoqItemType            string   `json:"boq_item_type"`
	MaterialType           *string  `json:"material_type,omitempty"`
	Description            *string  `json:"description,omitempty"`
	UnitCode               *string  `json:"unit_code,omitempty"`
	Quantity               *float64 `json:"quantity,omitempty"`
	BaseQuantity           *float64 `json:"base_quantity,omitempty"`
	ConversionCoefficient  *float64 `json:"conversion_coefficient,omitempty"`
	UnitRate               *float64 `json:"unit_rate,omitempty"`
	CurrencyType           *string  `json:"currency_type,omitempty"`
	DeliveryPriceType      *string  `json:"delivery_price_type,omitempty"`
	DeliveryAmount         *float64 `json:"delivery_amount,omitempty"`
	ConsumptionCoefficient *float64 `json:"consumption_coefficient,omitempty"`
	DetailCostCategoryID   *string  `json:"detail_cost_category_id,omitempty"`
	MaterialNameID         *string  `json:"material_name_id,omitempty"`
	WorkNameID             *string  `json:"work_name_id,omitempty"`
	QuoteLink              *string  `json:"quote_link,omitempty"`
	QuotePriceDate         *string  `json:"quote_price_date,omitempty"`
	QuoteValidUntil        *string  `json:"quote_valid_until,omitempty"`
	SortNumber             *int     `json:"sort_number,omitempty"`
}

type SourceRef struct {
	TenderID   *string    `json:"tender_id,omitempty"`
	ItemID     *string    `json:"item_id,omitempty"`
	TemplateID *string    `json:"template_id,omitempty"`
	LibraryID  *string    `json:"library_id,omitempty"`
	Rate       *float64   `json:"rate,omitempty"`
	Currency   *string    `json:"currency,omitempty"`
	Date       *time.Time `json:"date,omitempty"`
}

type Draft struct {
	ID             string           `json:"id"`
	TenderID       string           `json:"tender_id"`
	CreatedBy      string           `json:"created_by"`
	Status         string           `json:"status"`
	BaseRevision   time.Time        `json:"base_revision"`
	ValidationHash *string          `json:"validation_hash,omitempty"`
	Summary        json.RawMessage  `json:"summary"`
	ValidatedAt    *time.Time       `json:"validated_at,omitempty"`
	ExpiresAt      time.Time        `json:"expires_at"`
	AppliedAt      *time.Time       `json:"applied_at,omitempty"`
	CancelledAt    *time.Time       `json:"cancelled_at,omitempty"`
	CreatedAt      time.Time        `json:"created_at"`
	UpdatedAt      time.Time        `json:"updated_at"`
	Operations     []DraftOperation `json:"operations,omitempty"`
	Events         []DraftEvent     `json:"events,omitempty"`
}

type DraftOperation struct {
	ID                string          `json:"id"`
	DraftID           string          `json:"draft_id"`
	Action            string          `json:"action"`
	TargetPositionID  string          `json:"target_position_id"`
	TargetItemID      *string         `json:"target_item_id,omitempty"`
	ParentOperationID *string         `json:"parent_operation_id,omitempty"`
	ExpectedETag      *string         `json:"expected_etag,omitempty"`
	ProposedPayload   ProposedItem    `json:"proposed_payload"`
	SourceKind        string          `json:"source_kind"`
	SourceRef         SourceRef       `json:"source_ref"`
	MatchLevel        string          `json:"match_level"`
	Confidence        float64         `json:"confidence"`
	Rationale         *string         `json:"rationale,omitempty"`
	Warnings          []string        `json:"warnings"`
	PositionOrder     int             `json:"position_order"`
	CreatedAt         time.Time       `json:"created_at"`
	RawPayload        json.RawMessage `json:"-"`
}

type DraftEvent struct {
	EventType string          `json:"event_type"`
	ActorID   string          `json:"actor_id"`
	Details   json.RawMessage `json:"details"`
	CreatedAt time.Time       `json:"created_at"`
}

type ValidationSummary struct {
	DraftID             string    `json:"draft_id"`
	Status              string    `json:"status"`
	ValidationHash      string    `json:"validation_hash"`
	OperationsCount     int       `json:"operations_count"`
	CreateCount         int       `json:"create_count"`
	UpdateCount         int       `json:"update_count"`
	WarningsCount       int       `json:"warnings_count"`
	BlockingErrors      []string  `json:"blocking_errors"`
	BeforeDirectTotal   float64   `json:"before_direct_total"`
	AfterDirectTotal    float64   `json:"after_direct_total"`
	DeltaDirectTotal    float64   `json:"delta_direct_total"`
	UnresolvedPositions int       `json:"unresolved_positions"`
	ValidatedAt         time.Time `json:"validated_at"`
}

type ApplyResult struct {
	DraftID           string    `json:"draft_id"`
	Status            string    `json:"status"`
	CreatedItems      int       `json:"created_items"`
	UpdatedItems      int       `json:"updated_items"`
	AffectedPositions []string  `json:"affected_positions"`
	AppliedAt         time.Time `json:"applied_at"`
}

type QAReport struct {
	TenderID               string    `json:"tender_id"`
	PositionCount          int       `json:"position_count"`
	LeafPositionCount      int       `json:"leaf_position_count"`
	UnpricedPositionCount  int       `json:"unpriced_position_count"`
	ItemCount              int       `json:"item_count"`
	MissingRateCount       int       `json:"missing_rate_count"`
	MissingQuantityCount   int       `json:"missing_quantity_count"`
	MissingCategoryCount   int       `json:"missing_category_count"`
	MissingFXCurrencies    []string  `json:"missing_fx_currencies"`
	WeakSourceCount        int       `json:"weak_source_count"`
	StaleSourceCount       int       `json:"stale_source_count"`
	ItemsWithoutProvenance int       `json:"items_without_provenance"`
	DirectTotal            float64   `json:"direct_total"`
	ReadyForReview         bool      `json:"ready_for_review"`
	BlockingIssues         []string  `json:"blocking_issues"`
	GeneratedAt            time.Time `json:"generated_at"`
}
