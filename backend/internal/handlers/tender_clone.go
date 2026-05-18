package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// cloneServicer is the interface TenderCloneHandler depends on.
type cloneServicer interface {
	CloneTender(ctx context.Context, sourceTenderID string) (*repository.CloneResult, error)
}

// TenderCloneHandler handles POST /api/v1/tenders/{id}/versions/clone.
type TenderCloneHandler struct {
	svc cloneServicer
}

// NewTenderCloneHandler creates a TenderCloneHandler.
func NewTenderCloneHandler(svc cloneServicer) *TenderCloneHandler {
	return &TenderCloneHandler{svc: svc}
}

// Clone handles POST /api/v1/tenders/{id}/versions/clone.
//
// {id} is the source tender UUID (no request body). On success it returns
// 201 with the CloneResult envelope. Business errors:
//   - 404 — source tender not found
//   - 500 — unexpected DB error
func (h *TenderCloneHandler) Clone(w http.ResponseWriter, r *http.Request) {
	sourceTenderID := chi.URLParam(r, "id")
	if sourceTenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	result, err := h.svc.CloneTender(r.Context(), sourceTenderID)
	if err != nil {
		var cloneErr *repository.ErrClone
		if errors.As(err, &cloneErr) {
			switch cloneErr.HTTPStatus {
			case 404:
				apierr.NotFound(cloneErr.Message).Render(w)
			default:
				apierr.InternalError(cloneErr.Message).Render(w)
			}
			return
		}
		apierr.InternalError("failed to clone tender").Render(w)
		return
	}

	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: result})
}
