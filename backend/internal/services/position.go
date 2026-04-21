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
	return p, nil
}
