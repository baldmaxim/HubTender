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
