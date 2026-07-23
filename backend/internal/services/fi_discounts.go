package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// FIDiscountsService wraps the tender_fi_discounts repo with cache invalidation.
type FIDiscountsService struct {
	repo  *repository.FIDiscountsRepo
	cache *cache.InMem
}

// NewFIDiscountsService creates an FIDiscountsService.
func NewFIDiscountsService(repo *repository.FIDiscountsRepo, c *cache.InMem) *FIDiscountsService {
	return &FIDiscountsService{repo: repo, cache: c}
}

// Get loads the discount settings for the tender. Never returns nil on success:
// «нет строки» отдаётся как enabled=false + пустые rules.
func (s *FIDiscountsService) Get(ctx context.Context, tenderID string) (*repository.FIDiscountsRow, error) {
	row, err := s.repo.Get(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsService.Get: %w", err)
	}
	return row, nil
}

// Upsert delegates to the repo and drops the tender overview cache — снижение
// меняет итоговую коммерческую стоимость, которую сводные ручки отдают из кэша.
func (s *FIDiscountsService) Upsert(
	ctx context.Context,
	tenderID string,
	in repository.FIDiscountsRow,
	userID string,
) (*repository.FIDiscountsRow, error) {
	row, err := s.repo.Upsert(ctx, tenderID, in, userID)
	if err != nil {
		return nil, fmt.Errorf("fiDiscountsService.Upsert: %w", err)
	}
	s.cache.Delete("tender:overview:" + tenderID)
	return row, nil
}
