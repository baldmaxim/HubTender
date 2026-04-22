package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// subcontractServicer is the interface SubcontractHandler depends on.
type subcontractServicer interface {
	ToggleExclusion(ctx context.Context, tenderID, detailCategoryID, exclusionType string) (bool, error)
}

// SubcontractHandler handles POST /api/v1/tenders/{id}/subcontract-exclusions/toggle.
type SubcontractHandler struct {
	svc      subcontractServicer
	validate *validator.Validate
}

// NewSubcontractHandler creates a SubcontractHandler.
func NewSubcontractHandler(svc subcontractServicer) *SubcontractHandler {
	return &SubcontractHandler{svc: svc, validate: validator.New()}
}

type toggleExclusionReq struct {
	DetailCostCategoryID string `json:"detail_cost_category_id" validate:"required,uuid"`
	ExclusionType        string `json:"exclusion_type"          validate:"omitempty,oneof=works materials"`
}

// ToggleExclusion adds or removes a subcontract growth exclusion.
// Response: {"added": true|false} — true if now excluded, false if removed.
func (h *SubcontractHandler) ToggleExclusion(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	var req toggleExclusionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}
	if req.ExclusionType == "" {
		req.ExclusionType = "works"
	}

	added, err := h.svc.ToggleExclusion(r.Context(), tenderID, req.DetailCostCategoryID, req.ExclusionType)
	if err != nil {
		apierr.InternalError("failed to toggle exclusion").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, map[string]any{"added": added})
}
