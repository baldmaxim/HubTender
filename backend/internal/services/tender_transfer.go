package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// transferRepoer is the interface TransferService depends on.
type transferRepoer interface {
	ExecuteVersionTransfer(
		ctx context.Context,
		in repository.TransferInput,
	) (*repository.TransferResult, error)
}

// TransferService delegates version-transfer to the repository and
// invalidates affected cache keys on success.
type TransferService struct {
	repo  transferRepoer
	cache *cache.InMem
}

// NewTransferService creates a TransferService.
func NewTransferService(repo *repository.TransferRepo, c *cache.InMem) *TransferService {
	return &TransferService{repo: repo, cache: c}
}

// ExecuteVersionTransfer runs the full version-transfer inside a single
// transaction, then evicts the cache keys that may now be stale:
//   - tender:overview:<newTenderID>  — the target tender reloads fresh
//   - tenders:list:*                 — list results across all users are stale
func (s *TransferService) ExecuteVersionTransfer(
	ctx context.Context,
	in repository.TransferInput,
) (*repository.TransferResult, error) {
	result, err := s.repo.ExecuteVersionTransfer(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("transferService.ExecuteVersionTransfer: %w", err)
	}

	s.cache.Delete("tender:overview:" + result.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)

	return result, nil
}
