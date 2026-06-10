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
	ListAssignableUsers(ctx context.Context) ([]repository.TimelineUserRef, error)
	CreateIteration(ctx context.Context, in repository.CreateIterationInput) (*repository.TenderIterationRow, error)
	ListGroupIterations(ctx context.Context, groupID, userID string) ([]repository.TimelineIterationWithRefs, error)
	ListTenderGroups(ctx context.Context, tenderID string) ([]repository.TimelineGroupWithRelations, error)
	ListTimelineTenders(ctx context.Context) (*repository.TimelineTendersPayload, error)
	ReconcileTenderGroups(ctx context.Context, tenderID string, excludedUserIDs []string, expected []repository.ExpectedGroup) error
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
		apierr.InternalFromErr(w, r, err, "failed to set group quality")
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
		apierr.InternalFromErr(w, r, err, "failed to respond to iteration")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: it})
}

// ---------------------------------------------------------------------------
// GET /api/v1/timeline/assignable-users
// ---------------------------------------------------------------------------

// ListAssignableUsers handles GET /api/v1/timeline/assignable-users.
func (h *TimelineHandler) ListAssignableUsers(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	users, err := h.svc.ListAssignableUsers(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list assignable users")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: users})
}

// ---------------------------------------------------------------------------
// GET /api/v1/timeline/tenders
// GET /api/v1/timeline/tenders/{tenderId}/groups
// GET /api/v1/timeline/groups/{groupId}/iterations?user_id=
// ---------------------------------------------------------------------------

// ListTimelineTenders handles GET /api/v1/timeline/tenders.
func (h *TimelineHandler) ListTimelineTenders(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	out, err := h.svc.ListTimelineTenders(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list timeline tenders")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

// ListTenderGroups handles GET /api/v1/timeline/tenders/{tenderId}/groups.
func (h *TimelineHandler) ListTenderGroups(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "tenderId")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	out, err := h.svc.ListTenderGroups(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list tender groups")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

// ListGroupIterations handles
// GET /api/v1/timeline/groups/{groupId}/iterations?user_id=.
func (h *TimelineHandler) ListGroupIterations(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	groupID := chi.URLParam(r, "groupId")
	userID := r.URL.Query().Get("user_id")
	if groupID == "" || userID == "" {
		apierr.BadRequest("group id and user_id are required").Render(w)
		return
	}
	out, err := h.svc.ListGroupIterations(r.Context(), groupID, userID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list group iterations")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

// ---------------------------------------------------------------------------
// POST /api/v1/timeline/iterations
// ---------------------------------------------------------------------------

// createIterationReq is the request body. user_id is taken from the JWT,
// never from the body.
type createIterationReq struct {
	GroupID         string   `json:"group_id"         validate:"required,uuid"`
	IterationNumber int      `json:"iteration_number" validate:"gte=0"`
	UserComment     string   `json:"user_comment"`
	UserAmount      *float64 `json:"user_amount"`
}

// CreateIteration handles POST /api/v1/timeline/iterations.
func (h *TimelineHandler) CreateIteration(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req createIterationReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	it, err := h.svc.CreateIteration(r.Context(), repository.CreateIterationInput{
		GroupID:         req.GroupID,
		UserID:          authUser.ID,
		IterationNumber: req.IterationNumber,
		UserComment:     req.UserComment,
		UserAmount:      req.UserAmount,
	})
	if err != nil {
		if p := apierr.ProblemFromPgErr(err, map[string]string{
			"tender_iterations_group_id_user_id_iteration_number_key": "Итерация с таким номером уже отправлена",
		}); p != nil {
			p.Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to create iteration")
		return
	}

	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: it})
}

type reconcileGroupsReq struct {
	ExcludedUserIDs []string                   `json:"excluded_user_ids"`
	ExpectedGroups  []repository.ExpectedGroup `json:"expected_groups"`
}

// ReconcileGroups handles POST /api/v1/timeline/tenders/{tenderId}/reconcile-groups.
func (h *TimelineHandler) ReconcileGroups(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "tenderId")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	var req reconcileGroupsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.ReconcileTenderGroups(r.Context(), tenderID, req.ExcludedUserIDs, req.ExpectedGroups); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to reconcile tender groups")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
