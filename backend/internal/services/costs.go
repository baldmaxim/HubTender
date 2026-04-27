package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// CostsService wraps the costs repo. Cache is invalidated for the references
// caches that overlap with cost_categories / detail_cost_categories so the
// useApiReferences hooks pick up admin edits immediately.
type CostsService struct {
	repo  *repository.CostsRepo
	cache *cache.InMem
}

// NewCostsService creates a CostsService.
func NewCostsService(repo *repository.CostsRepo, c *cache.InMem) *CostsService {
	return &CostsService{repo: repo, cache: c}
}

func (s *CostsService) invalidateRefs() {
	s.cache.DeleteByPrefix("ref:cost_categories")
	s.cache.DeleteByPrefix("ref:detail_cost_categories")
	s.cache.DeleteByPrefix("ref:units")
}

func (s *CostsService) ListCostCategories(ctx context.Context) ([]repository.CostCategoryRecord, error) {
	return s.repo.ListCostCategories(ctx)
}

func (s *CostsService) ListCostCategoriesByIDs(ctx context.Context, ids []string) ([]repository.CostCategoryRecord, error) {
	return s.repo.ListCostCategoriesByIDs(ctx, ids)
}

func (s *CostsService) FindCostCategoryByNameAndUnit(ctx context.Context, name, unit string) (*repository.CostCategoryRecord, error) {
	return s.repo.FindCostCategoryByNameAndUnit(ctx, name, unit)
}

func (s *CostsService) CreateCostCategory(ctx context.Context, in repository.CostCategoryInput) (*repository.CostCategoryRecord, error) {
	rec, err := s.repo.CreateCostCategory(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("costsService.CreateCostCategory: %w", err)
	}
	s.invalidateRefs()
	return rec, nil
}

func (s *CostsService) UpdateCostCategory(ctx context.Context, id string, in repository.CostCategoryInput) error {
	if err := s.repo.UpdateCostCategory(ctx, id, in); err != nil {
		return fmt.Errorf("costsService.UpdateCostCategory: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) DeleteCostCategory(ctx context.Context, id string) error {
	if err := s.repo.DeleteCostCategory(ctx, id); err != nil {
		return fmt.Errorf("costsService.DeleteCostCategory: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) DeleteAllCostCategories(ctx context.Context) error {
	if err := s.repo.DeleteAllCostCategories(ctx); err != nil {
		return fmt.Errorf("costsService.DeleteAllCostCategories: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) ListDetailCostCategoriesByOrder(ctx context.Context) ([]repository.DetailCostCategoryRecord, error) {
	return s.repo.ListDetailCostCategoriesByOrder(ctx)
}

func (s *CostsService) NextDetailOrderNum(ctx context.Context) (int, error) {
	return s.repo.NextDetailOrderNum(ctx)
}

func (s *CostsService) CreateDetailCostCategory(ctx context.Context, in repository.DetailCostCategoryInput) error {
	if err := s.repo.CreateDetailCostCategory(ctx, in); err != nil {
		return fmt.Errorf("costsService.CreateDetailCostCategory: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) UpdateDetailCostCategory(ctx context.Context, id string, p repository.DetailCostCategoryPatch) error {
	if err := s.repo.UpdateDetailCostCategory(ctx, id, p); err != nil {
		return fmt.Errorf("costsService.UpdateDetailCostCategory: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) DeleteDetailCostCategory(ctx context.Context, id string) error {
	if err := s.repo.DeleteDetailCostCategory(ctx, id); err != nil {
		return fmt.Errorf("costsService.DeleteDetailCostCategory: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) DeleteAllDetailCostCategories(ctx context.Context) error {
	if err := s.repo.DeleteAllDetailCostCategories(ctx); err != nil {
		return fmt.Errorf("costsService.DeleteAllDetailCostCategories: %w", err)
	}
	s.invalidateRefs()
	return nil
}

func (s *CostsService) ListLocationsByIDs(ctx context.Context, ids []string) ([]repository.LocationRecord, error) {
	return s.repo.ListLocationsByIDs(ctx, ids)
}

func (s *CostsService) ListActiveUnitsFull(ctx context.Context) ([]repository.UnitFull, error) {
	return s.repo.ListActiveUnitsFull(ctx)
}

func (s *CostsService) UpsertImportedUnits(ctx context.Context, units []repository.ImportedUnitRow) error {
	if err := s.repo.UpsertImportedUnits(ctx, units); err != nil {
		return fmt.Errorf("costsService.UpsertImportedUnits: %w", err)
	}
	s.invalidateRefs()
	return nil
}
