package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// projectsServicer is the interface ProjectsHandler depends on.
type projectsServicer interface {
	Create(ctx context.Context, in repository.ProjectInsert) error
	Update(ctx context.Context, id string, in repository.ProjectInsert) error
	SoftDelete(ctx context.Context, id string) error
	ListActiveTendersForSelect(ctx context.Context) ([]repository.ProjectTenderRow, error)
	ListAgreements(ctx context.Context, projectID string, asc bool) ([]repository.AgreementRow, error)
	CreateAgreement(ctx context.Context, in repository.AgreementInput) error
	UpdateAgreement(ctx context.Context, id string, p repository.AgreementPatch) error
	DeleteAgreement(ctx context.Context, id string) error
	CreateMonthlyCompletion(ctx context.Context, in repository.MonthlyCompletionInput) error
	UpdateMonthlyCompletion(ctx context.Context, id string, p repository.MonthlyCompletionPatch) error
}

// ProjectsHandler serves projects + agreements + monthly_completion endpoints.
type ProjectsHandler struct {
	svc projectsServicer
}

// NewProjectsHandler creates a ProjectsHandler.
func NewProjectsHandler(svc projectsServicer) *ProjectsHandler {
	return &ProjectsHandler{svc: svc}
}

// ─── Projects ───────────────────────────────────────────────────────────────

func (h *ProjectsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var in repository.ProjectInsert
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.Create(r.Context(), in); err != nil {
		apierr.InternalError("failed to create project").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *ProjectsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.ProjectInsert
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.Update(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update project").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ProjectsHandler) SoftDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.SoftDelete(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete project").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ProjectsHandler) ListActiveTendersForSelect(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListActiveTendersForSelect(r.Context())
	if err != nil {
		apierr.InternalError("failed to list tenders").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.ProjectTenderRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// ─── Agreements ────────────────────────────────────────────────────────────

func (h *ProjectsHandler) ListAgreements(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "id")
	if projectID == "" {
		apierr.BadRequest("missing project id").Render(w)
		return
	}
	asc := r.URL.Query().Get("order") == "asc"
	rows, err := h.svc.ListAgreements(r.Context(), projectID, asc)
	if err != nil {
		apierr.InternalError("failed to list agreements").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.AgreementRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *ProjectsHandler) CreateAgreement(w http.ResponseWriter, r *http.Request) {
	var in repository.AgreementInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateAgreement(r.Context(), in); err != nil {
		apierr.InternalError("failed to create agreement").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *ProjectsHandler) UpdateAgreement(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var p repository.AgreementPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateAgreement(r.Context(), id, p); err != nil {
		apierr.InternalError("failed to update agreement").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *ProjectsHandler) DeleteAgreement(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteAgreement(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete agreement").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Monthly completion ────────────────────────────────────────────────────

func (h *ProjectsHandler) CreateMonthlyCompletion(w http.ResponseWriter, r *http.Request) {
	var in repository.MonthlyCompletionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateMonthlyCompletion(r.Context(), in); err != nil {
		apierr.InternalError("failed to create monthly completion").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *ProjectsHandler) UpdateMonthlyCompletion(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var p repository.MonthlyCompletionPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateMonthlyCompletion(r.Context(), id, p); err != nil {
		apierr.InternalError("failed to update monthly completion").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
