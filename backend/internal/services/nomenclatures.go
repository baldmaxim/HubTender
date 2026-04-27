package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// NomenclaturesService wraps the nomenclatures repo, invalidating the
// references caches on writes so the useApiReferences hooks pick up changes.
type NomenclaturesService struct {
	repo  *repository.NomenclaturesRepo
	cache *cache.InMem
}

// NewNomenclaturesService creates a NomenclaturesService.
func NewNomenclaturesService(repo *repository.NomenclaturesRepo, c *cache.InMem) *NomenclaturesService {
	return &NomenclaturesService{repo: repo, cache: c}
}

func (s *NomenclaturesService) invalidate() {
	s.cache.DeleteByPrefix("ref:units")
	s.cache.DeleteByPrefix("ref:material_names")
	s.cache.DeleteByPrefix("ref:work_names")
}

// Pass-through reads.

func (s *NomenclaturesService) ListUnits(ctx context.Context) ([]repository.UnitFull, error) {
	return s.repo.ListUnits(ctx)
}
func (s *NomenclaturesService) ListActiveUnitsShort(ctx context.Context) ([]repository.ActiveUnitShort, error) {
	return s.repo.ListActiveUnitsShort(ctx)
}
func (s *NomenclaturesService) UnitExists(ctx context.Context, code string) (bool, error) {
	return s.repo.UnitExists(ctx, code)
}
func (s *NomenclaturesService) ListMaterialNames(ctx context.Context) ([]repository.NamedRow, error) {
	return s.repo.ListMaterialNames(ctx)
}
func (s *NomenclaturesService) ListWorkNames(ctx context.Context) ([]repository.NamedRow, error) {
	return s.repo.ListWorkNames(ctx)
}
func (s *NomenclaturesService) ListMaterialNamesByUnit(ctx context.Context, unit string) ([]repository.NameUnitPair, error) {
	return s.repo.ListMaterialNamesByUnit(ctx, unit)
}
func (s *NomenclaturesService) ListWorkNamesByUnit(ctx context.Context, unit string) ([]repository.NameUnitPair, error) {
	return s.repo.ListWorkNamesByUnit(ctx, unit)
}

// Writes invalidate caches.

func (s *NomenclaturesService) CreateUnit(ctx context.Context, in repository.UnitInput) error {
	if err := s.repo.CreateUnit(ctx, in); err != nil {
		return fmt.Errorf("nomenclaturesService.CreateUnit: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) UpdateUnit(ctx context.Context, code string, in repository.UnitInput) error {
	if err := s.repo.UpdateUnit(ctx, code, in); err != nil {
		return fmt.Errorf("nomenclaturesService.UpdateUnit: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) DeleteUnit(ctx context.Context, code string) error {
	if err := s.repo.DeleteUnit(ctx, code); err != nil {
		return fmt.Errorf("nomenclaturesService.DeleteUnit: %w", err)
	}
	s.invalidate()
	return nil
}

func (s *NomenclaturesService) CreateMaterialName(ctx context.Context, in repository.NameInput) error {
	if err := s.repo.CreateMaterialName(ctx, in); err != nil {
		return fmt.Errorf("nomenclaturesService.CreateMaterialName: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) UpdateMaterialName(ctx context.Context, id string, in repository.NameInput) error {
	if err := s.repo.UpdateMaterialName(ctx, id, in); err != nil {
		return fmt.Errorf("nomenclaturesService.UpdateMaterialName: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) DeleteMaterialName(ctx context.Context, id string) error {
	if err := s.repo.DeleteMaterialName(ctx, id); err != nil {
		return fmt.Errorf("nomenclaturesService.DeleteMaterialName: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) DeleteMaterialNamesIn(ctx context.Context, ids []string) error {
	if err := s.repo.DeleteMaterialNamesIn(ctx, ids); err != nil {
		return fmt.Errorf("nomenclaturesService.DeleteMaterialNamesIn: %w", err)
	}
	s.invalidate()
	return nil
}

func (s *NomenclaturesService) CreateWorkName(ctx context.Context, in repository.NameInput) error {
	if err := s.repo.CreateWorkName(ctx, in); err != nil {
		return fmt.Errorf("nomenclaturesService.CreateWorkName: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) UpdateWorkName(ctx context.Context, id string, in repository.NameInput) error {
	if err := s.repo.UpdateWorkName(ctx, id, in); err != nil {
		return fmt.Errorf("nomenclaturesService.UpdateWorkName: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) DeleteWorkName(ctx context.Context, id string) error {
	if err := s.repo.DeleteWorkName(ctx, id); err != nil {
		return fmt.Errorf("nomenclaturesService.DeleteWorkName: %w", err)
	}
	s.invalidate()
	return nil
}
func (s *NomenclaturesService) DeleteWorkNamesIn(ctx context.Context, ids []string) error {
	if err := s.repo.DeleteWorkNamesIn(ctx, ids); err != nil {
		return fmt.Errorf("nomenclaturesService.DeleteWorkNamesIn: %w", err)
	}
	s.invalidate()
	return nil
}

func (s *NomenclaturesService) RemapBoqMaterialName(ctx context.Context, from, to string) error {
	if err := s.repo.RemapBoqMaterialName(ctx, from, to); err != nil {
		return fmt.Errorf("nomenclaturesService.RemapBoqMaterialName: %w", err)
	}
	return nil
}
func (s *NomenclaturesService) RemapMaterialsLibraryMaterialName(ctx context.Context, from, to string) error {
	if err := s.repo.RemapMaterialsLibraryMaterialName(ctx, from, to); err != nil {
		return fmt.Errorf("nomenclaturesService.RemapMaterialsLibraryMaterialName: %w", err)
	}
	return nil
}
func (s *NomenclaturesService) RemapBoqWorkName(ctx context.Context, from, to string) error {
	if err := s.repo.RemapBoqWorkName(ctx, from, to); err != nil {
		return fmt.Errorf("nomenclaturesService.RemapBoqWorkName: %w", err)
	}
	return nil
}
func (s *NomenclaturesService) RemapWorksLibraryWorkName(ctx context.Context, from, to string) error {
	if err := s.repo.RemapWorksLibraryWorkName(ctx, from, to); err != nil {
		return fmt.Errorf("nomenclaturesService.RemapWorksLibraryWorkName: %w", err)
	}
	return nil
}
