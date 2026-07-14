package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

// qualitySnapshotLoader — граница repo для сервиса качества.
type qualitySnapshotLoader interface {
	LoadSnapshot(ctx context.Context, tenderID string) (*quality.Snapshot, error)
}

// QualityService — read-only: один согласованный snapshot → чистый движок.
// Никакого кэша, инвалидаций, enqueue и мутаций.
type QualityService struct {
	repo qualitySnapshotLoader
}

// NewQualityService creates a QualityService.
func NewQualityService(repo *repository.QualityRepo) *QualityService {
	return &QualityService{repo: repo}
}

// TenderQuality строит отчёт «Качество расчёта» по одному snapshot.
func (s *QualityService) TenderQuality(ctx context.Context, tenderID string) (*quality.Report, error) {
	snap, err := s.repo.LoadSnapshot(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("qualityService.TenderQuality: %w", err)
	}
	return quality.Evaluate(snap), nil
}
