package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/calc"
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

// insuranceResp is InsuranceRow + the SERVER-computed total (stage 0.1.2.3b:
// clients display insurance_total instead of recomputing the formula locally).
type insuranceResp struct {
	repository.InsuranceRow
	InsuranceTotal float64 `json:"insurance_total"`
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
		apierr.InternalFromErr(w, r, err, "failed to load insurance")
		return
	}
	if row == nil {
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: nil})
		return
	}

	total, err := calc.CalculateInsuranceTotal(&calc.InsuranceInput{
		AptPriceM2: row.AptPriceM2, AptArea: row.AptArea,
		ParkingPriceM2: row.ParkingPriceM2, ParkingArea: row.ParkingArea,
		StoragePriceM2: row.StoragePriceM2, StorageArea: row.StorageArea,
		JudicialPct: row.JudicialPct, TotalPct: row.TotalPct,
	})
	if err != nil {
		apierr.InternalFromErr(w, r, err, "invalid insurance configuration", "tender_id", tenderID)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: insuranceResp{
		InsuranceRow: *row, InsuranceTotal: total,
	}})
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
		apierr.InternalFromErr(w, r, err, "failed to save insurance")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}
