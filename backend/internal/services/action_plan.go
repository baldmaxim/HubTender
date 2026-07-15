package services

import (
	"context"
	"fmt"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

type actionPlanLoader interface {
	LoadSnapshots(ctx context.Context, tenderID string, periodMonths int) (*repository.ActionPlanSnapshots, error)
}

// ActionPlanService — этап 1.4: read-only композиция трёх ГОТОВЫХ аналитик в
// один план действий. Никаких мутаций, кэша, recalc и HTTP-вызовов
// собственных endpoints: один общий REPEATABLE READ READ ONLY снапшот →
// три pure-движка → pure-композиция.
type ActionPlanService struct {
	repo actionPlanLoader
}

// NewActionPlanService creates an ActionPlanService.
func NewActionPlanService(repo *repository.ActionPlanRepo) *ActionPlanService {
	return &ActionPlanService{repo: repo}
}

// TenderActionPlan строит полный план (фильтры/пагинация — handler).
// Rule A (§8): при неактуальном расчёте benchmark НЕ вычисляется — component
// price_benchmark = calculation_not_ready, quality blocker объясняет причину;
// quality- и source-действия остаются доступны (partial result не скрывается).
func (s *ActionPlanService) TenderActionPlan(
	ctx context.Context, tenderID string, periodMonths, maxAgeDays int,
) (*ap.Report, error) {
	snaps, err := s.repo.LoadSnapshots(ctx, tenderID, periodMonths)
	if err != nil {
		return nil, fmt.Errorf("actionPlanService: %w", err)
	}

	qReport := quality.Evaluate(snaps.Quality)

	src := snaps.Source
	sReport := ps.Evaluate(tenderID, src.InputRev, src.CalcRev, src.CalcStatus,
		src.GeneratedAt, src.AsOfDate, maxAgeDays, ps.DefaultExpiringSoonDays, src.Items)

	// Benchmark только при актуальном расчёте (та же семантика, что и его
	// собственный endpoint) — старые outliers не выдаются за текущие.
	var bReport *pb.Report
	bs := snaps.Benchmark
	if bs.CalcStatus == "calculated" && bs.CalcRev == bs.InputRev {
		bReport = pb.Evaluate(tenderID, bs.InputRev, bs.CalcRev, bs.CalcStatus,
			periodMonths, bs.GeneratedAt, bs.Items, bs.Observations)
	}

	items := make([]ap.ItemInfo, 0, len(src.Items))
	for _, it := range src.Items {
		items = append(items, ap.ItemInfo{
			ID:               it.ID,
			ClientPositionID: it.ClientPositionID,
			SortIndex:        it.SortIndex,
			TotalAmount:      it.TotalAmount,
		})
	}

	return ap.Compose(ap.Inputs{
		TenderID:     tenderID,
		InputRev:     src.InputRev,
		CalcRev:      src.CalcRev,
		CalcStatus:   src.CalcStatus,
		GeneratedAt:  src.GeneratedAt,
		AsOfDate:     src.AsOfDate,
		PeriodMonths: periodMonths,
		MaxAgeDays:   maxAgeDays,
		Quality:      qReport,
		Benchmark:    bReport,
		Source:       sReport,
		Items:        items,
	}), nil
}
