package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// bulkBoqServicer is the interface BulkBoqHandler depends on.
type bulkBoqServicer interface {
	BulkUpdateCommercial(ctx context.Context, rows []repository.BulkCommercialRow) (int, error)
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
		apierr.InternalError("failed to bulk-update commercial costs").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, bulkCommercialResp{Updated: count})
}
