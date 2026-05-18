package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// cloneRepoer is the interface CloneService depends on.
type cloneRepoer interface {
	CloneTender(ctx context.Context, sourceTenderID string) (*repository.CloneResult, error)
}

// CloneService delegates tender duplication to the repository and evicts
// cache keys that the new tender makes stale.
type CloneService struct {
	repo  cloneRepoer
	cache *cache.InMem
}

// NewCloneService creates a CloneService.
func NewCloneService(repo *repository.CloneRepo, c *cache.InMem) *CloneService {
	return &CloneService{repo: repo, cache: c}
}

// CloneTender duplicates a tender as a new version (atomic in the SQL
// function), then evicts:
//   - tender:overview:<newTenderID> — the new tender reloads fresh
//   - tenders:list:*                — list results across users are stale
func (s *CloneService) CloneTender(
	ctx context.Context,
	sourceTenderID string,
) (*repository.CloneResult, error) {
	result, err := s.repo.CloneTender(ctx, sourceTenderID)
	if err != nil {
		return nil, fmt.Errorf("cloneService.CloneTender: %w", err)
	}

	s.cache.Delete("tender:overview:" + result.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)

	return result, nil
}
