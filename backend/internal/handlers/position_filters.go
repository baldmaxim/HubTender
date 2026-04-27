package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// positionFiltersServicer is the interface PositionFiltersHandler depends on.
type positionFiltersServicer interface {
	List(ctx context.Context, userID, tenderID string) ([]string, error)
	Replace(ctx context.Context, userID, tenderID string, positionIDs []string) error
	Append(ctx context.Context, userID, tenderID, positionID string) error
	Clear(ctx context.Context, userID, tenderID string) error
}

// PositionFiltersHandler serves /api/v1/tenders/{id}/position-filters.
// userID is taken from the JWT — clients cannot read or modify someone
// else's filter.
type PositionFiltersHandler struct {
	svc positionFiltersServicer
}

// NewPositionFiltersHandler creates a PositionFiltersHandler.
func NewPositionFiltersHandler(svc positionFiltersServicer) *PositionFiltersHandler {
	return &PositionFiltersHandler{svc: svc}
}

func (h *PositionFiltersHandler) List(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	ids, err := h.svc.List(r.Context(), authUser.ID, tenderID)
	if err != nil {
		apierr.InternalError("failed to load filter").Render(w)
		return
	}
	if ids == nil {
		ids = []string{}
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: ids})
}

type replaceFilterReq struct {
	PositionIDs []string `json:"position_ids"`
}

func (h *PositionFiltersHandler) Replace(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req replaceFilterReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}

	if err := h.svc.Replace(r.Context(), authUser.ID, tenderID, req.PositionIDs); err != nil {
		apierr.InternalError("failed to save filter").Render(w)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

type appendFilterReq struct {
	PositionID string `json:"position_id"`
}

func (h *PositionFiltersHandler) Append(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req appendFilterReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if req.PositionID == "" {
		apierr.BadRequest("position_id is required").Render(w)
		return
	}

	if err := h.svc.Append(r.Context(), authUser.ID, tenderID, req.PositionID); err != nil {
		apierr.InternalError("failed to append filter entry").Render(w)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *PositionFiltersHandler) Clear(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	if err := h.svc.Clear(r.Context(), authUser.ID, tenderID); err != nil {
		apierr.InternalError("failed to clear filter").Render(w)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
