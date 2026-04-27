package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// TenderRegistryService is a thin wrapper around the repo. The data is small
// enough that we don't bother with caching here.
type TenderRegistryService struct {
	repo *repository.TenderRegistryRepo
}

// NewTenderRegistryService creates a TenderRegistryService.
func NewTenderRegistryService(repo *repository.TenderRegistryRepo) *TenderRegistryService {
	return &TenderRegistryService{repo: repo}
}

func (s *TenderRegistryService) List(ctx context.Context) ([]repository.TenderRegistryRow, error) {
	rows, err := s.repo.List(ctx)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryService.List: %w", err)
	}
	return rows, nil
}

func (s *TenderRegistryService) NextSortOrder(ctx context.Context) (int, error) {
	n, err := s.repo.NextSortOrder(ctx)
	if err != nil {
		return 0, fmt.Errorf("tenderRegistryService.NextSortOrder: %w", err)
	}
	return n, nil
}

func (s *TenderRegistryService) Autocomplete(ctx context.Context) ([]repository.AutocompleteRow, error) {
	rows, err := s.repo.Autocomplete(ctx)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryService.Autocomplete: %w", err)
	}
	return rows, nil
}

func (s *TenderRegistryService) Create(ctx context.Context, in repository.TenderRegistryCreateInput) error {
	if err := s.repo.Create(ctx, in); err != nil {
		return fmt.Errorf("tenderRegistryService.Create: %w", err)
	}
	return nil
}

func (s *TenderRegistryService) Update(ctx context.Context, id string, in repository.TenderRegistryUpdateInput) error {
	if err := s.repo.Update(ctx, id, in); err != nil {
		return fmt.Errorf("tenderRegistryService.Update: %w", err)
	}
	return nil
}

func (s *TenderRegistryService) ListTenderStatuses(ctx context.Context) ([]repository.NamedRefRow, error) {
	rows, err := s.repo.ListTenderStatuses(ctx)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryService.ListTenderStatuses: %w", err)
	}
	return rows, nil
}

func (s *TenderRegistryService) ListConstructionScopes(ctx context.Context) ([]repository.NamedRefRow, error) {
	rows, err := s.repo.ListConstructionScopes(ctx)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryService.ListConstructionScopes: %w", err)
	}
	return rows, nil
}

func (s *TenderRegistryService) TenderNumbers(ctx context.Context) ([]string, error) {
	rows, err := s.repo.TenderNumbers(ctx)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryService.TenderNumbers: %w", err)
	}
	return rows, nil
}

func (s *TenderRegistryService) RelatedTendersByNumbers(ctx context.Context, numbers []string) ([]repository.RelatedTenderRow, error) {
	rows, err := s.repo.RelatedTendersByNumbers(ctx, numbers)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryService.RelatedTendersByNumbers: %w", err)
	}
	return rows, nil
}
