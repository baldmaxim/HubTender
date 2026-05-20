package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// boqAuditRollbackRepoer is the interface BoqAuditRollbackService depends on.
type boqAuditRollbackRepoer interface {
	RollbackDeleted(ctx context.Context, auditID string) (string, error)
	ListByPosition(ctx context.Context, f repository.BoqAuditListFilter) ([]repository.BoqAuditRow, error)
}

// BoqAuditRollbackService restores a deleted BOQ item from its audit row and
// invalidates BOQ-derived cache.
type BoqAuditRollbackService struct {
	repo  boqAuditRollbackRepoer
	cache *cache.InMem
}

// NewBoqAuditRollbackService creates a BoqAuditRollbackService.
func NewBoqAuditRollbackService(repo *repository.BoqAuditRollbackRepo, c *cache.InMem) *BoqAuditRollbackService {
	return &BoqAuditRollbackService{repo: repo, cache: c}
}

// RollbackDeleted re-inserts a DELETE'd BOQ item and clears tender list cache
// (the new row affects aggregate totals across views).
func (s *BoqAuditRollbackService) RollbackDeleted(ctx context.Context, auditID string) (string, error) {
	newID, err := s.repo.RollbackDeleted(ctx, auditID)
	if err != nil {
		return "", fmt.Errorf("boqAuditRollbackService.RollbackDeleted: %w", err)
	}
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return newID, nil
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
