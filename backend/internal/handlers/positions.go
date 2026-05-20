package handlers

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// positionServicer is the interface PositionHandler depends on.
type positionServicer interface {
	ListPositions(ctx context.Context, p repository.PositionListParams) ([]repository.PositionRow, error)
	ListBoqPreviewByPositions(ctx context.Context, positionIDs []string) ([]repository.BoqPreviewRow, error)
	GetPositionWithTender(ctx context.Context, id string) (*repository.PositionWithTenderRow, error)
	ListBoqItemsFullByPosition(ctx context.Context, positionID string) ([]repository.BoqItemFullRow, error)
	ListBoqItemsFullByTender(ctx context.Context, tenderID string) ([]repository.BoqItemFullRow, error)
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

// GetBoqPreview handles GET /api/v1/positions/boq-preview?position_ids=a,b,c
// — existing boq_items (subset + name embeds) for the mass-import preview.
func (h *PositionHandler) GetBoqPreview(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	raw := r.URL.Query().Get("position_ids")
	if raw == "" {
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: []repository.BoqPreviewRow{}})
		return
	}
	ids := make([]string, 0)
	for _, s := range strings.Split(raw, ",") {
		if s = strings.TrimSpace(s); s != "" {
			ids = append(ids, s)
		}
	}
	rows, err := h.svc.ListBoqPreviewByPositions(r.Context(), ids)
	if err != nil {
		apierr.InternalError("failed to load boq preview").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.BoqPreviewRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// GetPositionWithTender handles GET /api/v1/positions/{id}/with-tender.
func (h *PositionHandler) GetPositionWithTender(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing position id").Render(w)
		return
	}
	p, err := h.svc.GetPositionWithTender(r.Context(), id)
	if err != nil {
		apierr.InternalError("failed to load position").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: p})
}

// ListBoqItemsFullByPosition handles GET /api/v1/positions/{id}/boq-items-full.
func (h *PositionHandler) ListBoqItemsFullByPosition(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing position id").Render(w)
		return
	}
	rows, err := h.svc.ListBoqItemsFullByPosition(r.Context(), id)
	if err != nil {
		apierr.InternalError("failed to list boq items").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.BoqItemFullRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// ListBoqItemsFullByTender handles GET /api/v1/tenders/{id}/boq-items-full.
func (h *PositionHandler) ListBoqItemsFullByTender(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	rows, err := h.svc.ListBoqItemsFullByTender(r.Context(), id)
	if err != nil {
		apierr.InternalError("failed to list boq items").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.BoqItemFullRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
