package services

import (
	"context"
	"fmt"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	rp "github.com/su10/hubtender/backend/internal/analytics/reviewpack"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

type reviewPackLoader interface {
	LoadSnapshot(ctx context.Context, tenderID string, periodMonths int, baselineID string) (*repository.ReviewPackSnapshot, error)
}

// ReviewPackService — этап 1.6: read-only сборка «Отчёта для проверки» из
// одного снапшота + ГОТОВЫХ pure-движков этапов 1.1-1.5. Никаких мутаций,
// recalc, approval и повторного расчёта денег; XLSX строится ТОЛЬКО из
// готовой immutable-модели ПОСЛЕ закрытия транзакции чтения (§3).
type ReviewPackService struct {
	repo reviewPackLoader
}

// NewReviewPackService creates a ReviewPackService.
func NewReviewPackService(repo *repository.ReviewPackRepo) *ReviewPackService {
	return &ReviewPackService{repo: repo}
}

// TenderReviewModel строит модель отчёта (JSON preview и вход renderer'а).
func (s *ReviewPackService) TenderReviewModel(
	ctx context.Context, tenderID string, periodMonths, maxAgeDays int, baselineID string,
) (*rp.Model, error) {
	snap, err := s.repo.LoadSnapshot(ctx, tenderID, periodMonths, baselineID)
	if err != nil {
		return nil, fmt.Errorf("reviewPackService: %w", err)
	}

	// §3: gate готовности — старые денежные значения не выдаются за отчёт.
	src := snap.Source
	if src.CalcStatus != "calculated" || src.CalcRev != src.InputRev {
		reason := "CALCULATION_STALE"
		switch src.CalcStatus {
		case "calculating":
			reason = "CALCULATION_RUNNING"
		case "failed":
			reason = "CALCULATION_FAILED"
		case "calculated":
			reason = "REVISION_MISMATCH"
		}
		return nil, &repository.FinancialCalculationNotReadyError{
			TenderID: tenderID, CalculationStatus: src.CalcStatus,
			InputRevision: src.InputRev, CalculationRevision: src.CalcRev,
			Reason: reason,
		}
	}

	// Готовые pure-движки (никаких новых формул).
	qReport := quality.Evaluate(snap.Quality)
	sReport := ps.Evaluate(tenderID, src.InputRev, src.CalcRev, src.CalcStatus,
		src.GeneratedAt, src.AsOfDate, maxAgeDays, ps.DefaultExpiringSoonDays, src.Items)
	bReport := pb.Evaluate(tenderID, snap.Benchmark.InputRev, snap.Benchmark.CalcRev,
		snap.Benchmark.CalcStatus, periodMonths, snap.Benchmark.GeneratedAt,
		snap.Benchmark.Items, snap.Benchmark.Observations)

	items := make([]ap.ItemInfo, 0, len(src.Items))
	for _, it := range src.Items {
		items = append(items, ap.ItemInfo{
			ID: it.ID, ClientPositionID: it.ClientPositionID,
			SortIndex: it.SortIndex, TotalAmount: it.TotalAmount,
		})
	}
	planReport := ap.Compose(ap.Inputs{
		TenderID: tenderID, InputRev: src.InputRev, CalcRev: src.CalcRev,
		CalcStatus: src.CalcStatus, GeneratedAt: src.GeneratedAt, AsOfDate: src.AsOfDate,
		PeriodMonths: periodMonths, MaxAgeDays: maxAgeDays,
		Quality: qReport, Benchmark: bReport, Source: sReport, Items: items,
	})

	var ciReport *ci.Report
	if snap.ChangeImpact.Baseline == nil {
		ciReport = ci.BaselineNotAvailableReport(snap.ChangeImpact.Current.Tender,
			snap.ChangeImpact.Candidates, snap.ChangeImpact.GeneratedAt)
	} else {
		ciReport = ci.Compare(snap.ChangeImpact.Current, *snap.ChangeImpact.Baseline,
			snap.ChangeImpact.Candidates, snap.ChangeImpact.GeneratedAt)
	}

	baselineTenderID, baselineVersion := "", 0
	if ciReport.Baseline != nil {
		baselineTenderID = ciReport.Baseline.TenderID
		baselineVersion = ciReport.Baseline.Version
	}
	md := rp.Metadata{
		TenderID:               tenderID,
		TenderNumber:           snap.TenderNumber,
		TenderVersion:          snap.TenderVersion,
		TenderLabel:            snap.TenderLabel,
		FinancialInputRevision: src.InputRev,
		FinancialCalcRevision:  src.CalcRev,
		FinancialCalcStatus:    src.CalcStatus,
		FinancialApproved:      snap.Approved,
		ApprovedByLabel:        snap.ApprovedByLabel,
		ApprovedAt:             snap.ApprovedAt,
		GeneratedAt:            src.GeneratedAt,
		AsOfDate:               src.AsOfDate,
		BenchmarkPeriodMonths:  periodMonths,
		SourceMaxAgeDays:       maxAgeDays,
		BaselineTenderID:       baselineTenderID,
		BaselineVersion:        baselineVersion,
		CachedGrandTotal:       ciReport.Current.CachedGrandTotal,
		ReportFingerprint: rp.Fingerprint(tenderID, src.InputRev, rp.ReportSchemaVersion,
			periodMonths, maxAgeDays, baselineTenderID, src.AsOfDate),
	}

	return rp.Build(rp.Inputs{
		Metadata: md, Quality: qReport, ActionPlan: planReport,
		Benchmark: bReport, Source: sReport, ChangeImpact: ciReport,
	}), nil
}

// TenderReviewXLSX — файл из готовой модели (транзакция уже закрыта).
func (s *ReviewPackService) TenderReviewXLSX(
	ctx context.Context, tenderID string, periodMonths, maxAgeDays int, baselineID string,
) ([]byte, string, error) {
	model, err := s.TenderReviewModel(ctx, tenderID, periodMonths, maxAgeDays, baselineID)
	if err != nil {
		return nil, "", err
	}
	data, err := rp.Render(model)
	if err != nil {
		return nil, "", fmt.Errorf("reviewPackService: render: %w", err)
	}
	filename := rp.SafeFilename("Tender", model.Metadata.TenderNumber,
		fmt.Sprintf("v%d", model.Metadata.TenderVersion), "Review", model.Metadata.AsOfDate)
	return data, filename, nil
}
