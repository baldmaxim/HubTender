package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// costImportRepoer is the interface CostImportService depends on.
type costImportRepoer interface {
	Import(ctx context.Context, categories []repository.CostImportCategory, details []repository.CostImportDetail) (int, error)
}

// CostImportService runs the Excel cost-category import and invalidates the
// cost-category caches afterwards.
type CostImportService struct {
	repo  costImportRepoer
	cache *cache.InMem
}

// NewCostImportService creates a CostImportService.
func NewCostImportService(repo *repository.CostImportRepo, c *cache.InMem) *CostImportService {
	return &CostImportService{repo: repo, cache: c}
}

// Import imports categories + detail categories atomically.
func (s *CostImportService) Import(
	ctx context.Context,
	categories []repository.CostImportCategory,
	details []repository.CostImportDetail,
) (int, error) {
	n, err := s.repo.Import(ctx, categories, details)
	if err != nil {
		return 0, fmt.Errorf("costImportService.Import: %w", err)
	}
	// Справочники категорий затрат изменились — сбросить их кэш.
	s.cache.Delete("cost-categories:all")
	s.cache.Delete("detail-cost-categories:by-order")
	return n, nil
}
