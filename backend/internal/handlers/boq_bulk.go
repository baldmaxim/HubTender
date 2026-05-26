package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// bulkBoqServicer is the interface BulkBoqHandler depends on.
type bulkBoqServicer interface {
	BulkUpdateCommercial(ctx context.Context, rows []repository.BulkCommercialRow) (int, error)
	SetQuoteLinkByName(ctx context.Context, tenderID, field, value string, quoteLink *string) (int, error)
	SetQuoteLinkByIDs(ctx context.Context, ids []string, quoteLink *string) (int, error)
}

// BulkBoqHandler handles bulk BOQ mutation endpoints.
type BulkBoqHandler struct {
	svc      bulkBoqServicer
	validate *validator.Validate
}

// NewBulkBoqHandler creates a BulkBoqHandler.
func NewBulkBoqHandler(svc bulkBoqServicer) *BulkBoqHandler {
	return &BulkBoqHandler{svc: svc, validate: validator.New()}
}

// bulkCommercialReq is the request body for PATCH /api/v1/items/bulk-commercial.
type bulkCommercialReq struct {
	Rows []repository.BulkCommercialRow `json:"rows" validate:"required,min=1,dive"`
}

// bulkCommercialResp is the response body.
type bulkCommercialResp struct {
	Updated int `json:"updated"`
}

// BulkUpdateCommercial handles PATCH /api/v1/items/bulk-commercial.
// Intentionally skips If-Match (bulk path, matches original RPC behaviour).
// No audit entries are written (matches original RPC behaviour).
func (h *BulkBoqHandler) BulkUpdateCommercial(w http.ResponseWriter, r *http.Request) {
	var req bulkCommercialReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	count, err := h.svc.BulkUpdateCommercial(r.Context(), req.Rows)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to bulk-update commercial costs")
		return
	}

	renderJSON(w, r, http.StatusOK, bulkCommercialResp{Updated: count})
}

type quoteLinkByNameReq struct {
	Field     string  `json:"field"      validate:"required,oneof=material_name_id work_name_id"`
	Value     string  `json:"value"      validate:"required,uuid"`
	QuoteLink *string `json:"quote_link"`
}

// SetQuoteLinkByName handles PATCH /api/v1/tenders/{id}/boq/quote-link.
func (h *BulkBoqHandler) SetQuoteLinkByName(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	var req quoteLinkByNameReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}
	count, err := h.svc.SetQuoteLinkByName(r.Context(), tenderID, req.Field, req.Value, req.QuoteLink)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to update quote link")
		return
	}
	renderJSON(w, r, http.StatusOK, bulkCommercialResp{Updated: count})
}

type quoteLinkByIDsReq struct {
	IDs       []string `json:"ids"        validate:"required,min=1,dive,uuid"`
	QuoteLink *string  `json:"quote_link"`
}

// SetQuoteLinkByIDs handles PATCH /api/v1/boq/quote-link-by-ids.
func (h *BulkBoqHandler) SetQuoteLinkByIDs(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req quoteLinkByIDsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}
	count, err := h.svc.SetQuoteLinkByIDs(r.Context(), req.IDs, req.QuoteLink)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to update quote link")
		return
	}
	renderJSON(w, r, http.StatusOK, bulkCommercialResp{Updated: count})
}
