package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ConstructionObjectDocumentsService — тонкая обёртка над репозиторием документов «Объектов».
type ConstructionObjectDocumentsService struct {
	repo *repository.ConstructionObjectDocumentsRepo
}

// NewConstructionObjectDocumentsService creates a ConstructionObjectDocumentsService.
func NewConstructionObjectDocumentsService(repo *repository.ConstructionObjectDocumentsRepo) *ConstructionObjectDocumentsService {
	return &ConstructionObjectDocumentsService{repo: repo}
}

func (s *ConstructionObjectDocumentsService) List(ctx context.Context, objectID string) ([]repository.ConstructionObjectDocumentMeta, error) {
	rows, err := s.repo.List(ctx, objectID)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsService.List: %w", err)
	}
	return rows, nil
}

func (s *ConstructionObjectDocumentsService) Create(ctx context.Context, objectID string, in repository.ConstructionObjectDocumentInput, createdBy *string) (*repository.ConstructionObjectDocumentMeta, error) {
	m, err := s.repo.Create(ctx, objectID, in, createdBy)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsService.Create: %w", err)
	}
	return m, nil
}

func (s *ConstructionObjectDocumentsService) UpdateMeta(ctx context.Context, docID string, title, docDate *string) (*repository.ConstructionObjectDocumentMeta, error) {
	m, err := s.repo.UpdateMeta(ctx, docID, title, docDate)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsService.UpdateMeta: %w", err)
	}
	return m, nil
}

func (s *ConstructionObjectDocumentsService) Delete(ctx context.Context, docID string) error {
	if err := s.repo.Delete(ctx, docID); err != nil {
		return fmt.Errorf("constructionObjectDocumentsService.Delete: %w", err)
	}
	return nil
}

func (s *ConstructionObjectDocumentsService) File(ctx context.Context, docID string) (*repository.ConstructionObjectDocumentFile, error) {
	f, err := s.repo.File(ctx, docID)
	if err != nil {
		return nil, fmt.Errorf("constructionObjectDocumentsService.File: %w", err)
	}
	return f, nil
}
