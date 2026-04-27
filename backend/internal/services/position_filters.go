package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// PositionFiltersService is a thin wrapper around the repo. Filter data is
// per-(user, tender) and rarely worth caching, so no cache invalidation here.
type PositionFiltersService struct {
	repo *repository.PositionFiltersRepo
}

// NewPositionFiltersService creates a PositionFiltersService.
func NewPositionFiltersService(repo *repository.PositionFiltersRepo) *PositionFiltersService {
	return &PositionFiltersService{repo: repo}
}

func (s *PositionFiltersService) List(ctx context.Context, userID, tenderID string) ([]string, error) {
	ids, err := s.repo.List(ctx, userID, tenderID)
	if err != nil {
		return nil, fmt.Errorf("positionFiltersService.List: %w", err)
	}
	return ids, nil
}

func (s *PositionFiltersService) Replace(ctx context.Context, userID, tenderID string, positionIDs []string) error {
	if err := s.repo.Replace(ctx, userID, tenderID, positionIDs); err != nil {
		return fmt.Errorf("positionFiltersService.Replace: %w", err)
	}
	return nil
}

func (s *PositionFiltersService) Append(ctx context.Context, userID, tenderID, positionID string) error {
	if err := s.repo.Append(ctx, userID, tenderID, positionID); err != nil {
		return fmt.Errorf("positionFiltersService.Append: %w", err)
	}
	return nil
}

func (s *PositionFiltersService) Clear(ctx context.Context, userID, tenderID string) error {
	if err := s.repo.Clear(ctx, userID, tenderID); err != nil {
		return fmt.Errorf("positionFiltersService.Clear: %w", err)
	}
	return nil
}
