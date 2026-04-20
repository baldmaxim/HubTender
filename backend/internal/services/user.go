package services

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/domain/user"
	"github.com/su10/hubtender/backend/internal/repository"
)

const userCacheTTL = 30 * time.Second

// UserService orchestrates user-related business logic, adding an in-process
// cache layer in front of the database repository.
type UserService struct {
	repo  *repository.UserRepo
	cache *cache.InMem
}

// NewUserService creates a UserService with the given repository and cache.
func NewUserService(repo *repository.UserRepo, c *cache.InMem) *UserService {
	return &UserService{repo: repo, cache: c}
}

// GetMe returns the full user profile for the given UUID.
// The result is cached for userCacheTTL (30 s) to reduce DB pressure on
// frequent /me polling from the frontend.
func (s *UserService) GetMe(ctx context.Context, userID string) (*user.User, error) {
	cacheKey := "user:" + userID

	if cached, ok := s.cache.Get(cacheKey); ok {
		if u, ok := cached.(*user.User); ok {
			return u, nil
		}
	}

	u, err := s.repo.GetByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Preserve the sentinel so the handler can distinguish 404 from 500.
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("userService.GetMe: %w", err)
	}

	s.cache.Set(cacheKey, u, userCacheTTL)
	return u, nil
}

// InvalidateUser removes the cached profile for the given user ID.
// Call this after any write operation that modifies the user's profile
// (Phase 3+).
func (s *UserService) InvalidateUser(userID string) {
	s.cache.Delete("user:" + userID)
}
