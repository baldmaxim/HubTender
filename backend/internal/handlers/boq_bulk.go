package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// bulkBoqServicer is the interface BulkBoqHandler depends on.
//
// Stage 0.1.2.2: there is deliberately NO commercial-cost write method here. The
// handler physically cannot reach a commercial writer, so the retired endpoint
// cannot mutate anything even by accident.
type bulkBoqServicer interface {
	SetQuoteLinkByName(ctx context.Context, tenderID, field, value string, quoteLink *string, changedBy string) (int, error)
	SetQuoteLinkByIDs(ctx context.Context, ids []string, quoteLink *string, changedBy string) (int, error)
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

// bulkCommercialResp is the response body of the quote-link endpoints.
type bulkCommercialResp struct {
	Updated int `json:"updated"`
}

// RetiredBulkCommercial is the TOMBSTONE for PATCH /api/v1/items/bulk-commercial.
//
// The endpoint used to accept commercial_markup / total_commercial_material_cost /
// total_commercial_work_cost straight from a client and write them to boq_items.
// Those three columns are CALCULATION RESULTS: they may only be produced by the
// authoritative kernel (backend/internal/calc) and persisted by the internal,
// tender-scoped CommercialRecalcService. A public write contract for them is
// architecturally invalid, so the route is retired rather than validated.
//
// It ALWAYS answers 410 Gone and, by construction:
//   - never decodes or validates the request body (valid, invalid and empty
//     bodies are answered identically);
//   - never calls a service or repository;
//   - performs no mutation, no cache invalidation and no recalc;
//   - can never return 200 for any payload.
//
// The route stays registered on purpose — a silent 404 would look like a routing
// bug rather than a deliberate retirement.
func (h *BulkBoqHandler) RetiredBulkCommercial(w http.ResponseWriter, _ *http.Request) {
	apierr.Gone(
		"Коммерческие стоимости рассчитываются сервером и не принимаются от клиента.",
		"COMMERCIAL_COST_WRITE_RETIRED",
	).Render(w)
}

type quoteLinkByNameReq struct {
	Field     string  `json:"field"      validate:"required,oneof=material_name_id work_name_id"`
	Value     string  `json:"value"      validate:"required,uuid"`
	QuoteLink *string `json:"quote_link"`
}

// SetQuoteLinkByName handles PATCH /api/v1/tenders/{id}/boq/quote-link.
func (h *BulkBoqHandler) SetQuoteLinkByName(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
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
	count, err := h.svc.SetQuoteLinkByName(r.Context(), tenderID, req.Field, req.Value, req.QuoteLink, authUser.ID)
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
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
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
	count, err := h.svc.SetQuoteLinkByIDs(r.Context(), req.IDs, req.QuoteLink, authUser.ID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to update quote link")
		return
	}
	renderJSON(w, r, http.StatusOK, bulkCommercialResp{Updated: count})
}
