package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ProjectsService is a thin wrapper around the projects repo.
type ProjectsService struct {
	repo *repository.ProjectsRepo
}

// NewProjectsService creates a ProjectsService.
func NewProjectsService(repo *repository.ProjectsRepo) *ProjectsService {
	return &ProjectsService{repo: repo}
}

func (s *ProjectsService) Create(ctx context.Context, in repository.ProjectInsert) error {
	if err := s.repo.Create(ctx, in); err != nil {
		return fmt.Errorf("projectsService.Create: %w", err)
	}
	return nil
}

func (s *ProjectsService) Update(ctx context.Context, id string, in repository.ProjectInsert) error {
	if err := s.repo.Update(ctx, id, in); err != nil {
		return fmt.Errorf("projectsService.Update: %w", err)
	}
	return nil
}

func (s *ProjectsService) SoftDelete(ctx context.Context, id string) error {
	if err := s.repo.SoftDelete(ctx, id); err != nil {
		return fmt.Errorf("projectsService.SoftDelete: %w", err)
	}
	return nil
}

func (s *ProjectsService) ListActiveTendersForSelect(ctx context.Context) ([]repository.ProjectTenderRow, error) {
	return s.repo.ListActiveTendersForSelect(ctx)
}

func (s *ProjectsService) ListAgreements(ctx context.Context, projectID string, asc bool) ([]repository.AgreementRow, error) {
	return s.repo.ListAgreements(ctx, projectID, asc)
}

func (s *ProjectsService) CreateAgreement(ctx context.Context, in repository.AgreementInput) error {
	if err := s.repo.CreateAgreement(ctx, in); err != nil {
		return fmt.Errorf("projectsService.CreateAgreement: %w", err)
	}
	return nil
}

func (s *ProjectsService) UpdateAgreement(ctx context.Context, id string, p repository.AgreementPatch) error {
	if err := s.repo.UpdateAgreement(ctx, id, p); err != nil {
		return fmt.Errorf("projectsService.UpdateAgreement: %w", err)
	}
	return nil
}

func (s *ProjectsService) DeleteAgreement(ctx context.Context, id string) error {
	if err := s.repo.DeleteAgreement(ctx, id); err != nil {
		return fmt.Errorf("projectsService.DeleteAgreement: %w", err)
	}
	return nil
}

func (s *ProjectsService) CreateMonthlyCompletion(ctx context.Context, in repository.MonthlyCompletionInput) error {
	if err := s.repo.CreateMonthlyCompletion(ctx, in); err != nil {
		return fmt.Errorf("projectsService.CreateMonthlyCompletion: %w", err)
	}
	return nil
}

func (s *ProjectsService) UpdateMonthlyCompletion(ctx context.Context, id string, p repository.MonthlyCompletionPatch) error {
	if err := s.repo.UpdateMonthlyCompletion(ctx, id, p); err != nil {
		return fmt.Errorf("projectsService.UpdateMonthlyCompletion: %w", err)
	}
	return nil
}
