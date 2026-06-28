package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// positionCostsServicer is the interface PositionCostsHandler depends on.
type positionCostsServicer interface {
	GetPositionsWithCosts(ctx context.Context, tenderID string) ([]repository.PositionWithCostsRow, error)
	InvalidateCache(tenderID string)
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

	// Cache-Control: no-cache (sent by the frontend on realtime-triggered
	// refetches) forces a cache miss so the note/manual_note is as fresh as the
	// uncached boq-items-flat path. Without this, the 30s server cache can serve
	// a stale note to an observer right after another user edited it.
	if strings.Contains(r.Header.Get("Cache-Control"), "no-cache") {
		h.svc.InvalidateCache(tenderID)
	}

	rows, err := h.svc.GetPositionsWithCosts(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to load positions with costs")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
