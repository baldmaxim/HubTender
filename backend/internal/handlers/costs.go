package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// costsServicer is the interface CostsHandler depends on.
type costsServicer interface {
	ListCostCategories(ctx context.Context) ([]repository.CostCategoryRecord, error)
	ListCostCategoriesByIDs(ctx context.Context, ids []string) ([]repository.CostCategoryRecord, error)
	FindCostCategoryByNameAndUnit(ctx context.Context, name, unit string) (*repository.CostCategoryRecord, error)
	CreateCostCategory(ctx context.Context, in repository.CostCategoryInput) (*repository.CostCategoryRecord, error)
	UpdateCostCategory(ctx context.Context, id string, in repository.CostCategoryInput) error
	DeleteCostCategory(ctx context.Context, id string) error
	DeleteAllCostCategories(ctx context.Context) error
	ListDetailCostCategoriesByOrder(ctx context.Context) ([]repository.DetailCostCategoryRecord, error)
	NextDetailOrderNum(ctx context.Context) (int, error)
	CreateDetailCostCategory(ctx context.Context, in repository.DetailCostCategoryInput) error
	UpdateDetailCostCategory(ctx context.Context, id string, p repository.DetailCostCategoryPatch) error
	DeleteDetailCostCategory(ctx context.Context, id string) error
	DeleteAllDetailCostCategories(ctx context.Context) error
	ListLocationsByIDs(ctx context.Context, ids []string) ([]repository.LocationRecord, error)
	ListActiveUnitsFull(ctx context.Context) ([]repository.UnitFull, error)
	UpsertImportedUnits(ctx context.Context, units []repository.ImportedUnitRow) error
}

// CostsHandler serves cost_categories / detail_cost_categories / locations / units endpoints.
type CostsHandler struct {
	svc costsServicer
}

func NewCostsHandler(svc costsServicer) *CostsHandler {
	return &CostsHandler{svc: svc}
}

func splitCSV(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ─── cost_categories ────────────────────────────────────────────────────────

func (h *CostsHandler) ListCostCategories(w http.ResponseWriter, r *http.Request) {
	if ids := splitCSV(r.URL.Query().Get("ids")); len(ids) > 0 {
		rows, err := h.svc.ListCostCategoriesByIDs(r.Context(), ids)
		if err != nil {
			apierr.InternalError("failed to list cost categories").Render(w)
			return
		}
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
		return
	}
	rows, err := h.svc.ListCostCategories(r.Context())
	if err != nil {
		apierr.InternalError("failed to list cost categories").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.CostCategoryRecord{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *CostsHandler) FindCostCategory(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	unit := r.URL.Query().Get("unit")
	if name == "" || unit == "" {
		apierr.BadRequest("name and unit query params required").Render(w)
		return
	}
	rec, err := h.svc.FindCostCategoryByNameAndUnit(r.Context(), name, unit)
	if err != nil {
		apierr.InternalError("failed to find cost category").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rec})
}

func (h *CostsHandler) CreateCostCategory(w http.ResponseWriter, r *http.Request) {
	var in repository.CostCategoryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		apierr.BadRequest("name is required").Render(w)
		return
	}
	rec, err := h.svc.CreateCostCategory(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to create cost category").Render(w)
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: rec})
}

func (h *CostsHandler) UpdateCostCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.CostCategoryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateCostCategory(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update cost category").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CostsHandler) DeleteCostCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteCostCategory(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete cost category").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CostsHandler) DeleteAllCostCategories(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteAllCostCategories(r.Context()); err != nil {
		apierr.InternalError("failed to delete all cost categories").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── detail_cost_categories ─────────────────────────────────────────────────

func (h *CostsHandler) ListDetailCostCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListDetailCostCategoriesByOrder(r.Context())
	if err != nil {
		apierr.InternalError("failed to list detail cost categories").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.DetailCostCategoryRecord{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *CostsHandler) NextDetailOrderNum(w http.ResponseWriter, r *http.Request) {
	n, err := h.svc.NextDetailOrderNum(r.Context())
	if err != nil {
		apierr.InternalError("failed to compute next order num").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, map[string]int{"max_order_num": n})
}

func (h *CostsHandler) CreateDetailCostCategory(w http.ResponseWriter, r *http.Request) {
	var in repository.DetailCostCategoryInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateDetailCostCategory(r.Context(), in); err != nil {
		apierr.InternalError("failed to create detail cost category").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *CostsHandler) UpdateDetailCostCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var p repository.DetailCostCategoryPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateDetailCostCategory(r.Context(), id, p); err != nil {
		apierr.InternalError("failed to update detail cost category").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CostsHandler) DeleteDetailCostCategory(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteDetailCostCategory(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete detail cost category").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *CostsHandler) DeleteAllDetailCostCategories(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteAllDetailCostCategories(r.Context()); err != nil {
		apierr.InternalError("failed to delete all detail cost categories").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── locations + units ──────────────────────────────────────────────────────

func (h *CostsHandler) ListLocations(w http.ResponseWriter, r *http.Request) {
	ids := splitCSV(r.URL.Query().Get("ids"))
	rows, err := h.svc.ListLocationsByIDs(r.Context(), ids)
	if err != nil {
		apierr.InternalError("failed to list locations").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.LocationRecord{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *CostsHandler) ListActiveUnitsFull(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListActiveUnitsFull(r.Context())
	if err != nil {
		apierr.InternalError("failed to list units").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.UnitFull{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

type importedUnitsReq struct {
	Units []repository.ImportedUnitRow `json:"units"`
}

func (h *CostsHandler) UpsertImportedUnits(w http.ResponseWriter, r *http.Request) {
	var req importedUnitsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpsertImportedUnits(r.Context(), req.Units); err != nil {
		apierr.InternalError("failed to upsert imported units").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
