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

type ccvServicer interface {
	ListByTender(ctx context.Context, tenderID string) ([]repository.ConstructionCostVolumeRow, error)
	UpsertVolume(ctx context.Context, tenderID string, detailCostCategoryID, groupKey *string, volume float64, notes *string) error
}

type ConstructionCostVolumesHandler struct {
	svc ccvServicer
}

func NewConstructionCostVolumesHandler(svc ccvServicer) *ConstructionCostVolumesHandler {
	return &ConstructionCostVolumesHandler{svc: svc}
}

func (h *ConstructionCostVolumesHandler) ListByTender(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	rows, err := h.svc.ListByTender(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list cost volumes")
		return
	}
	if rows == nil {
		rows = []repository.ConstructionCostVolumeRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

type upsertVolumeReq struct {
	TenderID             string  `json:"tender_id"`
	DetailCostCategoryID *string `json:"detail_cost_category_id"`
	GroupKey             *string `json:"group_key"`
	Volume               float64 `json:"volume"`
	Notes                *string `json:"notes"`
}

func (h *ConstructionCostVolumesHandler) Upsert(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req upsertVolumeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if req.TenderID == "" {
		apierr.BadRequest("tender_id required").Render(w)
		return
	}
	if err := h.svc.UpsertVolume(r.Context(), req.TenderID, req.DetailCostCategoryID, req.GroupKey, req.Volume, req.Notes); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to upsert cost volume")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
