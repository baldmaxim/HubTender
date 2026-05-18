package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// taskManagerRoles mirrors canManageUsers() (src/lib/supabase/types.ts):
// 'Администратор'/'Руководитель'/'Разработчик' → role_codes.
var taskManagerRoles = map[string]bool{
	"administrator": true,
	"director":      true,
	"developer":     true,
}

// tasksRepoer is the interface TasksService depends on.
type tasksRepoer interface {
	ListByUser(ctx context.Context, userID string, excludeCompleted bool) ([]repository.UserTaskWithRelations, error)
	ListAll(ctx context.Context) ([]repository.UserTaskWithRelations, error)
	Create(ctx context.Context, userID string, tenderID *string, description string) (string, error)
	UpdateStatus(ctx context.Context, id string, taskStatus, completedAt *string) error
	GetWorkSettings(ctx context.Context, userID string) (*repository.WorkSettings, error)
	SetWorkSettings(ctx context.Context, userID string, mode, status *string) error
	CallerRole(ctx context.Context, userID string) (string, error)
}

// TasksService handles user_tasks + per-user work settings.
type TasksService struct {
	repo tasksRepoer
}

// NewTasksService creates a TasksService.
func NewTasksService(repo *repository.TasksRepo) *TasksService {
	return &TasksService{repo: repo}
}

// ListByUser returns one user's tasks.
func (s *TasksService) ListByUser(ctx context.Context, userID string, excludeCompleted bool) ([]repository.UserTaskWithRelations, error) {
	t, err := s.repo.ListByUser(ctx, userID, excludeCompleted)
	if err != nil {
		return nil, fmt.Errorf("tasksService.ListByUser: %w", err)
	}
	return t, nil
}

// ListAll returns every task — only for manager roles (decided from DB role,
// not a client flag). Returns ErrForbidden otherwise.
func (s *TasksService) ListAll(ctx context.Context, callerID string) ([]repository.UserTaskWithRelations, error) {
	role, err := s.repo.CallerRole(ctx, callerID)
	if err != nil {
		return nil, fmt.Errorf("tasksService.ListAll: role: %w", err)
	}
	if !taskManagerRoles[role] {
		return nil, ErrForbidden
	}
	t, err := s.repo.ListAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("tasksService.ListAll: %w", err)
	}
	return t, nil
}

// Create inserts a task.
func (s *TasksService) Create(ctx context.Context, userID string, tenderID *string, description string) (string, error) {
	id, err := s.repo.Create(ctx, userID, tenderID, description)
	if err != nil {
		return "", fmt.Errorf("tasksService.Create: %w", err)
	}
	return id, nil
}

// UpdateStatus applies status/completed_at.
func (s *TasksService) UpdateStatus(ctx context.Context, id string, taskStatus, completedAt *string) error {
	if err := s.repo.UpdateStatus(ctx, id, taskStatus, completedAt); err != nil {
		return fmt.Errorf("tasksService.UpdateStatus: %w", err)
	}
	return nil
}

// GetWorkSettings returns a user's work mode/status.
func (s *TasksService) GetWorkSettings(ctx context.Context, userID string) (*repository.WorkSettings, error) {
	ws, err := s.repo.GetWorkSettings(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("tasksService.GetWorkSettings: %w", err)
	}
	return ws, nil
}

// SetWorkSettings updates a user's work mode/status.
func (s *TasksService) SetWorkSettings(ctx context.Context, userID string, mode, status *string) error {
	if err := s.repo.SetWorkSettings(ctx, userID, mode, status); err != nil {
		return fmt.Errorf("tasksService.SetWorkSettings: %w", err)
	}
	return nil
}
