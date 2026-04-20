package services

import (
	"context"
	"fmt"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Cache TTLs per reference type.
const (
	rolesCacheTTL              = time.Hour
	unitsCacheTTL              = 24 * time.Hour
	materialNamesCacheTTL      = 15 * time.Minute
	workNamesCacheTTL          = 15 * time.Minute
	costCategoriesCacheTTL     = time.Hour
	detailCostCategoriesCacheTTL = time.Hour
)

// ReferenceService provides cached access to read-only reference tables.
// All methods follow the pattern: check cache → fetch DB on miss → store result.
type ReferenceService struct {
	repo  *repository.ReferenceRepo
	cache *cache.InMem
}

// NewReferenceService creates a ReferenceService.
func NewReferenceService(repo *repository.ReferenceRepo, c *cache.InMem) *ReferenceService {
	return &ReferenceService{repo: repo, cache: c}
}

// GetRoles returns all roles, cached for 1 hour.
func (s *ReferenceService) GetRoles(ctx context.Context) ([]repository.RoleRow, error) {
	const key = "ref:roles"

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.RoleRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetRoles(ctx)
	if err != nil {
		return nil, fmt.Errorf("referenceService.GetRoles: %w", err)
	}

	s.cache.Set(key, rows, rolesCacheTTL)
	return rows, nil
}

// GetUnits returns distinct units, cached for 24 hours.
func (s *ReferenceService) GetUnits(ctx context.Context) ([]repository.UnitRow, error) {
	const key = "ref:units"

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.UnitRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetUnits(ctx)
	if err != nil {
		return nil, fmt.Errorf("referenceService.GetUnits: %w", err)
	}

	s.cache.Set(key, rows, unitsCacheTTL)
	return rows, nil
}

// GetMaterialNames returns all material names, cached for 15 minutes.
func (s *ReferenceService) GetMaterialNames(ctx context.Context) ([]repository.MaterialNameRow, error) {
	const key = "ref:material_names"

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.MaterialNameRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetMaterialNames(ctx)
	if err != nil {
		return nil, fmt.Errorf("referenceService.GetMaterialNames: %w", err)
	}

	s.cache.Set(key, rows, materialNamesCacheTTL)
	return rows, nil
}

// GetWorkNames returns all work names, cached for 15 minutes.
func (s *ReferenceService) GetWorkNames(ctx context.Context) ([]repository.WorkNameRow, error) {
	const key = "ref:work_names"

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.WorkNameRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetWorkNames(ctx)
	if err != nil {
		return nil, fmt.Errorf("referenceService.GetWorkNames: %w", err)
	}

	s.cache.Set(key, rows, workNamesCacheTTL)
	return rows, nil
}

// GetCostCategories returns all cost categories, cached for 1 hour.
func (s *ReferenceService) GetCostCategories(ctx context.Context) ([]repository.CostCategoryRow, error) {
	const key = "ref:cost_categories"

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.CostCategoryRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetCostCategories(ctx)
	if err != nil {
		return nil, fmt.Errorf("referenceService.GetCostCategories: %w", err)
	}

	s.cache.Set(key, rows, costCategoriesCacheTTL)
	return rows, nil
}

// GetDetailCostCategories returns detail cost categories, optionally filtered
// by costCategoryID. Cached per filter value for 1 hour.
func (s *ReferenceService) GetDetailCostCategories(
	ctx context.Context,
	costCategoryID string,
) ([]repository.DetailCostCategoryRow, error) {
	key := "ref:detail_cost_categories:" + costCategoryID

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.DetailCostCategoryRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.GetDetailCostCategories(ctx, costCategoryID)
	if err != nil {
		return nil, fmt.Errorf("referenceService.GetDetailCostCategories: %w", err)
	}

	s.cache.Set(key, rows, detailCostCategoriesCacheTTL)
	return rows, nil
}
