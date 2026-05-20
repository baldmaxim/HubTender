package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/su10/hubtender/backend/internal/access"
	"github.com/su10/hubtender/backend/internal/domain/user"
)

// UserRepo handles database access for the users domain.
type UserRepo struct {
	pool *pgxpool.Pool
}

// NewUserRepo creates a UserRepo backed by the given connection pool.
func NewUserRepo(pool *pgxpool.Pool) *UserRepo {
	return &UserRepo{pool: pool}
}

const getUserByIDQuery = `
SELECT
    u.id,
    u.email,
    u.role_code,
    COALESCE(r.name,  '')  AS role_name,
    COALESCE(r.color, '')  AS role_color,
    COALESCE(u.access_status::text, '') AS access_status,
    u.allowed_pages,
    COALESCE(u.access_enabled, false)   AS access_enabled
FROM public.users u
LEFT JOIN public.roles r ON r.code = u.role_code
WHERE u.id = $1
`

// SetAccessStatus sets users.access_status for the self-service re-apply
// flow (called from Login when an authed-but-rejected user re-submits).
func (r *UserRepo) SetAccessStatus(ctx context.Context, userID, status string) error {
	_, err := r.pool.Exec(ctx,
		`UPDATE public.users SET access_status = $1, updated_at = NOW() WHERE id = $2`,
		status, userID,
	)
	if err != nil {
		return fmt.Errorf("userRepo.SetAccessStatus: %w", err)
	}
	return nil
}

// GetByID fetches a user by their UUID, joining in the role data.
// Returns (nil, pgx.ErrNoRows) if the user does not exist in public.users.
func (r *UserRepo) GetByID(ctx context.Context, userID string) (*user.User, error) {
	row := r.pool.QueryRow(ctx, getUserByIDQuery, userID)

	var (
		id            string
		email         string
		roleCode      string
		roleName      string
		roleColor     string
		accessStatus  string
		allowedPages  []byte // JSONB column scanned as raw bytes
		accessEnabled bool
	)

	err := row.Scan(
		&id,
		&email,
		&roleCode,
		&roleName,
		&roleColor,
		&accessStatus,
		&allowedPages,
		&accessEnabled,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("userRepo.GetByID: scan: %w", err)
	}

	// Compute allowed pages using the access registry logic.
	pages := access.GetAllowedPages(roleCode, allowedPages)

	return &user.User{
		ID:            id,
		Email:         email,
		RoleCode:      roleCode,
		RoleName:      roleName,
		RoleColor:     roleColor,
		AccessStatus:  accessStatus,
		AllowedPages:  pages,
		AccessEnabled: accessEnabled,
	}, nil
}

// GetDeadlineExtensions returns the raw tender_deadline_extensions JSONB
// (defaults to []) for the given user.
func (r *UserRepo) GetDeadlineExtensions(ctx context.Context, userID string) (json.RawMessage, error) {
	var raw json.RawMessage
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE(tender_deadline_extensions, '[]'::jsonb)
		   FROM public.users WHERE id = $1`,
		userID,
	).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("userRepo.GetDeadlineExtensions: %w", err)
	}
	return raw, nil
}

