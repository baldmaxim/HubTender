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

// comparisonServicer is the interface ComparisonHandler depends on.
type comparisonServicer interface {
	ListNotes(ctx context.Context, t1, t2 string) ([]repository.ComparisonNoteRow, error)
	UpsertNotePair(ctx context.Context, t1, t2, costCategoryName string, detailCategoryKey *string, note, createdBy string) error
	ListCostVolumes(ctx context.Context, tenderID string) ([]repository.CostVolumeRow, error)
}

// ComparisonHandler serves object-comparison notes + cost volumes.
type ComparisonHandler struct {
	svc comparisonServicer
}

// NewComparisonHandler creates a ComparisonHandler.
func NewComparisonHandler(svc comparisonServicer) *ComparisonHandler {
	return &ComparisonHandler{svc: svc}
}

// ListNotes handles GET /api/v1/comparison-notes?tender_id_1=&tender_id_2=.
func (h *ComparisonHandler) ListNotes(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	t1 := r.URL.Query().Get("tender_id_1")
	t2 := r.URL.Query().Get("tender_id_2")
	if t1 == "" || t2 == "" {
		apierr.BadRequest("tender_id_1 and tender_id_2 are required").Render(w)
		return
	}
	notes, err := h.svc.ListNotes(r.Context(), t1, t2)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to load comparison notes")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: notes})
}

type upsertNoteReq struct {
	TenderID1         string  `json:"tender_id_1"        validate:"required,uuid"`
	TenderID2         string  `json:"tender_id_2"        validate:"required,uuid"`
	CostCategoryName  string  `json:"cost_category_name" validate:"required"`
	DetailCategoryKey *string `json:"detail_category_key"`
	Note              string  `json:"note"`
}

// UpsertNote handles POST /api/v1/comparison-notes (upserts both orders).
// created_by is taken from the JWT.
func (h *ComparisonHandler) UpsertNote(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req upsertNoteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if req.TenderID1 == "" || req.TenderID2 == "" || req.CostCategoryName == "" {
		apierr.BadRequest("tender_id_1, tender_id_2, cost_category_name are required").Render(w)
		return
	}
	if err := h.svc.UpsertNotePair(
		r.Context(), req.TenderID1, req.TenderID2, req.CostCategoryName,
		req.DetailCategoryKey, req.Note, authUser.ID,
	); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to save comparison note")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListCostVolumes handles GET /api/v1/tenders/{id}/cost-volumes.
func (h *ComparisonHandler) ListCostVolumes(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	vols, err := h.svc.ListCostVolumes(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to load cost volumes")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: vols})
}
