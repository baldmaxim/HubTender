package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

type ConstructionCostVolumesService struct {
	repo *repository.ConstructionCostVolumesRepo
}

func NewConstructionCostVolumesService(repo *repository.ConstructionCostVolumesRepo) *ConstructionCostVolumesService {
	return &ConstructionCostVolumesService{repo: repo}
}

func (s *ConstructionCostVolumesService) ListByTender(ctx context.Context, tenderID string) ([]repository.ConstructionCostVolumeRow, error) {
	rows, err := s.repo.ListByTender(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("ccvService.ListByTender: %w", err)
	}
	return rows, nil
}

func (s *ConstructionCostVolumesService) UpsertVolume(
	ctx context.Context, tenderID string, detailCostCategoryID, groupKey *string, volume float64,
) error {
	if err := s.repo.UpsertVolume(ctx, tenderID, detailCostCategoryID, groupKey, volume); err != nil {
		return fmt.Errorf("ccvService.UpsertVolume: %w", err)
	}
	return nil
}
