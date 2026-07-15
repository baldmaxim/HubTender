package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// ImportMemoryHandler — этап 2.3 (§10): управление персональной памятью
// импорта. Все операции строго user-scoped: user_id берётся ТОЛЬКО из auth
// context, чужой ID неотличим от несуществующего (404).
type ImportMemoryHandler struct {
	svc *services.ImportMemoryService
}

// NewImportMemoryHandler creates an ImportMemoryHandler.
func NewImportMemoryHandler(svc *services.ImportMemoryService) *ImportMemoryHandler {
	return &ImportMemoryHandler{svc: svc}
}

func (h *ImportMemoryHandler) renderMemoryError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, repository.ErrImportMemoryNotFound) {
		apierr.NotFound("not found").Render(w)
		return
	}
	var selErr *services.InvalidSelectionError
	if errors.As(err, &selErr) {
		apierr.BadRequest(selErr.Reason).Render(w)
		return
	}
	apierr.InternalFromErr(w, r, err, "import memory operation failed")
}

func memoryListParams(r *http.Request) (search string, activeOnly bool, page, pageSize int) {
	q := r.URL.Query()
	search = q.Get("search")
	activeOnly = q.Get("active") == "true"
	page, _ = strconv.Atoi(q.Get("page"))
	pageSize, _ = strconv.Atoi(q.Get("page_size"))
	return search, activeOnly, page, pageSize
}

// ListMappingProfiles — GET /api/v1/boq-import/mapping-profiles.
func (h *ImportMemoryHandler) ListMappingProfiles(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	search, activeOnly, page, pageSize := memoryListParams(r)
	list, err := h.svc.ListProfiles(r.Context(), authUser.ID, search, activeOnly, page, pageSize)
	if err != nil {
		h.renderMemoryError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: list})
}

// PatchMappingProfile — PATCH /api/v1/boq-import/mapping-profiles/{id}:
// ТОЛЬКО name/is_active (§10); mapping generic-PATCH'ем не изменяется.
func (h *ImportMemoryHandler) PatchMappingProfile(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	var body struct {
		Name     *string `json:"name"`
		IsActive *bool   `json:"is_active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.BadRequest("неверный JSON").Render(w)
		return
	}
	if err := h.svc.PatchProfile(r.Context(), authUser.ID, id, body.Name, body.IsActive); err != nil {
		h.renderMemoryError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: map[string]bool{"ok": true}})
}

// DeleteMappingProfile — DELETE = soft deactivate (§10).
func (h *ImportMemoryHandler) DeleteMappingProfile(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	if err := h.svc.DeactivateProfile(r.Context(), authUser.ID, chi.URLParam(r, "id")); err != nil {
		h.renderMemoryError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: map[string]bool{"ok": true}})
}

// ListNomenclatureAliases — GET /api/v1/boq-import/nomenclature-aliases.
func (h *ImportMemoryHandler) ListNomenclatureAliases(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	search, activeOnly, page, pageSize := memoryListParams(r)
	list, err := h.svc.ListAliases(r.Context(), authUser.ID, search, activeOnly, page, pageSize)
	if err != nil {
		h.renderMemoryError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: list})
}

// DeleteNomenclatureAlias — DELETE = soft deactivate (§10/§12). Catalog
// target здесь неизменяем: новое соответствие создаётся только через
// Smart Import после успешного импорта.
func (h *ImportMemoryHandler) DeleteNomenclatureAlias(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	if err := h.svc.SetAliasActive(r.Context(), authUser.ID, chi.URLParam(r, "id"), false); err != nil {
		h.renderMemoryError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: map[string]bool{"ok": true}})
}
