package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// comparisonRepoer is the interface ComparisonService depends on.
type comparisonRepoer interface {
	ListNotes(ctx context.Context, t1, t2 string) ([]repository.ComparisonNoteRow, error)
	UpsertNotePair(ctx context.Context, t1, t2, costCategoryName string, detailCategoryKey *string, note, createdBy string) error
	ListCostVolumes(ctx context.Context, tenderID string) ([]repository.CostVolumeRow, error)
}

// ComparisonService handles object-comparison notes + cost volumes.
type ComparisonService struct {
	repo comparisonRepoer
}

// NewComparisonService creates a ComparisonService.
func NewComparisonService(repo *repository.ComparisonRepo) *ComparisonService {
	return &ComparisonService{repo: repo}
}

func (s *ComparisonService) ListNotes(ctx context.Context, t1, t2 string) ([]repository.ComparisonNoteRow, error) {
	n, err := s.repo.ListNotes(ctx, t1, t2)
	if err != nil {
		return nil, fmt.Errorf("comparisonService.ListNotes: %w", err)
	}
	return n, nil
}

func (s *ComparisonService) UpsertNotePair(ctx context.Context, t1, t2, costCategoryName string, detailCategoryKey *string, note, createdBy string) error {
	if err := s.repo.UpsertNotePair(ctx, t1, t2, costCategoryName, detailCategoryKey, note, createdBy); err != nil {
		return fmt.Errorf("comparisonService.UpsertNotePair: %w", err)
	}
	return nil
}

func (s *ComparisonService) ListCostVolumes(ctx context.Context, tenderID string) ([]repository.CostVolumeRow, error) {
	v, err := s.repo.ListCostVolumes(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("comparisonService.ListCostVolumes: %w", err)
	}
	return v, nil
}
