package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// LibraryService is a thin wrapper around the library repo with cache
// invalidation for the works/materials reference caches.
type LibraryService struct {
	repo  *repository.LibraryRepo
	cache *cache.InMem
}

// NewLibraryService creates a LibraryService.
func NewLibraryService(repo *repository.LibraryRepo, c *cache.InMem) *LibraryService {
	return &LibraryService{repo: repo, cache: c}
}

func (s *LibraryService) ListWorks(ctx context.Context) ([]repository.WorkLibraryRow, error) {
	return s.repo.ListWorks(ctx)
}

func (s *LibraryService) CreateWork(ctx context.Context, in repository.WorkLibraryInput) error {
	if err := s.repo.CreateWork(ctx, in); err != nil {
		return fmt.Errorf("libraryService.CreateWork: %w", err)
	}
	s.cache.Delete("works-library:all")
	return nil
}

func (s *LibraryService) UpdateWork(ctx context.Context, id string, in repository.WorkLibraryInput) error {
	if err := s.repo.UpdateWork(ctx, id, in); err != nil {
		return fmt.Errorf("libraryService.UpdateWork: %w", err)
	}
	s.cache.Delete("works-library:all")
	return nil
}

func (s *LibraryService) DeleteWork(ctx context.Context, id string) error {
	if err := s.repo.DeleteWork(ctx, id); err != nil {
		return fmt.Errorf("libraryService.DeleteWork: %w", err)
	}
	s.cache.Delete("works-library:all")
	return nil
}

func (s *LibraryService) ListMaterials(ctx context.Context) ([]repository.MaterialLibraryRow, error) {
	return s.repo.ListMaterials(ctx)
}

func (s *LibraryService) CreateMaterial(ctx context.Context, in repository.MaterialLibraryInput) error {
	if err := s.repo.CreateMaterial(ctx, in); err != nil {
		return fmt.Errorf("libraryService.CreateMaterial: %w", err)
	}
	s.cache.Delete("materials-library:all")
	return nil
}

func (s *LibraryService) UpdateMaterial(ctx context.Context, id string, in repository.MaterialLibraryInput) error {
	if err := s.repo.UpdateMaterial(ctx, id, in); err != nil {
		return fmt.Errorf("libraryService.UpdateMaterial: %w", err)
	}
	s.cache.Delete("materials-library:all")
	return nil
}

func (s *LibraryService) DeleteMaterial(ctx context.Context, id string) error {
	if err := s.repo.DeleteMaterial(ctx, id); err != nil {
		return fmt.Errorf("libraryService.DeleteMaterial: %w", err)
	}
	s.cache.Delete("materials-library:all")
	return nil
}
