package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// SubcontractService provides subcontract_growth_exclusions mutations.
type SubcontractService struct {
	repo   *repository.SubcontractRepo
	cache  *cache.InMem
	recalc Enqueuer
}

// NewSubcontractService creates a SubcontractService.
func NewSubcontractService(repo *repository.SubcontractRepo, c *cache.InMem) *SubcontractService {
	return &SubcontractService{repo: repo, cache: c}
}

// WithRecalcQueue wires the commercial-recalc queue so toggling a subcontract
// growth exclusion auto-triggers a server-side recalc.
func (s *SubcontractService) WithRecalcQueue(q Enqueuer) *SubcontractService {
	s.recalc = q
	return s
}

// ToggleExclusion delegates to the repo and invalidates tender overview
// cache (grand total may change because of subcontract growth logic).
func (s *SubcontractService) ToggleExclusion(
	ctx context.Context,
	tenderID, detailCategoryID, exclusionType string,
) (bool, error) {
	added, err := s.repo.ToggleExclusion(ctx, tenderID, detailCategoryID, exclusionType)
	if err != nil {
		return false, fmt.Errorf("subcontractService.ToggleExclusion: %w", err)
	}
	s.cache.Delete("tender:overview:" + tenderID)
	s.cache.Delete("positions:with_costs:" + tenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	if s.recalc != nil {
		s.recalc.Enqueue(tenderID)
	}
	return added, nil
}
