package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// timelineServicer is the interface TimelineHandler depends on.
type timelineServicer interface {
	SetGroupQuality(ctx context.Context, groupID string, qualityLevel *int16, qualityComment *string, updatedBy string) (*repository.TenderGroupRow, error)
	RespondIteration(ctx context.Context, iterationID, userID, managerComment, approvalStatus string) (*repository.TenderIterationRow, error)
}

// TimelineHandler serves the timeline mutation endpoints.
type TimelineHandler struct {
	svc      timelineServicer
	validate *validator.Validate
}

// NewTimelineHandler creates a TimelineHandler.
func NewTimelineHandler(svc timelineServicer) *TimelineHandler {
	return &TimelineHandler{svc: svc, validate: validator.New()}
}

// ---------------------------------------------------------------------------
// POST /api/v1/timeline/groups/{id}/quality
// ---------------------------------------------------------------------------

// setGroupQualityReq is the request body.
type setGroupQualityReq struct {
	QualityLevel   *int16  `json:"quality_level"   validate:"omitempty,min=1,max=10"`
	QualityComment *string `json:"quality_comment"`
}

// SetGroupQuality handles POST /api/v1/timeline/groups/{id}/quality.
// Ports public.set_tender_group_quality (lines 1524-1559).
func (h *TimelineHandler) SetGroupQuality(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	groupID := chi.URLParam(r, "id")
	if groupID == "" {
		apierr.BadRequest("missing group id").Render(w)
		return
	}

	var req setGroupQualityReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	g, err := h.svc.SetGroupQuality(r.Context(), groupID, req.QualityLevel, req.QualityComment, authUser.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("tender group not found").Render(w)
			return
		}
		apierr.InternalError("failed to set group quality").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: g})
}

// ---------------------------------------------------------------------------
// POST /api/v1/timeline/iterations/{id}/respond
// ---------------------------------------------------------------------------

// respondIterationReq is the request body.
type respondIterationReq struct {
	ManagerComment string `json:"manager_comment"`
	ApprovalStatus string `json:"approval_status" validate:"required,oneof=pending approved rejected"`
}

// RespondIteration handles POST /api/v1/timeline/iterations/{id}/respond.
// Ports public.respond_tender_iteration (lines 1479-1510).
func (h *TimelineHandler) RespondIteration(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	iterationID := chi.URLParam(r, "id")
	if iterationID == "" {
		apierr.BadRequest("missing iteration id").Render(w)
		return
	}

	var req respondIterationReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	it, err := h.svc.RespondIteration(
		r.Context(),
		iterationID,
		authUser.ID,
		req.ManagerComment,
		req.ApprovalStatus,
	)
	if err != nil {
		if errors.Is(err, services.ErrForbidden) {
			apierr.Forbidden("insufficient privilege for timeline response").Render(w)
			return
		}
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("tender iteration not found").Render(w)
			return
		}
		apierr.InternalError("failed to respond to iteration").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: it})
}
