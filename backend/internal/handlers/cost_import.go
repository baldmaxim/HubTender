package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// costImportServicer is the interface CostImportHandler depends on.
type costImportServicer interface {
	Import(ctx context.Context, categories []repository.CostImportCategory, details []repository.CostImportDetail) (int, error)
}

// CostImportHandler handles POST /api/v1/cost-import.
type CostImportHandler struct {
	svc costImportServicer
}

// NewCostImportHandler creates a CostImportHandler.
func NewCostImportHandler(svc costImportServicer) *CostImportHandler {
	return &CostImportHandler{svc: svc}
}

type costImportReq struct {
	Categories []repository.CostImportCategory `json:"categories"`
	Details    []repository.CostImportDetail   `json:"detail_items"`
}

type costImportResp struct {
	RecordsAdded int `json:"records_added"`
}

// Import handles POST /api/v1/cost-import — atomic Excel cost-category import.
func (h *CostImportHandler) Import(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req costImportReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if len(req.Details) == 0 {
		apierr.BadRequest("detail_items required").Render(w)
		return
	}
	n, err := h.svc.Import(r.Context(), req.Categories, req.Details)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to import cost categories")
		return
	}
	renderJSON(w, r, http.StatusOK, costImportResp{RecordsAdded: n})
}
