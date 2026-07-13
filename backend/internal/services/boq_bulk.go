package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// bulkBoqRepoer is the interface BulkBoqService depends on.
//
// Stage 0.1.2.2: this interface deliberately has NO commercial-cost writer.
// Commercial costs are calculation results; the only way to persist them is the
// internal, tender-scoped BulkBoqRepo.PersistCalculatedCommercialCosts, which is
// driven solely by CommercialRecalcService. Keeping a commercial writer reachable
// from a client-facing handler's service would re-open the retired bypass.
type bulkBoqRepoer interface {
	SetQuoteLinkByName(ctx context.Context, tenderID, field, value string, quoteLink *string, changedBy string) (int, error)
	SetQuoteLinkByIDs(ctx context.Context, ids []string, quoteLink *string, changedBy string) (int, error)
}

// BulkBoqService handles bulk quote-link updates. It can NOT write commercial costs.
type BulkBoqService struct {
	repo  bulkBoqRepoer
	cache *cache.InMem
}

// NewBulkBoqService creates a BulkBoqService.
func NewBulkBoqService(repo *repository.BulkBoqRepo, c *cache.InMem) *BulkBoqService {
	return &BulkBoqService{repo: repo, cache: c}
}

// SetQuoteLinkByName sets quote_link for tender items matching a name field.
func (s *BulkBoqService) SetQuoteLinkByName(
	ctx context.Context,
	tenderID, field, value string,
	quoteLink *string,
	changedBy string,
) (int, error) {
	n, err := s.repo.SetQuoteLinkByName(ctx, tenderID, field, value, quoteLink, changedBy)
	if err != nil {
		return 0, fmt.Errorf("bulkBoqService.SetQuoteLinkByName: %w", err)
	}
	return n, nil
}

// SetQuoteLinkByIDs sets quote_link for the given boq_item ids.
func (s *BulkBoqService) SetQuoteLinkByIDs(
	ctx context.Context,
	ids []string,
	quoteLink *string,
	changedBy string,
) (int, error) {
	n, err := s.repo.SetQuoteLinkByIDs(ctx, ids, quoteLink, changedBy)
	if err != nil {
		return 0, fmt.Errorf("bulkBoqService.SetQuoteLinkByIDs: %w", err)
	}
	return n, nil
}
