package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// positionCostsServicer is the interface PositionCostsHandler depends on.
type positionCostsServicer interface {
	GetPositionsWithCosts(ctx context.Context, tenderID string) ([]repository.PositionWithCostsRow, error)
}

// PositionCostsHandler serves GET /api/v1/tenders/{id}/positions/with-costs.
type PositionCostsHandler struct {
	svc positionCostsServicer
}

// NewPositionCostsHandler creates a PositionCostsHandler.
func NewPositionCostsHandler(svc positionCostsServicer) *PositionCostsHandler {
	return &PositionCostsHandler{svc: svc}
}

// GetPositionsWithCosts handles GET /api/v1/tenders/{id}/positions/with-costs.
// The response body is an ETag-gated JSON list. Cache-Control is set by
// renderJSON (private, max-age=60). The service layer caches for 30 s.
func (h *PositionCostsHandler) GetPositionsWithCosts(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	rows, err := h.svc.GetPositionsWithCosts(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to load positions with costs").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
