package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// boqAuditRollbackRepoer is the interface BoqAuditRollbackService depends on.
type boqAuditRollbackRepoer interface {
	Rollback(ctx context.Context, auditID, changedBy string) (*repository.BoqAuditRollbackResult, error)
	ListByPosition(ctx context.Context, f repository.BoqAuditListFilter) ([]repository.BoqAuditRow, error)
}

// BoqAuditRollbackService rolls a BOQ item back to an audit snapshot's inputs
// (server-side, authoritative recalc in the repo transaction) and invalidates
// BOQ-derived cache — only after the repository committed successfully.
type BoqAuditRollbackService struct {
	repo  boqAuditRollbackRepoer
	cache *cache.InMem
}

// NewBoqAuditRollbackService creates a BoqAuditRollbackService.
func NewBoqAuditRollbackService(repo *repository.BoqAuditRollbackRepo, c *cache.InMem) *BoqAuditRollbackService {
	return &BoqAuditRollbackService{repo: repo, cache: c}
}

// Rollback restores user inputs from the audit record and clears tender list
// cache (the recalculated row affects aggregate totals across views). On any
// repository/domain error there are NO side effects: the cache stays intact and
// the error propagates with the domain error reachable via errors.As.
func (s *BoqAuditRollbackService) Rollback(ctx context.Context, auditID, changedBy string) (*repository.BoqAuditRollbackResult, error) {
	res, err := s.repo.Rollback(ctx, auditID, changedBy)
	if err != nil {
		return nil, fmt.Errorf("boqAuditRollbackService.Rollback: %w", err)
	}
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return res, nil
}

// ListByPosition is a thin passthrough for the audit history reader.
func (s *BoqAuditRollbackService) ListByPosition(
	ctx context.Context, f repository.BoqAuditListFilter,
) ([]repository.BoqAuditRow, error) {
	rows, err := s.repo.ListByPosition(ctx, f)
	if err != nil {
		return nil, fmt.Errorf("boqAuditRollbackService.ListByPosition: %w", err)
	}
	return rows, nil
}
