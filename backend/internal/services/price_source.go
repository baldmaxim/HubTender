package services

import (
	"context"
	"fmt"

	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/repository"
)

type priceSourceLoader interface {
	LoadSnapshot(ctx context.Context, tenderID string) (*repository.SourceSnapshot, error)
}

// PriceSourceService — read-only аналитика источников цен. Row-метрики
// доступны при любом финансовом статусе (источники можно чинить и при stale);
// amount-метрики движок сам отключает при неактуальном расчёте (§7).
type PriceSourceService struct {
	repo priceSourceLoader
}

// NewPriceSourceService creates a PriceSourceService.
func NewPriceSourceService(repo *repository.PriceSourceRepo) *PriceSourceService {
	return &PriceSourceService{repo: repo}
}

// TenderPriceSourceQuality строит полный отчёт (фильтры/пагинация — handler).
// as-of date — СЕРВЕРНАЯ (из snapshot), клиентское время не участвует.
func (s *PriceSourceService) TenderPriceSourceQuality(
	ctx context.Context, tenderID string, maxAgeDays int,
) (*ps.Report, error) {
	snap, err := s.repo.LoadSnapshot(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("priceSourceService: %w", err)
	}
	return ps.Evaluate(tenderID, snap.InputRev, snap.CalcRev, snap.CalcStatus,
		snap.GeneratedAt, snap.AsOfDate, maxAgeDays, ps.DefaultExpiringSoonDays, snap.Items), nil
}
