package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// libraryServicer is the interface LibraryHandler depends on.
type libraryServicer interface {
	ListWorks(ctx context.Context) ([]repository.WorkLibraryRow, error)
	CreateWork(ctx context.Context, in repository.WorkLibraryInput) error
	UpdateWork(ctx context.Context, id string, in repository.WorkLibraryInput) error
	DeleteWork(ctx context.Context, id string) error
	ListMaterials(ctx context.Context) ([]repository.MaterialLibraryRow, error)
	CreateMaterial(ctx context.Context, in repository.MaterialLibraryInput) error
	UpdateMaterial(ctx context.Context, id string, in repository.MaterialLibraryInput) error
	DeleteMaterial(ctx context.Context, id string) error
}

// LibraryHandler serves the Library page endpoints.
type LibraryHandler struct {
	svc libraryServicer
}

// NewLibraryHandler creates a LibraryHandler.
func NewLibraryHandler(svc libraryServicer) *LibraryHandler {
	return &LibraryHandler{svc: svc}
}

// ─── works_library ──────────────────────────────────────────────────────────

func (h *LibraryHandler) ListWorks(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	rows, err := h.svc.ListWorks(r.Context())
	if err != nil {
		apierr.InternalError("failed to list works library").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.WorkLibraryRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *LibraryHandler) CreateWork(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var in repository.WorkLibraryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateWork(r.Context(), in); err != nil {
		apierr.InternalError("failed to create work").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *LibraryHandler) UpdateWork(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.WorkLibraryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateWork(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update work").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) DeleteWork(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteWork(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete work").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── materials_library ──────────────────────────────────────────────────────

func (h *LibraryHandler) ListMaterials(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	rows, err := h.svc.ListMaterials(r.Context())
	if err != nil {
		apierr.InternalError("failed to list materials library").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.MaterialLibraryRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *LibraryHandler) CreateMaterial(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var in repository.MaterialLibraryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateMaterial(r.Context(), in); err != nil {
		apierr.InternalError("failed to create material").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *LibraryHandler) UpdateMaterial(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.MaterialLibraryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateMaterial(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update material").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) DeleteMaterial(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteMaterial(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete material").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
