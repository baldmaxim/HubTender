package repository

import (
	"context"
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
