package services

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

type redistributionRepoer interface {
	SaveResults(
		ctx context.Context,
		tenderID, tacticID string,
		records []repository.RedistributionRecord,
		rulesJSON json.RawMessage,
		createdBy string,
	) (int, error)
}

// RedistributionService wraps the repo with cache invalidation.
type RedistributionService struct {
	repo  redistributionRepoer
	cache *cache.InMem
}

// NewRedistributionService creates a RedistributionService.
func NewRedistributionService(repo *repository.RedistributionRepo, c *cache.InMem) *RedistributionService {
	return &RedistributionService{repo: repo, cache: c}
}

// SaveResults persists the redistribution snapshot for (tenderID, tacticID)
// atomically and invalidates caches that depend on redistributed work costs.
// pg_notify triggers on cost_redistribution_results already broadcast
// tender:<id> to WebSocket subscribers — no manual publish required.
func (s *RedistributionService) SaveResults(
	ctx context.Context,
	tenderID, tacticID string,
	records []repository.RedistributionRecord,
	rulesJSON json.RawMessage,
	createdBy string,
) (int, error) {
	count, err := s.repo.SaveResults(ctx, tenderID, tacticID, records, rulesJSON, createdBy)
	if err != nil {
		return 0, fmt.Errorf("redistributionService.SaveResults: %w", err)
	}

	s.cache.Delete("tender:overview:" + tenderID)
	s.cache.Delete("positions:with_costs:" + tenderID)

	return count, nil
}
