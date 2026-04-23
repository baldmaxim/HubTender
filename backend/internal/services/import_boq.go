package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// importBoqRepoer is the interface ImportBoqService depends on.
type importBoqRepoer interface {
	BulkImport(ctx context.Context, in repository.ImportInput) (*repository.ImportResult, error)
}

// ImportBoqService delegates bulk BOQ import to the repository and
// invalidates the two affected cache keys on success.
type ImportBoqService struct {
	repo  importBoqRepoer
	cache *cache.InMem
}

// NewImportBoqService creates an ImportBoqService.
func NewImportBoqService(repo *repository.ImportRepo, c *cache.InMem) *ImportBoqService {
	return &ImportBoqService{repo: repo, cache: c}
}

// BulkImport delegates to the repository and, on success, evicts
// tender:overview:<tenderID> and positions:with_costs:<tenderID> from cache,
// matching the pattern used by BulkBoqService.BulkUpdateCommercial.
func (s *ImportBoqService) BulkImport(
	ctx context.Context,
	in repository.ImportInput,
) (*repository.ImportResult, error) {
	result, err := s.repo.BulkImport(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("importBoqService.BulkImport: %w", err)
	}

	s.cache.Delete("tender:overview:" + in.TenderID)
	s.cache.Delete("positions:with_costs:" + in.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)

	return result, nil
}
