package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ConstructionObjectsService — тонкая обёртка над репозиторием «Объектов».
type ConstructionObjectsService struct {
	repo *repository.ConstructionObjectsRepo
}

// NewConstructionObjectsService creates a ConstructionObjectsService.
func NewConstructionObjectsService(repo *repository.ConstructionObjectsRepo) *ConstructionObjectsService {
	return &ConstructionObjectsService{repo: repo}
}

func (s *ConstructionObjectsService) List(ctx context.Context) ([]repository.ConstructionObjectRow, error) {
	rows, err := s.repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectsService.List: %w", err)
	}
	return rows, nil
}

func (s *ConstructionObjectsService) Create(ctx context.Context, in repository.ConstructionObjectInput, createdBy *string) (*repository.ConstructionObjectRow, error) {
	o, err := s.repo.Create(ctx, in, createdBy)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectsService.Create: %w", err)
	}
	return o, nil
}

func (s *ConstructionObjectsService) Update(ctx context.Context, id string, in repository.ConstructionObjectInput) (*repository.ConstructionObjectRow, error) {
	o, err := s.repo.Update(ctx, id, in)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectsService.Update: %w", err)
	}
	return o, nil
}

func (s *ConstructionObjectsService) Delete(ctx context.Context, id string) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return fmt.Errorf("constructionObjectsService.Delete: %w", err)
	}
	return nil
}
