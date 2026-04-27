package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// fiServicer is the interface FIHandler depends on.
type fiServicer interface {
	GetTenderByID(ctx context.Context, id string) (*repository.FITenderRow, error)
	ListAllBoqItemsForTender(ctx context.Context, tenderID string) ([]repository.FIBoqItemRow, error)
}

// FIHandler serves heavy aggregate reads for FinancialIndicators.
type FIHandler struct {
	svc fiServicer
}

// NewFIHandler creates an FIHandler.
func NewFIHandler(svc fiServicer) *FIHandler {
	return &FIHandler{svc: svc}
}

// GetTenderByID handles GET /api/v1/tenders/{id} (FI projection).
func (h *FIHandler) GetTenderByID(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	row, err := h.svc.GetTenderByID(r.Context(), id)
	if err != nil {
		apierr.InternalError("failed to load tender").Render(w)
		return
	}
	if row == nil {
		apierr.NotFound("tender not found").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

// ListBoqItemsFlat handles GET /api/v1/tenders/{id}/boq-items-flat.
func (h *FIHandler) ListBoqItemsFlat(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	rows, err := h.svc.ListAllBoqItemsForTender(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to list boq items").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.FIBoqItemRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
