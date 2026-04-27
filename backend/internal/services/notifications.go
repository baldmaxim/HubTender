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
