package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// boqWriteServicer extends boqServicer with write methods.
type boqWriteServicer interface {
	boqServicer
	GetBoqItemByID(ctx context.Context, id string) (*repository.BoqItemRow, error)
	CreateBoqItem(ctx context.Context, in repository.CreateBoqItemInput) (*repository.BoqItemRow, error)
	UpdateBoqItem(ctx context.Context, id string, in repository.UpdateBoqItemInput) (*repository.BoqItemRow, error)
	DeleteBoqItem(ctx context.Context, id, changedBy string) (*repository.BoqItemRow, error)
}

// BoqWriteHandler handles mutating BOQ item endpoints.
type BoqWriteHandler struct {
	svc      boqWriteServicer
	validate *validator.Validate
}

// NewBoqWriteHandler creates a BoqWriteHandler.
func NewBoqWriteHandler(svc boqWriteServicer) *BoqWriteHandler {
	return &BoqWriteHandler{svc: svc, validate: validator.New()}
}

// createBoqItemReq is the request body for POST /api/v1/positions/:posId/items.
type createBoqItemReq struct {
	BoqItemType          string   `json:"boq_item_type" validate:"required"`
	MaterialType         *string  `json:"material_type"`
	Description          *string  `json:"description"`
	UnitCode             *string  `json:"unit_code"`
	Quantity             *float64 `json:"quantity" validate:"omitempty,gte=0"`
	UnitRate             *float64 `json:"unit_rate" validate:"omitempty,gte=0"`
	CurrencyType         *string  `json:"currency_type"`
	DeliveryPriceType    *string  `json:"delivery_price_type"`
	DeliveryAmount       *float64 `json:"delivery_amount" validate:"omitempty,gte=0"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id" validate:"omitempty,uuid"`
	MaterialNameID       *string  `json:"material_name_id" validate:"omitempty,uuid"`
	WorkNameID           *string  `json:"work_name_id" validate:"omitempty,uuid"`
	ParentWorkItemID     *string  `json:"parent_work_item_id" validate:"omitempty,uuid"`
	SortNumber           *int     `json:"sort_number" validate:"omitempty,gte=0"`
}

// updateBoqItemReq is the request body for PATCH /api/v1/items/:id.
type updateBoqItemReq struct {
	BoqItemType          *string  `json:"boq_item_type"`
	MaterialType         *string  `json:"material_type"`
	Description          *string  `json:"description"`
	UnitCode             *string  `json:"unit_code"`
	Quantity             *float64 `json:"quantity" validate:"omitempty,gte=0"`
	UnitRate             *float64 `json:"unit_rate" validate:"omitempty,gte=0"`
	CurrencyType         *string  `json:"currency_type"`
	DeliveryPriceType    *string  `json:"delivery_price_type"`
	DeliveryAmount       *float64 `json:"delivery_amount" validate:"omitempty,gte=0"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id" validate:"omitempty,uuid"`
	MaterialNameID       *string  `json:"material_name_id" validate:"omitempty,uuid"`
	WorkNameID           *string  `json:"work_name_id" validate:"omitempty,uuid"`
	ParentWorkItemID     *string  `json:"parent_work_item_id" validate:"omitempty,uuid"`
	SortNumber           *int     `json:"sort_number" validate:"omitempty,gte=0"`
}

// CreateBoqItem handles POST /api/v1/positions/:posId/items.
// Route is nested under /tenders/:id so chi also provides ":id" (tender).
func (h *BoqWriteHandler) CreateBoqItem(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	tenderID := chi.URLParam(r, "id")
	posID := chi.URLParam(r, "posId")
	if tenderID == "" || posID == "" {
		apierr.BadRequest("missing tender or position id").Render(w)
		return
	}

	var req createBoqItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.CreateBoqItemInput{
		ClientPositionID:     posID,
		TenderID:             tenderID,
		BoqItemType:          req.BoqItemType,
		MaterialType:         req.MaterialType,
		Description:          req.Description,
		UnitCode:             req.UnitCode,
		Quantity:             req.Quantity,
		UnitRate:             req.UnitRate,
		CurrencyType:         req.CurrencyType,
		DeliveryPriceType:    req.DeliveryPriceType,
		DeliveryAmount:       req.DeliveryAmount,
		DetailCostCategoryID: req.DetailCostCategoryID,
		MaterialNameID:       req.MaterialNameID,
		WorkNameID:           req.WorkNameID,
		ParentWorkItemID:     req.ParentWorkItemID,
		SortNumber:           req.SortNumber,
		CreatedBy:            authUser.ID,
	}

	item, err := h.svc.CreateBoqItem(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to create BOQ item").Render(w)
		return
	}

	setResourceETag(w, item.ID, item.UpdatedAt)
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: item})
}

// UpdateBoqItem handles PATCH /api/v1/items/:id.
func (h *BoqWriteHandler) UpdateBoqItem(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		apierr.BadRequest("missing item id").Render(w)
		return
	}

	current, err := h.svc.GetBoqItemByID(r.Context(), itemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("BOQ item not found").Render(w)
			return
		}
		apierr.InternalError("failed to load BOQ item").Render(w)
		return
	}

	if r.Header.Get("If-Match") == "" {
		apierr.PreconditionRequired("If-Match header is required for updates").Render(w)
		return
	}
	if !checkIfMatch(r, current.ID, current.UpdatedAt) {
		currentETag := computeResourceETag(current.ID, current.UpdatedAt)
		apierr.PreconditionFailed("resource has been modified; reload and retry", map[string]any{
			"current_etag": currentETag,
			"current":      current,
		}).Render(w)
		return
	}

	var req updateBoqItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.UpdateBoqItemInput{
		BoqItemType:          req.BoqItemType,
		MaterialType:         req.MaterialType,
		Description:          req.Description,
		UnitCode:             req.UnitCode,
		Quantity:             req.Quantity,
		UnitRate:             req.UnitRate,
		CurrencyType:         req.CurrencyType,
		DeliveryPriceType:    req.DeliveryPriceType,
		DeliveryAmount:       req.DeliveryAmount,
		DetailCostCategoryID: req.DetailCostCategoryID,
		MaterialNameID:       req.MaterialNameID,
		WorkNameID:           req.WorkNameID,
		ParentWorkItemID:     req.ParentWorkItemID,
		SortNumber:           req.SortNumber,
		ChangedBy:            authUser.ID,
	}

	updated, err := h.svc.UpdateBoqItem(r.Context(), itemID, in)
	if err != nil {
		apierr.InternalError("failed to update BOQ item").Render(w)
		return
	}

	setResourceETag(w, updated.ID, updated.UpdatedAt)
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: updated})
}

// DeleteBoqItem handles DELETE /api/v1/items/:id.
func (h *BoqWriteHandler) DeleteBoqItem(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	itemID := chi.URLParam(r, "id")
	if itemID == "" {
		apierr.BadRequest("missing item id").Render(w)
		return
	}

	current, err := h.svc.GetBoqItemByID(r.Context(), itemID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("BOQ item not found").Render(w)
			return
		}
		apierr.InternalError("failed to load BOQ item").Render(w)
		return
	}

	if r.Header.Get("If-Match") == "" {
		apierr.PreconditionRequired("If-Match header is required for deletes").Render(w)
		return
	}
	if !checkIfMatch(r, current.ID, current.UpdatedAt) {
		currentETag := computeResourceETag(current.ID, current.UpdatedAt)
		apierr.PreconditionFailed("resource has been modified; reload and retry", map[string]any{
			"current_etag": currentETag,
			"current":      current,
		}).Render(w)
		return
	}

	deleted, err := h.svc.DeleteBoqItem(r.Context(), itemID, authUser.ID)
	if err != nil {
		apierr.InternalError("failed to delete BOQ item").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: deleted})
}
