package handlers

import (
	"context"
	"net/http"

	"github.com/rs/zerolog/log"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// referenceServicer is the interface ReferenceHandler depends on.
type referenceServicer interface {
	GetRoles(ctx context.Context) ([]repository.RoleRow, error)
	GetUnits(ctx context.Context) ([]repository.UnitRow, error)
	GetMaterialNames(ctx context.Context) ([]repository.MaterialNameRow, error)
	GetWorkNames(ctx context.Context) ([]repository.WorkNameRow, error)
	GetCostCategories(ctx context.Context) ([]repository.CostCategoryRow, error)
	GetDetailCostCategories(ctx context.Context, costCategoryID string) ([]repository.DetailCostCategoryRow, error)
}

// ReferenceHandler serves the /references/* family of endpoints.
// All endpoints are read-only and return a {"data": [...]} envelope.
type ReferenceHandler struct {
	svc referenceServicer
}

// NewReferenceHandler creates a ReferenceHandler.
func NewReferenceHandler(svc referenceServicer) *ReferenceHandler {
	return &ReferenceHandler{svc: svc}
}

// dataEnvelope wraps any slice in the standard {"data": [...]} response shape.
type dataEnvelope struct {
	Data any `json:"data"`
}

// GetRoles handles GET /api/v1/references/roles.
func (h *ReferenceHandler) GetRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.GetRoles(r.Context())
	if err != nil {
		apierr.InternalError("failed to load roles").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.RoleRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// GetUnits handles GET /api/v1/references/units.
func (h *ReferenceHandler) GetUnits(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.GetUnits(r.Context())
	if err != nil {
		apierr.InternalError("failed to load units").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.UnitRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// GetMaterialNames handles GET /api/v1/references/material-names.
func (h *ReferenceHandler) GetMaterialNames(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.GetMaterialNames(r.Context())
	if err != nil {
		apierr.InternalError("failed to load material names").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.MaterialNameRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// GetWorkNames handles GET /api/v1/references/work-names.
func (h *ReferenceHandler) GetWorkNames(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.GetWorkNames(r.Context())
	if err != nil {
		apierr.InternalError("failed to load work names").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.WorkNameRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// GetCostCategories handles GET /api/v1/references/cost-categories.
func (h *ReferenceHandler) GetCostCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.GetCostCategories(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("references: cost-categories failed")
		apierr.InternalError("failed to load cost categories").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.CostCategoryRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// GetDetailCostCategories handles GET /api/v1/references/detail-cost-categories.
// Accepts an optional ?cost_category_id=<uuid> query parameter to filter results.
func (h *ReferenceHandler) GetDetailCostCategories(w http.ResponseWriter, r *http.Request) {
	costCategoryID := r.URL.Query().Get("cost_category_id")

	rows, err := h.svc.GetDetailCostCategories(r.Context(), costCategoryID)
	if err != nil {
		log.Error().Err(err).Msg("references: detail-cost-categories failed")
		apierr.InternalError("failed to load detail cost categories").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.DetailCostCategoryRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
