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

func (s *LibraryService) ListFolders(ctx context.Context, folderType string) ([]repository.LibraryFolderRow, error) {
	return s.repo.ListFolders(ctx, folderType)
}

func (s *LibraryService) CreateFolder(ctx context.Context, in repository.LibraryFolderInput) error {
	if err := s.repo.CreateFolder(ctx, in); err != nil {
		return fmt.Errorf("libraryService.CreateFolder: %w", err)
	}
	return nil
}

func (s *LibraryService) RenameFolder(ctx context.Context, id, name string) error {
	if err := s.repo.RenameFolder(ctx, id, name); err != nil {
		return fmt.Errorf("libraryService.RenameFolder: %w", err)
	}
	return nil
}

func (s *LibraryService) DeleteFolder(ctx context.Context, id string) error {
	if err := s.repo.DeleteFolder(ctx, id); err != nil {
		return fmt.Errorf("libraryService.DeleteFolder: %w", err)
	}
	return nil
}

func (s *LibraryService) MoveLibraryItem(ctx context.Context, table, itemID string, folderID *string) error {
	if err := s.repo.MoveLibraryItem(ctx, table, itemID, folderID); err != nil {
		return fmt.Errorf("libraryService.MoveLibraryItem: %w", err)
	}
	s.cache.Delete("works-library:all")
	s.cache.Delete("materials-library:all")
	return nil
}

func (s *LibraryService) ListTemplates(ctx context.Context) ([]repository.TemplateRow, error) {
	return s.repo.ListTemplates(ctx)
}

func (s *LibraryService) DeleteTemplate(ctx context.Context, id string) error {
	if err := s.repo.DeleteTemplate(ctx, id); err != nil {
		return fmt.Errorf("libraryService.DeleteTemplate: %w", err)
	}
	return nil
}

func (s *LibraryService) ListTemplateItems(ctx context.Context, templateID string) ([]repository.TemplateItemRow, error) {
	return s.repo.ListTemplateItems(ctx, templateID)
}

func (s *LibraryService) DeleteTemplateItem(ctx context.Context, id string) error {
	if err := s.repo.DeleteTemplateItem(ctx, id); err != nil {
		return fmt.Errorf("libraryService.DeleteTemplateItem: %w", err)
	}
	return nil
}

func (s *LibraryService) CreateTemplate(ctx context.Context, in repository.CreateTemplateInput) (string, error) {
	id, err := s.repo.CreateTemplate(ctx, in)
	if err != nil {
		return "", fmt.Errorf("libraryService.CreateTemplate: %w", err)
	}
	return id, nil
}

func (s *LibraryService) UpdateTemplate(ctx context.Context, id string, in repository.UpdateTemplateInput) error {
	if err := s.repo.UpdateTemplate(ctx, id, in); err != nil {
		return fmt.Errorf("libraryService.UpdateTemplate: %w", err)
	}
	return nil
}

func (s *LibraryService) AddTemplateItem(ctx context.Context, templateID string, in repository.AddTemplateItemInput) (*repository.TemplateItemRow, error) {
	row, err := s.repo.AddTemplateItem(ctx, templateID, in)
	if err != nil {
		return nil, fmt.Errorf("libraryService.AddTemplateItem: %w", err)
	}
	return row, nil
}
