package services

import (
	"context"
	"fmt"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	"github.com/su10/hubtender/backend/internal/repository"
)

type priceBenchmarkLoader interface {
	LoadSnapshot(ctx context.Context, tenderID string, periodMonths int) (*repository.BenchmarkSnapshot, error)
}

// PriceBenchmarkService — read-only: snapshot → pure движок. Fail-closed:
// при неактуальном расчёте текущего тендера бенчмарк не строится (§8) —
// «последний рассчитанный итог» не выдаётся за текущую benchmark-цену.
type PriceBenchmarkService struct {
	repo priceBenchmarkLoader
}

// NewPriceBenchmarkService creates a PriceBenchmarkService.
func NewPriceBenchmarkService(repo *repository.PriceBenchmarkRepo) *PriceBenchmarkService {
	return &PriceBenchmarkService{repo: repo}
}

// TenderPriceBenchmarks строит полный отчёт (фильтры/пагинация — в handler).
func (s *PriceBenchmarkService) TenderPriceBenchmarks(
	ctx context.Context, tenderID string, periodMonths int,
) (*pb.Report, error) {
	snap, err := s.repo.LoadSnapshot(ctx, tenderID, periodMonths)
	if err != nil {
		return nil, fmt.Errorf("priceBenchmarkService: %w", err)
	}
	// §8: stale/calculating/failed/ревизии разошлись → 409 (существующий
	// typed-код FINANCIAL_CALCULATION_NOT_READY подходит без смены семантики).
	if snap.CalcStatus != "calculated" || snap.CalcRev != snap.InputRev {
		reason := "CALCULATION_STALE"
		switch snap.CalcStatus {
		case "calculating":
			reason = "CALCULATION_RUNNING"
		case "failed":
			reason = "CALCULATION_FAILED"
		case "calculated":
			reason = "REVISION_MISMATCH"
		}
		return nil, &repository.FinancialCalculationNotReadyError{
			TenderID:            tenderID,
			CalculationStatus:   snap.CalcStatus,
			InputRevision:       snap.InputRev,
			CalculationRevision: snap.CalcRev,
			Reason:              reason,
		}
	}
	return pb.Evaluate(tenderID, snap.InputRev, snap.CalcRev, snap.CalcStatus,
		periodMonths, snap.GeneratedAt, snap.Items, snap.Observations), nil
}

// ItemHistory — detail: observations по ключу конкретной строки (до limit).
// Организация одна (tenant scope отсутствует по аудиту §1) — исторические
// tender ID/label видимы любому авторизованному пользователю тендеров.
func (s *PriceBenchmarkService) ItemHistory(
	ctx context.Context, tenderID, boqItemID string, periodMonths, limit int,
) (*pb.ItemBenchmark, []pb.Observation, error) {
	snap, err := s.repo.LoadSnapshot(ctx, tenderID, periodMonths)
	if err != nil {
		return nil, nil, fmt.Errorf("priceBenchmarkService: %w", err)
	}
	if snap.CalcStatus != "calculated" || snap.CalcRev != snap.InputRev {
		return nil, nil, &repository.FinancialCalculationNotReadyError{
			TenderID: tenderID, CalculationStatus: snap.CalcStatus,
			InputRevision: snap.InputRev, CalculationRevision: snap.CalcRev,
			Reason: "CALCULATION_STALE",
		}
	}
	report := pb.Evaluate(tenderID, snap.InputRev, snap.CalcRev, snap.CalcStatus,
		periodMonths, snap.GeneratedAt, snap.Items, snap.Observations)
	var item *pb.ItemBenchmark
	for i := range report.Items {
		if report.Items[i].BoqItemID == boqItemID {
			item = &report.Items[i]
			break
		}
	}
	if item == nil {
		return nil, nil, repository.ErrQualityTenderNotFound // строка не найдена → 404
	}
	// Observations того же ключа (тот же helper — §3).
	var obs []pb.Observation
	for _, it := range snap.Items {
		if it.ID != boqItemID {
			continue
		}
		key, ok, _ := pb.BuildPriceBenchmarkKey(it.BoqItemType, it.NameID, it.UnitCode, it.HasParent)
		if ok {
			obs = append(obs, snap.Observations[key]...)
		}
		break
	}
	// Детерминированный порядок: свежие согласования сначала.
	sortObservations(obs)
	if limit > 0 && len(obs) > limit {
		obs = obs[:limit]
	}
	return item, obs, nil
}

func sortObservations(obs []pb.Observation) {
	for i := 1; i < len(obs); i++ { // insertion sort: списки короткие (≤ tenders)
		for j := i; j > 0; j-- {
			a, b := &obs[j-1], &obs[j]
			if a.ApprovedAt < b.ApprovedAt ||
				(a.ApprovedAt == b.ApprovedAt && a.TenderLabel > b.TenderLabel) {
				obs[j-1], obs[j] = obs[j], obs[j-1]
			} else {
				break
			}
		}
	}
}
