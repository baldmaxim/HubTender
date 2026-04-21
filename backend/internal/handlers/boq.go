package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// boqServicer is the interface BoqHandler depends on.
type boqServicer interface {
	ListBoqItems(ctx context.Context, tenderID, positionID string) ([]repository.BoqItemRow, error)
}

// BoqHandler serves the /api/v1/tenders/:id/positions/:posId/items endpoint.
type BoqHandler struct {
	svc boqServicer
}

// NewBoqHandler creates a BoqHandler.
func NewBoqHandler(svc boqServicer) *BoqHandler {
	return &BoqHandler{svc: svc}
}

// GetBoqItems handles GET /api/v1/tenders/:id/positions/:posId/items.
// Returns all BOQ items for the position ordered by sort_number.
func (h *BoqHandler) GetBoqItems(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	positionID := chi.URLParam(r, "posId")

	if tenderID == "" || positionID == "" {
		apierr.BadRequest("missing tender or position id").Render(w)
		return
	}

	rows, err := h.svc.ListBoqItems(r.Context(), tenderID, positionID)
	if err != nil {
		apierr.InternalError("failed to list BOQ items").Render(w)
		return
	}

	if rows == nil {
		rows = []repository.BoqItemRow{}
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
