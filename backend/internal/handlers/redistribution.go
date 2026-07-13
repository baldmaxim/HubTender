package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type redistributionServicer interface {
	Save(
		ctx context.Context,
		tenderID, tacticID string,
		rules calc.RedistributionRulesInput,
		createdBy string,
	) (*repository.RedistributionSaveOutput, error)
	LoadResults(ctx context.Context, tenderID, tacticID string) (*repository.RedistributionLoad, error)
}

// RedistributionHandler handles POST /api/v1/redistributions/save.
type RedistributionHandler struct {
	svc      redistributionServicer
	validate *validator.Validate
}

// NewRedistributionHandler creates a RedistributionHandler.
func NewRedistributionHandler(svc redistributionServicer) *RedistributionHandler {
	return &RedistributionHandler{svc: svc, validate: validator.New()}
}

// saveRedistributionReq — stage 0.1.2.3a authoritative contract: the client
// saves ONLY rules. There is deliberately NO "records" field and no financial
// values: a legacy client's "records" JSON member is silently DROPPED by the
// decoder (rolling compatibility) and can never be decoded into a financial
// DTO, influence the response, or reach the repository. created_by is not
// accepted either — the actor comes from the auth context only.
type saveRedistributionReq struct {
	TenderID       string                        `json:"tender_id"        validate:"required,uuid"`
	MarkupTacticID string                        `json:"markup_tactic_id" validate:"required,uuid"`
	Rules          calc.RedistributionRulesInput `json:"rules"`
}

// saveRedistributionResp returns the SERVER-calculated snapshot. The frontend
// must replace its local preview with these results.
type saveRedistributionResp struct {
	SavedCount        int                               `json:"saved_count"`
	Results           []repository.RedistributionRecord `json:"results"`
	TotalDeducted     float64                           `json:"total_deducted"`
	TotalAdded        float64                           `json:"total_added"`
	IsBalanced        bool                              `json:"is_balanced"`
	Rules             json.RawMessage                   `json:"redistribution_rules"`
	CalculationSource string                            `json:"calculation_source"`
	SchemaVersion     int                               `json:"schema_version"`
	// PositionDeltas — server-validated diagnostics for 0.1.2.3b (not money
	// persistence; per-position cumulative deltas of position rules).
	PositionDeltas map[string]float64 `json:"position_deltas,omitempty"`
}

// renderRedistributionError maps the typed redistribution domain errors to
// RFC 7807 responses. Returns true when handled (errors.As unwraps %w chains).
func renderRedistributionError(w http.ResponseWriter, err error) bool {
	var rulesErr *calc.InvalidRedistributionRulesError
	if errors.As(err, &rulesErr) {
		apierr.InvalidRedistributionRules(rulesErr.Issues).Render(w)
		return true
	}
	var tacticErr *calc.RedistributionTacticMismatchError
	if errors.As(err, &tacticErr) {
		apierr.RedistributionTacticMismatch(tacticErr.RequestedTacticID, tacticErr.ActiveTacticID).Render(w)
		return true
	}
	var unbalancedErr *calc.UnbalancedRedistributionError
	if errors.As(err, &unbalancedErr) {
		apierr.RedistributionUnbalanced(unbalancedErr.TotalDeducted, unbalancedErr.TotalAdded).Render(w)
		return true
	}
	var noItemsErr *calc.RedistributionNoBoqItemsError
	if errors.As(err, &noItemsErr) {
		apierr.RedistributionNoBoqItems().Render(w)
		return true
	}
	return false
}

// Save handles POST /api/v1/redistributions/save.
func (h *RedistributionHandler) Save(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req saveRedistributionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	out, err := h.svc.Save(r.Context(), req.TenderID, req.MarkupTacticID, req.Rules, authUser.ID)
	if err != nil {
		if renderRedistributionError(w, err) {
			return
		}
		if renderMissingFXRate(w, err) {
			return
		}
		if errors.Is(err, repository.ErrRedistributionTenderNotFound) {
			apierr.NotFound(err.Error()).Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to save redistribution results")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: saveRedistributionResp{
		SavedCount:        out.SavedCount,
		Results:           out.Results,
		TotalDeducted:     out.TotalDeducted,
		TotalAdded:        out.TotalAdded,
		IsBalanced:        out.IsBalanced,
		Rules:             out.CanonicalRules,
		CalculationSource: calc.RedistributionCalculationServer,
		SchemaVersion:     calc.RedistributionSchemaVersion,
		PositionDeltas:    out.PositionDeltas,
	}})
}

// Load handles GET /api/v1/redistributions?tender_id=&markup_tactic_id=.
// Returns the saved snapshot { results, redistribution_rules, status }.
// status = "requires_recalculation" marks a legacy client-calculated snapshot
// whose results must NOT be used as authoritative.
func (h *RedistributionHandler) Load(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	tenderID := r.URL.Query().Get("tender_id")
	tacticID := r.URL.Query().Get("markup_tactic_id")
	if tenderID == "" || tacticID == "" {
		apierr.BadRequest("tender_id and markup_tactic_id are required").Render(w)
		return
	}

	out, err := h.svc.LoadResults(r.Context(), tenderID, tacticID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to load redistribution results")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}
