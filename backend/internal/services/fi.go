package services

import (
	"context"

	"github.com/su10/hubtender/backend/internal/repository"
)

// FIService is a thin pass-through over the FI repo.
type FIService struct {
	repo *repository.FIRepo
}

// NewFIService creates an FIService.
func NewFIService(repo *repository.FIRepo) *FIService {
	return &FIService{repo: repo}
}

func (s *FIService) GetTenderByID(ctx context.Context, id string) (*repository.FITenderRow, error) {
	return s.repo.GetTenderByID(ctx, id)
}

func (s *FIService) ListAllBoqItemsForTender(ctx context.Context, tenderID string) ([]repository.FIBoqItemRow, error) {
	return s.repo.ListAllBoqItemsForTender(ctx, tenderID)
}
