package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/su10/hubtender/backend/internal/analytics/costbenchmark"
	"github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ErrCostBenchmarkTenderNotFound — тендера нет.
var ErrCostBenchmarkTenderNotFound = errors.New("тендер не найден")

// ErrCostBenchmarkBadPeriod — период истории не из разрешённых.
var ErrCostBenchmarkBadPeriod = errors.New("недопустимый период истории")

type costBenchmarkRepoer interface {
	LoadCurrent(ctx context.Context, tenderID string) (*repository.CostBenchmarkCurrent, error)
	LoadHistory(ctx context.Context, periodMonths int) ([]repository.HistoryTender, error)
	EngineRanges(ctx context.Context) ([]costbenchmark.Range, error)
	ListActiveRanges(ctx context.Context) ([]repository.BenchmarkRange, error)
	CreateRange(ctx context.Context, in repository.BenchmarkRangeInput, actor *string) (string, error)
	UpdateRange(ctx context.Context, id string, in repository.BenchmarkRangeInput, actor *string) error
	DeactivateRange(ctx context.Context, id string, actor *string) error
	GetBrief(ctx context.Context, tenderID string) (*repository.TenderBrief, error)
	SaveBrief(ctx context.Context, tenderID, summaryText string, factCategoryIDs []string, actor *string) error
}

// CostBenchmarkService — эталоны удельных показателей.
//
// История кэшируется на 15 минут по периоду: это агрегат по всем согласованным
// тендерам, он меняется только при согласовании нового тендера, а считать его на
// каждое открытие страницы дорого. Текущий тендер и справочник — без кэша: правка
// диапазона или расчёта должна отражаться сразу.
type CostBenchmarkService struct {
	repo  costBenchmarkRepoer
	cache *cache.InMem
	ttl   time.Duration
}

func NewCostBenchmarkService(repo *repository.CostBenchmarkRepo, c *cache.InMem) *CostBenchmarkService {
	return &CostBenchmarkService{repo: repo, cache: c, ttl: 15 * time.Minute}
}

// CostBenchmarkResponse — отчёт по тендеру.
type CostBenchmarkResponse struct {
	TenderID          string   `json:"tender_id"`
	HousingClass      *string  `json:"housing_class"`
	ConstructionScope *string  `json:"construction_scope"`
	AreaSP            *float64 `json:"area_sp"`
	PeriodMonths      int      `json:"period_months"`
	costbenchmark.Report
}

func (s *CostBenchmarkService) history(ctx context.Context, period int) ([]repository.HistoryTender, error) {
	key := fmt.Sprintf("costbench:history:%d", period)
	if s.cache != nil {
		if v, ok := s.cache.Get(key); ok {
			if h, cast := v.([]repository.HistoryTender); cast {
				return h, nil
			}
		}
	}
	h, err := s.repo.LoadHistory(ctx, period)
	if err != nil {
		return nil, err
	}
	if s.cache != nil {
		s.cache.Set(key, h, s.ttl)
	}
	return h, nil
}

// Report — удельные показатели тендера против эталонов.
func (s *CostBenchmarkService) Report(ctx context.Context, tenderID string, period int) (*CostBenchmarkResponse, error) {
	if period == 0 {
		period = pricebenchmark.DefaultPeriodMonths
	}
	allowed := false
	for _, p := range pricebenchmark.AllowedPeriods {
		allowed = allowed || p == period
	}
	if !allowed {
		return nil, ErrCostBenchmarkBadPeriod
	}

	cur, err := s.repo.LoadCurrent(ctx, tenderID)
	if repository.IsNotFound(err) {
		return nil, ErrCostBenchmarkTenderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("costBenchmarkService.Report: %w", err)
	}
	hist, err := s.history(ctx, period)
	if err != nil {
		return nil, fmt.Errorf("costBenchmarkService.Report: история: %w", err)
	}
	ranges, err := s.repo.EngineRanges(ctx)
	if err != nil {
		return nil, fmt.Errorf("costBenchmarkService.Report: диапазоны: %w", err)
	}

	// Другие версии того же тендера в историю не идут: объект сравнивался бы сам с собой.
	obs := make([]costbenchmark.Observation, 0, 256)
	for _, h := range hist {
		if h.TenderNumber == cur.TenderNumber {
			continue
		}
		obs = append(obs, h.Observations...)
	}

	rep := costbenchmark.Evaluate(costbenchmark.Input{
		HousingClass:      cur.HousingClass,
		ConstructionScope: cur.ConstructionScope,
		AreaSP:            cur.AreaSP,
		CalculationReady:  cur.CalculationReady,
		Metrics:           cur.Metrics,
		Ranges:            ranges,
		History:           obs,
	})
	return &CostBenchmarkResponse{
		TenderID: tenderID, HousingClass: cur.HousingClass, ConstructionScope: cur.ConstructionScope,
		AreaSP: cur.AreaSP, PeriodMonths: period, Report: rep,
	}, nil
}

func (s *CostBenchmarkService) Ranges(ctx context.Context) ([]repository.BenchmarkRange, error) {
	return s.repo.ListActiveRanges(ctx)
}

func (s *CostBenchmarkService) CreateRange(ctx context.Context, in repository.BenchmarkRangeInput, actor *string) (string, error) {
	return s.repo.CreateRange(ctx, in, actor)
}

func (s *CostBenchmarkService) UpdateRange(ctx context.Context, id string, in repository.BenchmarkRangeInput, actor *string) error {
	return s.repo.UpdateRange(ctx, id, in, actor)
}

func (s *CostBenchmarkService) DeactivateRange(ctx context.Context, id string, actor *string) error {
	return s.repo.DeactivateRange(ctx, id, actor)
}

func (s *CostBenchmarkService) Brief(ctx context.Context, tenderID string) (*repository.TenderBrief, error) {
	return s.repo.GetBrief(ctx, tenderID)
}

func (s *CostBenchmarkService) SaveBrief(ctx context.Context, tenderID, summaryText string, factCategoryIDs []string, actor *string) (*repository.TenderBrief, error) {
	if err := s.repo.SaveBrief(ctx, tenderID, summaryText, factCategoryIDs, actor); err != nil {
		return nil, err
	}
	return s.repo.GetBrief(ctx, tenderID)
}
