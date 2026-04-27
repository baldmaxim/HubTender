package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// MarkupService wraps the markup repo with cache invalidation. Tactic /
// percentage / pricing changes affect tender overview totals so we drop the
// per-tender overview cache in those flows.
type MarkupService struct {
	repo  *repository.MarkupRepo
	cache *cache.InMem
}

// NewMarkupService creates a MarkupService.
func NewMarkupService(repo *repository.MarkupRepo, c *cache.InMem) *MarkupService {
	return &MarkupService{repo: repo, cache: c}
}

func (s *MarkupService) invalidateTender(tenderID string) {
	s.cache.Delete("tender:overview:" + tenderID)
	s.cache.Delete("positions:with_costs:" + tenderID)
}

// Tactics.
func (s *MarkupService) ListTactics(ctx context.Context) ([]repository.MarkupTacticRow, error) {
	return s.repo.ListTactics(ctx)
}
func (s *MarkupService) GetTactic(ctx context.Context, id string) (*repository.MarkupTacticRow, error) {
	return s.repo.GetTactic(ctx, id)
}
func (s *MarkupService) FindGlobalTacticByName(ctx context.Context, name string) (*repository.MarkupTacticRow, error) {
	return s.repo.FindGlobalTacticByName(ctx, name)
}
func (s *MarkupService) CreateTactic(ctx context.Context, in repository.MarkupTacticInput) (*repository.MarkupTacticRow, error) {
	row, err := s.repo.CreateTactic(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("markupService.CreateTactic: %w", err)
	}
	return row, nil
}
func (s *MarkupService) UpdateTactic(ctx context.Context, id string, p repository.MarkupTacticPatch) error {
	if err := s.repo.UpdateTactic(ctx, id, p); err != nil {
		return fmt.Errorf("markupService.UpdateTactic: %w", err)
	}
	return nil
}
func (s *MarkupService) RenameTactic(ctx context.Context, id, name string) error {
	if err := s.repo.RenameTactic(ctx, id, name); err != nil {
		return fmt.Errorf("markupService.RenameTactic: %w", err)
	}
	return nil
}
func (s *MarkupService) DeleteTactic(ctx context.Context, id string) error {
	if err := s.repo.DeleteTactic(ctx, id); err != nil {
		return fmt.Errorf("markupService.DeleteTactic: %w", err)
	}
	return nil
}

// Parameters.
func (s *MarkupService) ListActiveParameters(ctx context.Context) ([]repository.MarkupParameterRow, error) {
	return s.repo.ListActiveParameters(ctx)
}
func (s *MarkupService) CreateParameter(ctx context.Context, in repository.MarkupParameterInput) error {
	if err := s.repo.CreateParameter(ctx, in); err != nil {
		return fmt.Errorf("markupService.CreateParameter: %w", err)
	}
	return nil
}
func (s *MarkupService) UpdateParameter(ctx context.Context, id string, p repository.MarkupParameterPatch) error {
	if err := s.repo.UpdateParameter(ctx, id, p); err != nil {
		return fmt.Errorf("markupService.UpdateParameter: %w", err)
	}
	return nil
}
func (s *MarkupService) DeleteParameter(ctx context.Context, id string) error {
	if err := s.repo.DeleteParameter(ctx, id); err != nil {
		return fmt.Errorf("markupService.DeleteParameter: %w", err)
	}
	return nil
}
func (s *MarkupService) SetParameterOrderNum(ctx context.Context, id string, orderNum int) error {
	if err := s.repo.SetParameterOrderNum(ctx, id, orderNum); err != nil {
		return fmt.Errorf("markupService.SetParameterOrderNum: %w", err)
	}
	return nil
}

// Tender ↔ tactic linkage.
func (s *MarkupService) GetTenderTacticID(ctx context.Context, tenderID string) (*string, error) {
	return s.repo.GetTenderTacticID(ctx, tenderID)
}
func (s *MarkupService) SetTenderTacticID(ctx context.Context, tenderID, tacticID string) error {
	if err := s.repo.SetTenderTacticID(ctx, tenderID, tacticID); err != nil {
		return fmt.Errorf("markupService.SetTenderTacticID: %w", err)
	}
	s.invalidateTender(tenderID)
	return nil
}

// tender_markup_percentage.
func (s *MarkupService) ListTenderMarkupPercentages(ctx context.Context, tenderID string) ([]repository.TenderMarkupPctRow, error) {
	return s.repo.ListTenderMarkupPercentages(ctx, tenderID)
}
func (s *MarkupService) ReplaceTenderMarkupPercentages(ctx context.Context, tenderID string, records []repository.TenderMarkupPctInput) error {
	if err := s.repo.ReplaceTenderMarkupPercentages(ctx, tenderID, records); err != nil {
		return fmt.Errorf("markupService.ReplaceTenderMarkupPercentages: %w", err)
	}
	s.invalidateTender(tenderID)
	return nil
}

// tender_pricing_distribution.
func (s *MarkupService) GetPricingDistribution(ctx context.Context, tenderID string) (*repository.PricingDistributionRow, error) {
	return s.repo.GetPricingDistribution(ctx, tenderID)
}
func (s *MarkupService) UpsertPricingDistribution(ctx context.Context, in repository.PricingDistributionInput) (*repository.PricingDistributionRow, error) {
	row, err := s.repo.UpsertPricingDistribution(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("markupService.UpsertPricingDistribution: %w", err)
	}
	s.invalidateTender(in.TenderID)
	return row, nil
}

// subcontract_growth_exclusions.
func (s *MarkupService) ListSubcontractExclusions(ctx context.Context, tenderID string) ([]repository.SubcontractExclusionRow, error) {
	return s.repo.ListSubcontractExclusions(ctx, tenderID)
}
func (s *MarkupService) InsertSubcontractExclusion(ctx context.Context, in repository.SubcontractExclusionInput) error {
	if err := s.repo.InsertSubcontractExclusion(ctx, in); err != nil {
		return fmt.Errorf("markupService.InsertSubcontractExclusion: %w", err)
	}
	s.invalidateTender(in.TenderID)
	return nil
}
func (s *MarkupService) InsertSubcontractExclusionsBatch(ctx context.Context, rows []repository.SubcontractExclusionInput) error {
	if err := s.repo.InsertSubcontractExclusionsBatch(ctx, rows); err != nil {
		return fmt.Errorf("markupService.InsertSubcontractExclusionsBatch: %w", err)
	}
	if len(rows) > 0 {
		s.invalidateTender(rows[0].TenderID)
	}
	return nil
}
func (s *MarkupService) DeleteSubcontractExclusion(ctx context.Context, in repository.SubcontractExclusionInput) error {
	if err := s.repo.DeleteSubcontractExclusion(ctx, in); err != nil {
		return fmt.Errorf("markupService.DeleteSubcontractExclusion: %w", err)
	}
	s.invalidateTender(in.TenderID)
	return nil
}
func (s *MarkupService) DeleteSubcontractExclusionsBatch(ctx context.Context, tenderID string, ids []string, exclusionType string) error {
	if err := s.repo.DeleteSubcontractExclusionsBatch(ctx, tenderID, ids, exclusionType); err != nil {
		return fmt.Errorf("markupService.DeleteSubcontractExclusionsBatch: %w", err)
	}
	s.invalidateTender(tenderID)
	return nil
}
