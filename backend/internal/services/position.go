package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// positionRepoer is the interface PositionService depends on.
type positionRepoer interface {
	ListPositions(ctx context.Context, p repository.PositionListParams) ([]repository.PositionRow, error)
	GetPositionByID(ctx context.Context, id string) (*repository.PositionRow, error)
	CreatePosition(ctx context.Context, in repository.CreatePositionInput) (*repository.PositionRow, error)
	UpdatePosition(ctx context.Context, id string, in repository.UpdatePositionInput) (*repository.PositionRow, error)
	BulkDeletePositions(ctx context.Context, positionIDs []string) error
	CreateAdditionalPosition(ctx context.Context, in repository.CreateAdditionalPositionInput) (string, error)
	UpdatePositionsNote(ctx context.Context, ids []string, note string) error
	ClearPositionsBoq(ctx context.Context, ids []string) error
	ShiftPositionsLevel(ctx context.Context, ids []string, delta int) error
}

// PositionService provides access to client_positions data.
// Results are not cached at the service layer because pagination cursors
// and tender IDs vary per request.
type PositionService struct {
	repo  positionRepoer
	cache *cache.InMem // reserved for future per-tender full-list caching
}

// NewPositionService creates a PositionService.
func NewPositionService(repo *repository.PositionRepo, c *cache.InMem) *PositionService {
	return &PositionService{repo: repo, cache: c}
}

// ListPositions returns a paginated list of client_positions for the given tender.
func (s *PositionService) ListPositions(
	ctx context.Context,
	p repository.PositionListParams,
) ([]repository.PositionRow, error) {
	rows, err := s.repo.ListPositions(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("positionService.ListPositions: %w", err)
	}
	return rows, nil
}

// GetPositionByID fetches a single position row by ID.
func (s *PositionService) GetPositionByID(ctx context.Context, id string) (*repository.PositionRow, error) {
	p, err := s.repo.GetPositionByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("positionService.GetPositionByID: %w", err)
	}
	return p, nil
}

// CreatePosition inserts a new client_position and invalidates the tender overview cache.
func (s *PositionService) CreatePosition(
	ctx context.Context,
	in repository.CreatePositionInput,
) (*repository.PositionRow, error) {
	p, err := s.repo.CreatePosition(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("positionService.CreatePosition: %w", err)
	}
	s.cache.Delete("tender:overview:" + p.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return p, nil
}

// UpdatePosition patches a client_position and invalidates the tender overview cache.
func (s *PositionService) UpdatePosition(
	ctx context.Context,
	id string,
	in repository.UpdatePositionInput,
	tenderID string,
) (*repository.PositionRow, error) {
	p, err := s.repo.UpdatePosition(ctx, id, in)
	if err != nil {
		return nil, fmt.Errorf("positionService.UpdatePosition: %w", err)
	}
	s.cache.Delete("tender:overview:" + tenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return p, nil
}

// BulkDeletePositions deletes positions (+their boq_items) atomically and
// invalidates the affected tender's caches.
func (s *PositionService) BulkDeletePositions(
	ctx context.Context,
	positionIDs []string,
	tenderID string,
) error {
	if err := s.repo.BulkDeletePositions(ctx, positionIDs); err != nil {
		return fmt.Errorf("positionService.BulkDeletePositions: %w", err)
	}
	if tenderID != "" {
		s.cache.Delete("tender:overview:" + tenderID)
		s.cache.Delete("positions:with_costs:" + tenderID)
	}
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return nil
}

// CreateAdditionalPosition inserts an is_additional child position and
// invalidates the tender's caches.
func (s *PositionService) CreateAdditionalPosition(
	ctx context.Context,
	in repository.CreateAdditionalPositionInput,
) (string, error) {
	id, err := s.repo.CreateAdditionalPosition(ctx, in)
	if err != nil {
		return "", fmt.Errorf("positionService.CreateAdditionalPosition: %w", err)
	}
	s.cache.Delete("tender:overview:" + in.TenderID)
	s.cache.Delete("positions:with_costs:" + in.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return id, nil
}

func (s *PositionService) invalidateTender(tenderID string) {
	if tenderID != "" {
		s.cache.Delete("tender:overview:" + tenderID)
		s.cache.Delete("positions:with_costs:" + tenderID)
	}
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
}

// UpdatePositionsNote sets manual_note on the given positions.
func (s *PositionService) UpdatePositionsNote(
	ctx context.Context, ids []string, note, tenderID string,
) error {
	if err := s.repo.UpdatePositionsNote(ctx, ids, note); err != nil {
		return fmt.Errorf("positionService.UpdatePositionsNote: %w", err)
	}
	s.invalidateTender(tenderID)
	return nil
}

// ClearPositionsBoq deletes boq_items + zeroes totals for the given positions.
func (s *PositionService) ClearPositionsBoq(
	ctx context.Context, ids []string, tenderID string,
) error {
	if err := s.repo.ClearPositionsBoq(ctx, ids); err != nil {
		return fmt.Errorf("positionService.ClearPositionsBoq: %w", err)
	}
	s.invalidateTender(tenderID)
	return nil
}

// ShiftPositionsLevel shifts hierarchy_level by delta for the given positions.
func (s *PositionService) ShiftPositionsLevel(
	ctx context.Context, ids []string, delta int, tenderID string,
) error {
	if err := s.repo.ShiftPositionsLevel(ctx, ids, delta); err != nil {
		return fmt.Errorf("positionService.ShiftPositionsLevel: %w", err)
	}
	s.invalidateTender(tenderID)
	return nil
}
