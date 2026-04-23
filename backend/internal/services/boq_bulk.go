package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// bulkBoqRepoer is the interface BulkBoqService depends on.
type bulkBoqRepoer interface {
	BulkUpdateCommercial(
		ctx context.Context,
		rows []repository.BulkCommercialRow,
	) (int, []string, error)
}

// BulkBoqService handles bulk commercial cost updates and cache invalidation.
type BulkBoqService struct {
	repo  bulkBoqRepoer
	cache *cache.InMem
}

// NewBulkBoqService creates a BulkBoqService.
func NewBulkBoqService(repo *repository.BulkBoqRepo, c *cache.InMem) *BulkBoqService {
	return &BulkBoqService{repo: repo, cache: c}
}

// BulkUpdateCommercial delegates to the repository and invalidates both
// tender:overview and positions:with_costs cache keys for every affected tender.
func (s *BulkBoqService) BulkUpdateCommercial(
	ctx context.Context,
	rows []repository.BulkCommercialRow,
) (int, error) {
	count, tenderIDs, err := s.repo.BulkUpdateCommercial(ctx, rows)
	if err != nil {
		return 0, fmt.Errorf("bulkBoqService.BulkUpdateCommercial: %w", err)
	}

	for _, tid := range tenderIDs {
		s.cache.Delete("tender:overview:" + tid)
		s.cache.Delete("positions:with_costs:" + tid)
	}
	if len(tenderIDs) > 0 {
		s.cache.DeleteByPrefix(tenderListKeyPrefix)
	}

	return count, nil
}
