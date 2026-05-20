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
	ListByPosition(ctx context.Context, f repository.BoqAuditListFilter) ([]repository.BoqAuditRow, error)
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

// strOrNil returns a *string from a query param: nil if empty.
func strOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ListByPosition handles
// GET /api/v1/boq-audit?position_id=&date_from=&date_to=&user_id=&operation_type=.
func (h *BoqAuditRollbackHandler) ListByPosition(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	q := r.URL.Query()
	positionID := q.Get("position_id")
	if positionID == "" {
		apierr.BadRequest("position_id is required").Render(w)
		return
	}
	rows, err := h.svc.ListByPosition(r.Context(), repository.BoqAuditListFilter{
		PositionID:    positionID,
		DateFrom:      strOrNil(q.Get("date_from")),
		DateTo:        strOrNil(q.Get("date_to")),
		UserID:        strOrNil(q.Get("user_id")),
		OperationType: strOrNil(q.Get("operation_type")),
	})
	if err != nil {
		apierr.InternalError("failed to list boq audit").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.BoqAuditRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
