package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type redistributionServicer interface {
	SaveResults(
		ctx context.Context,
		tenderID, tacticID string,
		records []repository.RedistributionRecord,
		rulesJSON json.RawMessage,
		createdBy string,
	) (int, error)
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

type saveRedistributionReq struct {
	TenderID       string                              `json:"tender_id"        validate:"required,uuid"`
	MarkupTacticID string                              `json:"markup_tactic_id" validate:"required,uuid"`
	Records        []repository.RedistributionRecord   `json:"records"          validate:"required,min=1,dive"`
	Rules          json.RawMessage                     `json:"rules"            validate:"required"`
}

type saveRedistributionResp struct {
	SavedCount int `json:"saved_count"`
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

	count, err := h.svc.SaveResults(
		r.Context(),
		req.TenderID,
		req.MarkupTacticID,
		req.Records,
		req.Rules,
		authUser.ID,
	)
	if err != nil {
		apierr.InternalError("failed to save redistribution results").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: saveRedistributionResp{SavedCount: count}})
}

// Load handles GET /api/v1/redistributions?tender_id=&markup_tactic_id=.
// Returns the saved snapshot { results: [...], redistribution_rules: ... }.
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
		apierr.InternalError("failed to load redistribution results").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}
