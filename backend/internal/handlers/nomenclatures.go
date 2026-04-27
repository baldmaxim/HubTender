package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// nomenclaturesServicer is the interface NomenclaturesHandler depends on.
type nomenclaturesServicer interface {
	ListUnits(ctx context.Context) ([]repository.UnitFull, error)
	ListActiveUnitsShort(ctx context.Context) ([]repository.ActiveUnitShort, error)
	UnitExists(ctx context.Context, code string) (bool, error)
	ListMaterialNames(ctx context.Context) ([]repository.NamedRow, error)
	ListWorkNames(ctx context.Context) ([]repository.NamedRow, error)
	ListMaterialNamesByUnit(ctx context.Context, unit string) ([]repository.NameUnitPair, error)
	ListWorkNamesByUnit(ctx context.Context, unit string) ([]repository.NameUnitPair, error)
	CreateUnit(ctx context.Context, in repository.UnitInput) error
	UpdateUnit(ctx context.Context, code string, in repository.UnitInput) error
	DeleteUnit(ctx context.Context, code string) error
	CreateMaterialName(ctx context.Context, in repository.NameInput) error
	UpdateMaterialName(ctx context.Context, id string, in repository.NameInput) error
	DeleteMaterialName(ctx context.Context, id string) error
	DeleteMaterialNamesIn(ctx context.Context, ids []string) error
	CreateWorkName(ctx context.Context, in repository.NameInput) error
	UpdateWorkName(ctx context.Context, id string, in repository.NameInput) error
	DeleteWorkName(ctx context.Context, id string) error
	DeleteWorkNamesIn(ctx context.Context, ids []string) error
	RemapBoqMaterialName(ctx context.Context, from, to string) error
	RemapMaterialsLibraryMaterialName(ctx context.Context, from, to string) error
	RemapBoqWorkName(ctx context.Context, from, to string) error
	RemapWorksLibraryWorkName(ctx context.Context, from, to string) error
}

// NomenclaturesHandler serves admin Nomenclatures + ConstructionCost endpoints.
type NomenclaturesHandler struct {
	svc nomenclaturesServicer
}

// NewNomenclaturesHandler creates a NomenclaturesHandler.
func NewNomenclaturesHandler(svc nomenclaturesServicer) *NomenclaturesHandler {
	return &NomenclaturesHandler{svc: svc}
}

// ─── Units ──────────────────────────────────────────────────────────────────

func (h *NomenclaturesHandler) ListUnits(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListUnits(r.Context())
	if err != nil {
		apierr.InternalError("failed to list units").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.UnitFull{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *NomenclaturesHandler) ListActiveUnitsShort(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListActiveUnitsShort(r.Context())
	if err != nil {
		apierr.InternalError("failed to list units").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.ActiveUnitShort{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *NomenclaturesHandler) UnitExists(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		apierr.BadRequest("code query param required").Render(w)
		return
	}
	exists, err := h.svc.UnitExists(r.Context(), code)
	if err != nil {
		apierr.InternalError("failed to check unit").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, map[string]bool{"exists": exists})
}

func (h *NomenclaturesHandler) CreateUnit(w http.ResponseWriter, r *http.Request) {
	var in repository.UnitInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateUnit(r.Context(), in); err != nil {
		apierr.InternalError("failed to create unit").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *NomenclaturesHandler) UpdateUnit(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		apierr.BadRequest("missing code").Render(w)
		return
	}
	var in repository.UnitInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateUnit(r.Context(), code, in); err != nil {
		apierr.InternalError("failed to update unit").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) DeleteUnit(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		apierr.BadRequest("missing code").Render(w)
		return
	}
	if err := h.svc.DeleteUnit(r.Context(), code); err != nil {
		apierr.InternalError("failed to delete unit").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── material/work names ───────────────────────────────────────────────────

func (h *NomenclaturesHandler) ListMaterialNames(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListMaterialNames(r.Context())
	if err != nil {
		apierr.InternalError("failed to list material names").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.NamedRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *NomenclaturesHandler) ListWorkNames(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListWorkNames(r.Context())
	if err != nil {
		apierr.InternalError("failed to list work names").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.NamedRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *NomenclaturesHandler) ListMaterialNamesByUnit(w http.ResponseWriter, r *http.Request) {
	unit := r.URL.Query().Get("unit")
	if unit == "" {
		apierr.BadRequest("unit query param required").Render(w)
		return
	}
	rows, err := h.svc.ListMaterialNamesByUnit(r.Context(), unit)
	if err != nil {
		apierr.InternalError("failed to list material names by unit").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.NameUnitPair{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *NomenclaturesHandler) ListWorkNamesByUnit(w http.ResponseWriter, r *http.Request) {
	unit := r.URL.Query().Get("unit")
	if unit == "" {
		apierr.BadRequest("unit query param required").Render(w)
		return
	}
	rows, err := h.svc.ListWorkNamesByUnit(r.Context(), unit)
	if err != nil {
		apierr.InternalError("failed to list work names by unit").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.NameUnitPair{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *NomenclaturesHandler) CreateMaterialName(w http.ResponseWriter, r *http.Request) {
	var in repository.NameInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateMaterialName(r.Context(), in); err != nil {
		apierr.InternalError("failed to create material name").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *NomenclaturesHandler) UpdateMaterialName(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.NameInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateMaterialName(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update material name").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) DeleteMaterialName(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteMaterialName(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete material name").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type batchIDsReq struct {
	IDs []string `json:"ids"`
}

func (h *NomenclaturesHandler) DeleteMaterialNamesIn(w http.ResponseWriter, r *http.Request) {
	var req batchIDsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.DeleteMaterialNamesIn(r.Context(), req.IDs); err != nil {
		apierr.InternalError("failed to delete material names in batch").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) CreateWorkName(w http.ResponseWriter, r *http.Request) {
	var in repository.NameInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateWorkName(r.Context(), in); err != nil {
		apierr.InternalError("failed to create work name").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *NomenclaturesHandler) UpdateWorkName(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.NameInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateWorkName(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update work name").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) DeleteWorkName(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteWorkName(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete work name").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) DeleteWorkNamesIn(w http.ResponseWriter, r *http.Request) {
	var req batchIDsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.DeleteWorkNamesIn(r.Context(), req.IDs); err != nil {
		apierr.InternalError("failed to delete work names in batch").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Remap operations ──────────────────────────────────────────────────────

type remapReq struct {
	From string `json:"from"`
	To   string `json:"to"`
}

func (h *NomenclaturesHandler) RemapBoqMaterial(w http.ResponseWriter, r *http.Request) {
	var req remapReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.RemapBoqMaterialName(r.Context(), req.From, req.To); err != nil {
		apierr.InternalError("failed to remap boq material").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) RemapLibraryMaterial(w http.ResponseWriter, r *http.Request) {
	var req remapReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.RemapMaterialsLibraryMaterialName(r.Context(), req.From, req.To); err != nil {
		apierr.InternalError("failed to remap materials library").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) RemapBoqWork(w http.ResponseWriter, r *http.Request) {
	var req remapReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.RemapBoqWorkName(r.Context(), req.From, req.To); err != nil {
		apierr.InternalError("failed to remap boq work").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *NomenclaturesHandler) RemapLibraryWork(w http.ResponseWriter, r *http.Request) {
	var req remapReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.RemapWorksLibraryWorkName(r.Context(), req.From, req.To); err != nil {
		apierr.InternalError("failed to remap works library").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
