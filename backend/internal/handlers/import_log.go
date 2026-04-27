package handlers

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// importLogServicer is the interface ImportLogHandler depends on.
type importLogServicer interface {
	ListSessions(ctx context.Context, tenderID string) ([]repository.ImportSessionRow, error)
	UsersByIDs(ctx context.Context, ids []string) ([]repository.ImportLogUserRow, error)
	TendersByIDs(ctx context.Context, ids []string) ([]repository.TenderShort, error)
	ListAllTendersForFilter(ctx context.Context) ([]repository.TenderShort, error)
	CancelSession(ctx context.Context, sessionID, cancelledBy string) (*repository.CancelResult, error)
}

// ImportLogHandler serves Admin/ImportLog endpoints.
type ImportLogHandler struct {
	svc importLogServicer
}

// NewImportLogHandler creates an ImportLogHandler.
func NewImportLogHandler(svc importLogServicer) *ImportLogHandler {
	return &ImportLogHandler{svc: svc}
}

// ListSessions handles GET /api/v1/import-sessions[?tender_id=...].
func (h *ImportLogHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	tenderID := r.URL.Query().Get("tender_id")
	rows, err := h.svc.ListSessions(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to list import sessions").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.ImportSessionRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// UsersByIDs handles GET /api/v1/import-sessions/users?ids=a,b,c.
func (h *ImportLogHandler) UsersByIDs(w http.ResponseWriter, r *http.Request) {
	ids := splitCSV(r.URL.Query().Get("ids"))
	rows, err := h.svc.UsersByIDs(r.Context(), ids)
	if err != nil {
		apierr.InternalError("failed to load users").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.ImportLogUserRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// TendersByIDs handles GET /api/v1/import-sessions/tenders?ids=a,b,c.
func (h *ImportLogHandler) TendersByIDs(w http.ResponseWriter, r *http.Request) {
	ids := splitCSV(r.URL.Query().Get("ids"))
	rows, err := h.svc.TendersByIDs(r.Context(), ids)
	if err != nil {
		apierr.InternalError("failed to load tenders").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.TenderShort{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// AllTendersForFilter handles GET /api/v1/import-sessions/all-tenders.
func (h *ImportLogHandler) AllTendersForFilter(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListAllTendersForFilter(r.Context())
	if err != nil {
		apierr.InternalError("failed to load tenders").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.TenderShort{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// Cancel handles POST /api/v1/import-sessions/{id}/cancel.
// cancelled_by is taken from the JWT (user cannot impersonate).
func (h *ImportLogHandler) Cancel(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	if sessionID == "" {
		apierr.BadRequest("missing session id").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	res, err := h.svc.CancelSession(r.Context(), sessionID, authUser.ID)
	if err != nil {
		apierr.InternalError("failed to cancel import session").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}
