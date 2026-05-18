package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// boqAuditRollbackServicer is the interface the handler depends on.
type boqAuditRollbackServicer interface {
	RollbackDeleted(ctx context.Context, auditID string) (string, error)
}

// BoqAuditRollbackHandler handles POST /api/v1/boq-audit/{auditId}/rollback.
type BoqAuditRollbackHandler struct {
	svc boqAuditRollbackServicer
}

// NewBoqAuditRollbackHandler creates a BoqAuditRollbackHandler.
func NewBoqAuditRollbackHandler(svc boqAuditRollbackServicer) *BoqAuditRollbackHandler {
	return &BoqAuditRollbackHandler{svc: svc}
}

// Rollback handles POST /api/v1/boq-audit/{auditId}/rollback.
//
// Restores a DELETE'd BOQ item from the given audit record. Errors:
//   - 404 — audit record not found
//   - 400 — not a DELETE record / no old_data
//   - 409 — id already exists / position or tender deleted
//   - 500 — unexpected DB error
func (h *BoqAuditRollbackHandler) Rollback(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	auditID := chi.URLParam(r, "auditId")
	if auditID == "" {
		apierr.BadRequest("missing audit id").Render(w)
		return
	}

	newID, err := h.svc.RollbackDeleted(r.Context(), auditID)
	if err != nil {
		var rbErr *repository.ErrAuditRollback
		if errors.As(err, &rbErr) {
			switch rbErr.HTTPStatus {
			case 404:
				apierr.NotFound(rbErr.Message).Render(w)
			case 400:
				apierr.BadRequest(rbErr.Message).Render(w)
			case 409:
				apierr.Conflict(rbErr.Message).Render(w)
			default:
				apierr.InternalError(rbErr.Message).Render(w)
			}
			return
		}
		apierr.InternalError("failed to roll back BOQ item").Render(w)
		return
	}

	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: map[string]string{"id": newID}})
}
