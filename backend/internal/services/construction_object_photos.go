package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ConstructionObjectPhotosService — тонкая обёртка над репозиторием фото «Объектов».
type ConstructionObjectPhotosService struct {
	repo *repository.ConstructionObjectPhotosRepo
}

// NewConstructionObjectPhotosService creates a ConstructionObjectPhotosService.
func NewConstructionObjectPhotosService(repo *repository.ConstructionObjectPhotosRepo) *ConstructionObjectPhotosService {
	return &ConstructionObjectPhotosService{repo: repo}
}

func (s *ConstructionObjectPhotosService) List(ctx context.Context, objectID string) ([]repository.ConstructionObjectPhotoMeta, error) {
	rows, err := s.repo.List(ctx, objectID)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosService.List: %w", err)
	}
	return rows, nil
}

func (s *ConstructionObjectPhotosService) Create(ctx context.Context, objectID string, in repository.ConstructionObjectPhotoInput, createdBy *string) (*repository.ConstructionObjectPhotoMeta, error) {
	m, err := s.repo.Create(ctx, objectID, in, createdBy)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosService.Create: %w", err)
	}
	return m, nil
}

func (s *ConstructionObjectPhotosService) UpdateCaption(ctx context.Context, photoID string, caption *string) (*repository.ConstructionObjectPhotoMeta, error) {
	m, err := s.repo.UpdateCaption(ctx, photoID, caption)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosService.UpdateCaption: %w", err)
	}
	return m, nil
}

func (s *ConstructionObjectPhotosService) Delete(ctx context.Context, photoID string) error {
	if err := s.repo.Delete(ctx, photoID); err != nil {
		return fmt.Errorf("constructionObjectPhotosService.Delete: %w", err)
	}
	return nil
}

func (s *ConstructionObjectPhotosService) Image(ctx context.Context, photoID string, thumb bool) (*repository.ConstructionObjectPhotoImage, error) {
	img, err := s.repo.Image(ctx, photoID, thumb)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectPhotosService.Image: %w", err)
	}
	return img, nil
}
