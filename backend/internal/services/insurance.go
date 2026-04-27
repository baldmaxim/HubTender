package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// InsuranceService wraps the insurance repo with cache invalidation.
type InsuranceService struct {
	repo  *repository.InsuranceRepo
	cache *cache.InMem
}

// NewInsuranceService creates an InsuranceService.
func NewInsuranceService(repo *repository.InsuranceRepo, c *cache.InMem) *InsuranceService {
	return &InsuranceService{repo: repo, cache: c}
}

// Get loads insurance row for the tender. Returns (nil, nil) on miss.
func (s *InsuranceService) Get(ctx context.Context, tenderID string) (*repository.InsuranceRow, error) {
	row, err := s.repo.Get(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("insuranceService.Get: %w", err)
	}
	return row, nil
}

// Upsert delegates to the repo and invalidates tender overview cache because
// FI calculations depend on insurance values.
func (s *InsuranceService) Upsert(ctx context.Context, tenderID string, in repository.InsuranceRow) (*repository.InsuranceRow, error) {
	row, err := s.repo.Upsert(ctx, tenderID, in)
	if err != nil {
		return nil, fmt.Errorf("insuranceService.Upsert: %w", err)
	}
	s.cache.Delete("tender:overview:" + tenderID)
	return row, nil
}
