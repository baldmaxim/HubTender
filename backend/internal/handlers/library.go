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
	ListFolders(ctx context.Context, folderType string) ([]repository.LibraryFolderRow, error)
	CreateFolder(ctx context.Context, in repository.LibraryFolderInput) error
	RenameFolder(ctx context.Context, id, name string) error
	DeleteFolder(ctx context.Context, id string) error
	MoveLibraryItem(ctx context.Context, table, itemID string, folderID *string) error
	ListTemplates(ctx context.Context) ([]repository.TemplateRow, error)
	DeleteTemplate(ctx context.Context, id string) error
	ListTemplateItems(ctx context.Context, templateID string) ([]repository.TemplateItemRow, error)
	DeleteTemplateItem(ctx context.Context, id string) error
	CreateTemplate(ctx context.Context, in repository.CreateTemplateInput) (string, error)
	UpdateTemplate(ctx context.Context, id string, in repository.UpdateTemplateInput) error
	AddTemplateItem(ctx context.Context, templateID string, in repository.AddTemplateItemInput) (*repository.TemplateItemRow, error)
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
		apierr.InternalFromErr(w, r, err, "failed to list works library")
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
		apierr.InternalFromErr(w, r, err, "failed to create work")
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
		apierr.InternalFromErr(w, r, err, "failed to update work")
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
		apierr.InternalFromErr(w, r, err, "failed to delete work")
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
		apierr.InternalFromErr(w, r, err, "failed to list materials library")
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
		apierr.InternalFromErr(w, r, err, "failed to create material")
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
		apierr.InternalFromErr(w, r, err, "failed to update material")
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
		apierr.InternalFromErr(w, r, err, "failed to delete material")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── library_folders ────────────────────────────────────────────────────────

func (h *LibraryHandler) ListFolders(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	folderType := r.URL.Query().Get("type")
	if folderType == "" {
		apierr.BadRequest("type query param is required").Render(w)
		return
	}
	rows, err := h.svc.ListFolders(r.Context(), folderType)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list folders")
		return
	}
	if rows == nil {
		rows = []repository.LibraryFolderRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *LibraryHandler) CreateFolder(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var in repository.LibraryFolderInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateFolder(r.Context(), in); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to create folder")
		return
	}
	w.WriteHeader(http.StatusCreated)
}

type renameFolderReq struct {
	Name string `json:"name"`
}

func (h *LibraryHandler) RenameFolder(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var req renameFolderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.RenameFolder(r.Context(), id, req.Name); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to rename folder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) DeleteFolder(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteFolder(r.Context(), id); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to delete folder")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type moveItemReq struct {
	Table    string  `json:"table"`
	ItemID   string  `json:"item_id"`
	FolderID *string `json:"folder_id"`
}

func (h *LibraryHandler) MoveItem(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req moveItemReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if req.Table == "" || req.ItemID == "" {
		apierr.BadRequest("table and item_id are required").Render(w)
		return
	}
	if err := h.svc.MoveLibraryItem(r.Context(), req.Table, req.ItemID, req.FolderID); err != nil {
		apierr.BadRequest("failed to move library item").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── templates / template_items ─────────────────────────────────────────────

func (h *LibraryHandler) ListTemplates(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	rows, err := h.svc.ListTemplates(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list templates")
		return
	}
	if rows == nil {
		rows = []repository.TemplateRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *LibraryHandler) DeleteTemplate(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteTemplate(r.Context(), id); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to delete template")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) ListTemplateItems(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	templateID := chi.URLParam(r, "id")
	if templateID == "" {
		apierr.BadRequest("missing template id").Render(w)
		return
	}
	rows, err := h.svc.ListTemplateItems(r.Context(), templateID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list template items")
		return
	}
	if rows == nil {
		rows = []repository.TemplateItemRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *LibraryHandler) DeleteTemplateItem(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteTemplateItem(r.Context(), id); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to delete template item")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) CreateTemplate(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var in repository.CreateTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	id, err := h.svc.CreateTemplate(r.Context(), in)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to create template")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: map[string]string{"id": id}})
}

func (h *LibraryHandler) UpdateTemplate(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.UpdateTemplateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateTemplate(r.Context(), id, in); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to update template")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *LibraryHandler) AddTemplateItem(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	templateID := chi.URLParam(r, "id")
	if templateID == "" {
		apierr.BadRequest("missing template id").Render(w)
		return
	}
	var in repository.AddTemplateItemInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	row, err := h.svc.AddTemplateItem(r.Context(), templateID, in)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to add template item")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: row})
}
