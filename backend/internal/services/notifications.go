package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// NotificationsService is a thin wrapper around the repo.
type NotificationsService struct {
	repo *repository.NotificationsRepo
}

// NewNotificationsService creates a NotificationsService.
func NewNotificationsService(repo *repository.NotificationsRepo) *NotificationsService {
	return &NotificationsService{repo: repo}
}

func (s *NotificationsService) Create(ctx context.Context, in repository.NotificationInput) error {
	if err := s.repo.Insert(ctx, in); err != nil {
		return fmt.Errorf("notificationsService.Create: %w", err)
	}
	return nil
}

func (s *NotificationsService) List(ctx context.Context, limit int) ([]repository.NotificationRow, error) {
	rows, err := s.repo.List(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("notificationsService.List: %w", err)
	}
	return rows, nil
}

func (s *NotificationsService) DeleteAll(ctx context.Context) error {
	if err := s.repo.DeleteAll(ctx); err != nil {
		return fmt.Errorf("notificationsService.DeleteAll: %w", err)
	}
	return nil
}
