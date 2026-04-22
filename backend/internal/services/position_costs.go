package services

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

const positionsCostsCacheTTL = 30 * time.Second

// positionCostsRepoer is the interface PositionCostsService depends on.
type positionCostsRepoer interface {
	GetPositionsWithCosts(ctx context.Context, tenderID string) ([]repository.PositionWithCostsRow, error)
}

// PositionCostsService provides cached access to the positions-with-costs aggregate.
// Uses the same per-tender singleflight pattern as TenderService.
type PositionCostsService struct {
	repo     positionCostsRepoer
	cache    *cache.InMem
	inflight sync.Map // key: tenderID, value: *sync.Mutex
}

// NewPositionCostsService creates a PositionCostsService.
func NewPositionCostsService(repo *repository.PositionCostsRepo, c *cache.InMem) *PositionCostsService {
	return &PositionCostsService{repo: repo, cache: c}
}

// cacheKey returns the InMem key for the given tender.
func posWithCostsCacheKey(tenderID string) string {
	return "positions:with_costs:" + tenderID
}

// GetPositionsWithCosts returns the aggregate data for all positions under a
// tender. Results are cached for 30 s; concurrent calls for the same tender
// ID are serialised via a per-ID mutex to avoid thundering-herd.
func (s *PositionCostsService) GetPositionsWithCosts(
	ctx context.Context,
	tenderID string,
) ([]repository.PositionWithCostsRow, error) {
	key := posWithCostsCacheKey(tenderID)

	// Fast path.
	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.PositionWithCostsRow); ok {
			return rows, nil
		}
	}

	// Singleflight via per-tender mutex.
	muVal, _ := s.inflight.LoadOrStore(tenderID, &sync.Mutex{})
	mu := muVal.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	// Double-check after acquiring lock.
	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.PositionWithCostsRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetPositionsWithCosts(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("positionCostsService.GetPositionsWithCosts: %w", err)
	}
	if rows == nil {
		rows = []repository.PositionWithCostsRow{}
	}

	s.cache.Set(key, rows, positionsCostsCacheTTL)
	return rows, nil
}

// InvalidateCache removes the positions-with-costs cache entry for tenderID.
func (s *PositionCostsService) InvalidateCache(tenderID string) {
	s.cache.Delete(posWithCostsCacheKey(tenderID))
}
