package services

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/repository"
)

// privilegedRoleCodes mirrors the allowlist from is_tender_timeline_privileged().
// The PL/pgSQL function lists: administrator, developer, director, senior_group,
// veduschiy_inzhener. Per the task spec the Go layer uses the four standard codes
// plus senior_group (the task spec says general_director, not veduschiy_inzhener).
// Both lists are kept to match the actual DB function exactly — adjust if the
// function is updated.
var privilegedRoleCodes = map[string]struct{}{
	"administrator":    {},
	"developer":        {},
	"director":         {},
	"general_director": {},
	"senior_group":     {},
}

// timelineRepoer is the interface TimelineService depends on.
type timelineRepoer interface {
	SetGroupQuality(ctx context.Context, groupID string, qualityLevel *int16, qualityComment *string, updatedBy string) (*repository.TenderGroupRow, error)
	RespondIteration(ctx context.Context, iterationID, managerID, managerComment, approvalStatus string) (*repository.TenderIterationRow, error)
	GetUserRoleCode(ctx context.Context, userID string) (string, error)
	ListAssignableUsers(ctx context.Context) ([]repository.TimelineUserRef, error)
	CreateIteration(ctx context.Context, in repository.CreateIterationInput) (*repository.TenderIterationRow, error)
	ListGroupIterations(ctx context.Context, groupID, userID string) ([]repository.TimelineIterationWithRefs, error)
	ListTenderGroups(ctx context.Context, tenderID string) ([]repository.TimelineGroupWithRelations, error)
	ListTimelineTenders(ctx context.Context) (*repository.TimelineTendersPayload, error)
}

// TimelineService handles tender timeline mutations.
type TimelineService struct {
	repo timelineRepoer
}

// NewTimelineService creates a TimelineService.
func NewTimelineService(repo *repository.TimelineRepo) *TimelineService {
	return &TimelineService{repo: repo}
}

// SetGroupQuality updates quality fields on a tender_group.
// Returns (nil, pgx.ErrNoRows) when the group does not exist.
func (s *TimelineService) SetGroupQuality(
	ctx context.Context,
	groupID string,
	qualityLevel *int16,
	qualityComment *string,
	updatedBy string,
) (*repository.TenderGroupRow, error) {
	g, err := s.repo.SetGroupQuality(ctx, groupID, qualityLevel, qualityComment, updatedBy)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("timelineService.SetGroupQuality: %w", err)
	}
	return g, nil
}

// RespondIteration records a manager response on a tender_iteration.
// Returns ErrForbidden (wrapped pgx.ErrNoRows sentinel not reused — use a
// distinct sentinel) when the user's role is not in the privilege allowlist,
// and pgx.ErrNoRows when the iteration does not exist.
func (s *TimelineService) RespondIteration(
	ctx context.Context,
	iterationID string,
	userID string,
	managerComment string,
	approvalStatus string,
) (*repository.TenderIterationRow, error) {
	// Check privilege via role_code lookup.
	roleCode, err := s.repo.GetUserRoleCode(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("timelineService.RespondIteration: role lookup: %w", err)
	}

	if _, ok := privilegedRoleCodes[roleCode]; !ok {
		return nil, ErrForbidden
	}

	it, err := s.repo.RespondIteration(ctx, iterationID, userID, managerComment, approvalStatus)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("timelineService.RespondIteration: %w", err)
	}
	return it, nil
}

// ListAssignableUsers returns id/full_name/role_code for the timeline
// assignment lists.
func (s *TimelineService) ListAssignableUsers(
	ctx context.Context,
) ([]repository.TimelineUserRef, error) {
	u, err := s.repo.ListAssignableUsers(ctx)
	if err != nil {
		return nil, fmt.Errorf("timelineService.ListAssignableUsers: %w", err)
	}
	return u, nil
}

// CreateIteration inserts a manual tender_iterations row (user-side entry).
func (s *TimelineService) CreateIteration(
	ctx context.Context,
	in repository.CreateIterationInput,
) (*repository.TenderIterationRow, error) {
	it, err := s.repo.CreateIteration(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("timelineService.CreateIteration: %w", err)
	}
	return it, nil
}

// ListGroupIterations returns iterations for (groupID, userID) with refs.
func (s *TimelineService) ListGroupIterations(
	ctx context.Context,
	groupID, userID string,
) ([]repository.TimelineIterationWithRefs, error) {
	out, err := s.repo.ListGroupIterations(ctx, groupID, userID)
	if err != nil {
		return nil, fmt.Errorf("timelineService.ListGroupIterations: %w", err)
	}
	return out, nil
}

// ListTenderGroups returns the groups (+members +iter subset) for a tender.
func (s *TimelineService) ListTenderGroups(
	ctx context.Context,
	tenderID string,
) ([]repository.TimelineGroupWithRelations, error) {
	out, err := s.repo.ListTenderGroups(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("timelineService.ListTenderGroups: %w", err)
	}
	return out, nil
}

// ListTimelineTenders returns the registry + tenders-with-groups payload.
func (s *TimelineService) ListTimelineTenders(
	ctx context.Context,
) (*repository.TimelineTendersPayload, error) {
	out, err := s.repo.ListTimelineTenders(ctx)
	if err != nil {
		return nil, fmt.Errorf("timelineService.ListTimelineTenders: %w", err)
	}
	return out, nil
}

// ErrForbidden is returned when the caller's role is not in the privilege list.
var ErrForbidden = fmt.Errorf("insufficient privilege")
