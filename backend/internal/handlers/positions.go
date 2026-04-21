package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// positionServicer is the interface PositionHandler depends on.
type positionServicer interface {
	ListPositions(ctx context.Context, p repository.PositionListParams) ([]repository.PositionRow, error)
}

// PositionHandler serves the /api/v1/tenders/:id/positions endpoint.
type PositionHandler struct {
	svc positionServicer
}

// NewPositionHandler creates a PositionHandler.
func NewPositionHandler(svc positionServicer) *PositionHandler {
	return &PositionHandler{svc: svc}
}

// positionListEnvelope is {"data": [...], "next_cursor": "..."}.
type positionListEnvelope struct {
	Data       []repository.PositionRow `json:"data"`
	NextCursor string                   `json:"next_cursor,omitempty"`
}

// GetPositions handles GET /api/v1/tenders/:id/positions.
// Query params: cursor, limit (1-200).
func (h *PositionHandler) GetPositions(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	q := r.URL.Query()
	p := repository.PositionListParams{
		TenderID: tenderID,
		Limit:    parseLimitParam(q.Get("limit"), 50),
	}

	if cur := q.Get("cursor"); cur != "" {
		ua, id, err := decodeCursor(cur)
		if err != nil {
			apierr.BadRequest("invalid cursor").Render(w)
			return
		}
		p.CursorUpdatedAt = &ua
		p.CursorID = &id
	}

	rows, err := h.svc.ListPositions(r.Context(), p)
	if err != nil {
		apierr.InternalError("failed to list positions").Render(w)
		return
	}

	if rows == nil {
		rows = []repository.PositionRow{}
	}

	env := positionListEnvelope{Data: rows}
	if len(rows) == p.Limit {
		last := rows[len(rows)-1]
		env.NextCursor = encodeCursor(last.UpdatedAt, last.ID)
	}

	renderJSON(w, r, http.StatusOK, env)
}
