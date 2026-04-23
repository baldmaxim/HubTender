package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// boqRepoer is the interface BoqService depends on.
type boqRepoer interface {
	ListBoqItems(ctx context.Context, tenderID, positionID string) ([]repository.BoqItemRow, error)
	GetBoqItemByID(ctx context.Context, id string) (*repository.BoqItemRow, error)
	CreateBoqItem(ctx context.Context, in repository.CreateBoqItemInput) (*repository.BoqItemRow, error)
	UpdateBoqItem(ctx context.Context, id string, in repository.UpdateBoqItemInput) (*repository.BoqItemRow, error)
	DeleteBoqItem(ctx context.Context, id, changedBy string) (*repository.BoqItemRow, error)
}

// BoqService provides access to boq_items data.
type BoqService struct {
	repo  boqRepoer
	cache *cache.InMem // reserved for future caching
}

// NewBoqService creates a BoqService.
func NewBoqService(repo *repository.BoqRepo, c *cache.InMem) *BoqService {
	return &BoqService{repo: repo, cache: c}
}

// ListBoqItems returns all BOQ items for the given position under a tender.
func (s *BoqService) ListBoqItems(
	ctx context.Context,
	tenderID, positionID string,
) ([]repository.BoqItemRow, error) {
	rows, err := s.repo.ListBoqItems(ctx, tenderID, positionID)
	if err != nil {
		return nil, fmt.Errorf("boqService.ListBoqItems: %w", err)
	}
	return rows, nil
}

// GetBoqItemByID fetches a single BOQ item by ID.
func (s *BoqService) GetBoqItemByID(ctx context.Context, id string) (*repository.BoqItemRow, error) {
	item, err := s.repo.GetBoqItemByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("boqService.GetBoqItemByID: %w", err)
	}
	return item, nil
}

// CreateBoqItem inserts a new BOQ item (with audit) and invalidates cache.
func (s *BoqService) CreateBoqItem(
	ctx context.Context,
	in repository.CreateBoqItemInput,
) (*repository.BoqItemRow, error) {
	item, err := s.repo.CreateBoqItem(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("boqService.CreateBoqItem: %w", err)
	}
	s.cache.Delete("tender:overview:" + item.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return item, nil
}

// UpdateBoqItem patches a BOQ item (with audit) and invalidates cache.
func (s *BoqService) UpdateBoqItem(
	ctx context.Context,
	id string,
	in repository.UpdateBoqItemInput,
) (*repository.BoqItemRow, error) {
	item, err := s.repo.UpdateBoqItem(ctx, id, in)
	if err != nil {
		return nil, fmt.Errorf("boqService.UpdateBoqItem: %w", err)
	}
	s.cache.Delete("tender:overview:" + item.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return item, nil
}

// DeleteBoqItem deletes a BOQ item (with audit) and invalidates cache.
// Returns the deleted row for the response body.
func (s *BoqService) DeleteBoqItem(
	ctx context.Context,
	id, changedBy string,
) (*repository.BoqItemRow, error) {
	item, err := s.repo.DeleteBoqItem(ctx, id, changedBy)
	if err != nil {
		return nil, fmt.Errorf("boqService.DeleteBoqItem: %w", err)
	}
	s.cache.Delete("tender:overview:" + item.TenderID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return item, nil
}
