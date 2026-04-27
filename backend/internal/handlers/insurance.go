package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// insuranceServicer is the interface InsuranceHandler depends on.
type insuranceServicer interface {
	Get(ctx context.Context, tenderID string) (*repository.InsuranceRow, error)
	Upsert(ctx context.Context, tenderID string, in repository.InsuranceRow) (*repository.InsuranceRow, error)
}

// InsuranceHandler serves /api/v1/tenders/{id}/insurance.
type InsuranceHandler struct {
	svc insuranceServicer
}

// NewInsuranceHandler creates an InsuranceHandler.
func NewInsuranceHandler(svc insuranceServicer) *InsuranceHandler {
	return &InsuranceHandler{svc: svc}
}

// Get handles GET /api/v1/tenders/{id}/insurance.
// Returns {data: null} when no row exists.
func (h *InsuranceHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	row, err := h.svc.Get(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to load insurance").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

// Put handles PUT /api/v1/tenders/{id}/insurance.
// Body is the full InsuranceRow JSON. Performs upsert and returns the
// persisted row.
func (h *InsuranceHandler) Put(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	var in repository.InsuranceRow
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}

	row, err := h.svc.Upsert(r.Context(), tenderID, in)
	if err != nil {
		apierr.InternalError("failed to save insurance").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}
