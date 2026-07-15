package services

import (
	"context"
	"fmt"

	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	"github.com/su10/hubtender/backend/internal/repository"
)

type changeImpactLoader interface {
	LoadSnapshot(ctx context.Context, tenderID, baselineID string) (*repository.ChangeImpactSnapshot, error)
}

// ChangeImpactService — этап 1.5: read-only сравнение версий. Никаких
// мутаций/recalc/approval/queue; current и baseline читаются из одного
// REPEATABLE READ снапшота; fail-closed по финансовой готовности (§3).
type ChangeImpactService struct {
	repo changeImpactLoader
}

// NewChangeImpactService creates a ChangeImpactService.
func NewChangeImpactService(repo *repository.ChangeImpactRepo) *ChangeImpactService {
	return &ChangeImpactService{repo: repo}
}

// TenderChangeImpact строит полный отчёт (фильтры/пагинация — handler).
func (s *ChangeImpactService) TenderChangeImpact(
	ctx context.Context, tenderID, baselineID string,
) (*ci.Report, error) {
	snap, err := s.repo.LoadSnapshot(ctx, tenderID, baselineID)
	if err != nil {
		return nil, fmt.Errorf("changeImpactService: %w", err)
	}

	// §3: current обязан быть calculated + совпадающие ревизии — «последний
	// рассчитанный итог» stale-тендера не сравнивается как актуальный.
	curT := &snap.Current.Tender
	if curT.CalcStatus != "calculated" || curT.CalcRev != curT.InputRev {
		reason := "CALCULATION_STALE"
		switch curT.CalcStatus {
		case "calculating":
			reason = "CALCULATION_RUNNING"
		case "failed":
			reason = "CALCULATION_FAILED"
		case "calculated":
			reason = "REVISION_MISMATCH"
		}
		return nil, &repository.FinancialCalculationNotReadyError{
			TenderID: tenderID, CalculationStatus: curT.CalcStatus,
			InputRevision: curT.InputRev, CalculationRevision: curT.CalcRev,
			Reason: reason,
		}
	}

	if snap.Baseline == nil {
		// §2/§12: допустимого baseline нет — HTTP 200 с пустым контрактом.
		return ci.BaselineNotAvailableReport(snap.Current.Tender, snap.Candidates, snap.GeneratedAt), nil
	}
	return ci.Compare(snap.Current, *snap.Baseline, snap.Candidates, snap.GeneratedAt), nil
}
