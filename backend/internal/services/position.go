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
