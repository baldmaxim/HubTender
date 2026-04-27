package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// UserAdminService wraps the user-admin repo with cache invalidation.
// User profile / role mutations clear the per-user cache used by GetMe so
// the next /api/v1/me call reflects the change immediately.
type UserAdminService struct {
	repo  *repository.UserAdminRepo
	cache *cache.InMem
}

// NewUserAdminService creates a UserAdminService.
func NewUserAdminService(repo *repository.UserAdminRepo, c *cache.InMem) *UserAdminService {
	return &UserAdminService{repo: repo, cache: c}
}

func (s *UserAdminService) invalidateUser(userID string) {
	s.cache.Delete("user:" + userID)
	s.cache.Delete("user:permissions:" + userID)
}

func (s *UserAdminService) ListTendersForUserAccess(ctx context.Context) ([]repository.TenderForAccessRow, error) {
	return s.repo.ListTendersForUserAccess(ctx)
}

func (s *UserAdminService) ListPendingUsers(ctx context.Context) ([]repository.PendingUserRow, error) {
	return s.repo.ListPendingUsers(ctx)
}
func (s *UserAdminService) ListAllUsers(ctx context.Context) ([]repository.AdminUserRow, error) {
	return s.repo.ListAllUsers(ctx)
}

func (s *UserAdminService) ApproveUser(ctx context.Context, id string, in repository.ApproveInput) error {
	if err := s.repo.ApproveUser(ctx, id, in); err != nil {
		return fmt.Errorf("userAdminService.ApproveUser: %w", err)
	}
	s.invalidateUser(id)
	return nil
}

func (s *UserAdminService) DeleteUser(ctx context.Context, id string) error {
	if err := s.repo.DeleteUser(ctx, id); err != nil {
		return fmt.Errorf("userAdminService.DeleteUser: %w", err)
	}
	s.invalidateUser(id)
	return nil
}

func (s *UserAdminService) SetUserAccessEnabled(ctx context.Context, id string, enabled bool) error {
	if err := s.repo.SetUserAccessEnabled(ctx, id, enabled); err != nil {
		return fmt.Errorf("userAdminService.SetUserAccessEnabled: %w", err)
	}
	s.invalidateUser(id)
	return nil
}

func (s *UserAdminService) UpdateUserProfile(ctx context.Context, id string, in repository.UpdateUserProfileInput) error {
	if err := s.repo.UpdateUserProfile(ctx, id, in); err != nil {
		return fmt.Errorf("userAdminService.UpdateUserProfile: %w", err)
	}
	s.invalidateUser(id)
	return nil
}

func (s *UserAdminService) SyncUsersAllowedPagesByRole(ctx context.Context, roleCode string, pages []string) error {
	if err := s.repo.SyncUsersAllowedPagesByRole(ctx, roleCode, pages); err != nil {
		return fmt.Errorf("userAdminService.SyncUsersAllowedPagesByRole: %w", err)
	}
	// Cache for individual users is keyed by id — clear the whole user prefix.
	s.cache.DeleteByPrefix("user:")
	return nil
}

func (s *UserAdminService) CountUsersWithRole(ctx context.Context, roleCode string) (int, error) {
	return s.repo.CountUsersWithRole(ctx, roleCode)
}

func (s *UserAdminService) ListRoles(ctx context.Context) ([]repository.AdminRoleRow, error) {
	return s.repo.ListRoles(ctx)
}
func (s *UserAdminService) FindRoleByCode(ctx context.Context, code string) (*repository.AdminRoleRow, error) {
	return s.repo.FindRoleByCode(ctx, code)
}
func (s *UserAdminService) FindRoleByName(ctx context.Context, name string) (*repository.AdminRoleRow, error) {
	return s.repo.FindRoleByName(ctx, name)
}

func (s *UserAdminService) CreateRole(ctx context.Context, in repository.RoleInput) (*repository.AdminRoleRow, error) {
	row, err := s.repo.CreateRole(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("userAdminService.CreateRole: %w", err)
	}
	s.cache.DeleteByPrefix("ref:roles")
	return row, nil
}

func (s *UserAdminService) UpdateRoleAllowedPages(ctx context.Context, code string, pages []string) error {
	if err := s.repo.UpdateRoleAllowedPages(ctx, code, pages); err != nil {
		return fmt.Errorf("userAdminService.UpdateRoleAllowedPages: %w", err)
	}
	s.cache.DeleteByPrefix("ref:roles")
	s.cache.DeleteByPrefix("user:")
	return nil
}

func (s *UserAdminService) DeleteRole(ctx context.Context, code string) error {
	if err := s.repo.DeleteRole(ctx, code); err != nil {
		return fmt.Errorf("userAdminService.DeleteRole: %w", err)
	}
	s.cache.DeleteByPrefix("ref:roles")
	return nil
}
