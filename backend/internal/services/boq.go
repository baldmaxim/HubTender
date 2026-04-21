package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// boqRepoer is the interface BoqService depends on.
type boqRepoer interface {
	ListBoqItems(ctx context.Context, tenderID, positionID string) ([]repository.BoqItemRow, error)
}

// BoqService provides access to boq_items data.
type BoqService struct {
	repo  boqRepoer
	cache *cache.InMem // reserved for future caching
}

// NewBoqService creates a BoqService.
func NewBoqService(repo *repository.BoqRepo, c *cache.InMem) *BoqService {
	return &BoqService{repo: repo, cache: c}
}

// ListBoqItems returns all BOQ items for the given position under a tender.
func (s *BoqService) ListBoqItems(
	ctx context.Context,
	tenderID, positionID string,
) ([]repository.BoqItemRow, error) {
	rows, err := s.repo.ListBoqItems(ctx, tenderID, positionID)
	if err != nil {
		return nil, fmt.Errorf("boqService.ListBoqItems: %w", err)
	}
	return rows, nil
}
