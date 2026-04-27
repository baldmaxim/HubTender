package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ImportLogService is a thin wrapper around the import-log repo.
type ImportLogService struct {
	repo *repository.ImportLogRepo
}

// NewImportLogService creates an ImportLogService.
func NewImportLogService(repo *repository.ImportLogRepo) *ImportLogService {
	return &ImportLogService{repo: repo}
}

func (s *ImportLogService) ListSessions(ctx context.Context, tenderID string) ([]repository.ImportSessionRow, error) {
	return s.repo.ListSessions(ctx, tenderID)
}
func (s *ImportLogService) UsersByIDs(ctx context.Context, ids []string) ([]repository.ImportLogUserRow, error) {
	return s.repo.UsersByIDs(ctx, ids)
}
func (s *ImportLogService) TendersByIDs(ctx context.Context, ids []string) ([]repository.TenderShort, error) {
	return s.repo.TendersByIDs(ctx, ids)
}
func (s *ImportLogService) ListAllTendersForFilter(ctx context.Context) ([]repository.TenderShort, error) {
	return s.repo.ListAllTendersForFilter(ctx)
}
func (s *ImportLogService) CancelSession(ctx context.Context, sessionID, cancelledBy string) (*repository.CancelResult, error) {
	res, err := s.repo.CancelSession(ctx, sessionID, cancelledBy)
	if err != nil {
		return nil, fmt.Errorf("importLogService.CancelSession: %w", err)
	}
	return res, nil
}
