package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// UserAdminRepo handles users + roles admin CRUD consumed by Users.tsx.
type UserAdminRepo struct {
	pool *pgxpool.Pool
}

// NewUserAdminRepo creates a UserAdminRepo.
func NewUserAdminRepo(pool *pgxpool.Pool) *UserAdminRepo {
	return &UserAdminRepo{pool: pool}
}

// ─── Tenders for the TenderAccess tab ───────────────────────────────────────

type TenderForAccessRow struct {
	ID           string `json:"id"`
	TenderNumber string `json:"tender_number"`
	Title        string `json:"title"`
	Version      int    `json:"version"`
}

func (r *UserAdminRepo) ListTendersForUserAccess(ctx context.Context) ([]TenderForAccessRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text,
		       COALESCE(tender_number, ''),
		       COALESCE(title, ''),
		       COALESCE(version, 1)
		FROM public.tenders
		ORDER BY submission_deadline DESC NULLS LAST
	`)
	if err != nil {
		return nil, fmt.Errorf("userAdminRepo.ListTendersForUserAccess: %w", err)
	}
	defer rows.Close()
	out := make([]TenderForAccessRow, 0)
	for rows.Next() {
		var t TenderForAccessRow
		if err := rows.Scan(&t.ID, &t.TenderNumber, &t.Title, &t.Version); err != nil {
			return nil, fmt.Errorf("userAdminRepo.ListTendersForUserAccess scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ─── Users ──────────────────────────────────────────────────────────────────

// PendingUserRow mirrors the projection Users.tsx expects for pending requests.
type PendingUserRow struct {
	ID               string  `json:"id"`
	FullName         string  `json:"full_name"`
	Email            string  `json:"email"`
	RoleCode         string  `json:"role_code"`
	RegistrationDate *string `json:"registration_date,omitempty"`
	Roles            *struct {
		Name  string  `json:"name"`
		Color *string `json:"color,omitempty"`
	} `json:"roles,omitempty"`
}

func (r *UserAdminRepo) ListPendingUsers(ctx context.Context) ([]PendingUserRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id::text, u.full_name, u.email, u.role_code,
		       to_char(u.registration_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       r.name, r.color
		FROM public.users u
		LEFT JOIN public.roles r ON r.code = u.role_code
		WHERE u.access_status = 'pending'
		ORDER BY u.registration_date DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("userAdminRepo.ListPendingUsers: %w", err)
	}
	defer rows.Close()
	out := make([]PendingUserRow, 0)
	for rows.Next() {
		var (
			rec       PendingUserRow
			roleName  *string
			roleColor *string
		)
		if err := rows.Scan(&rec.ID, &rec.FullName, &rec.Email, &rec.RoleCode,
			&rec.RegistrationDate, &roleName, &roleColor); err != nil {
			return nil, fmt.Errorf("userAdminRepo.ListPendingUsers scan: %w", err)
		}
		if roleName != nil {
			rec.Roles = &struct {
				Name  string  `json:"name"`
				Color *string `json:"color,omitempty"`
			}{Name: *roleName, Color: roleColor}
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// AdminUserRow mirrors the projection used by Users.tsx for the full user list.
type AdminUserRow struct {
	ID               string   `json:"id"`
	FullName         string   `json:"full_name"`
	Email            string   `json:"email"`
	RoleCode         string   `json:"role_code"`
	AccessStatus     string   `json:"access_status"`
	AllowedPages     []string `json:"allowed_pages"`
	RegistrationDate *string  `json:"registration_date,omitempty"`
	ApprovedBy       *string  `json:"approved_by,omitempty"`
	ApprovedAt       *string  `json:"approved_at,omitempty"`
	Password         *string  `json:"password,omitempty"`
	AccessEnabled    bool     `json:"access_enabled"`
	Roles            *struct {
		Name  string  `json:"name"`
		Color *string `json:"color,omitempty"`
	} `json:"roles,omitempty"`
}

func (r *UserAdminRepo) ListAllUsers(ctx context.Context) ([]AdminUserRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT u.id::text, u.full_name, u.email, u.role_code,
		       u.access_status, COALESCE(u.allowed_pages::text, '[]'),
		       to_char(u.registration_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       u.approved_by::text,
		       to_char(u.approved_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       u.password,
		       u.access_enabled,
		       r.name, r.color
		FROM public.users u
		LEFT JOIN public.roles r ON r.code = u.role_code
		ORDER BY u.registration_date DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("userAdminRepo.ListAllUsers: %w", err)
	}
	defer rows.Close()
	out := make([]AdminUserRow, 0)
	for rows.Next() {
		var (
			rec       AdminUserRow
			pagesRaw  string
			roleName  *string
			roleColor *string
		)
		if err := rows.Scan(&rec.ID, &rec.FullName, &rec.Email, &rec.RoleCode,
			&rec.AccessStatus, &pagesRaw,
			&rec.RegistrationDate, &rec.ApprovedBy, &rec.ApprovedAt,
			&rec.Password, &rec.AccessEnabled,
			&roleName, &roleColor); err != nil {
			return nil, fmt.Errorf("userAdminRepo.ListAllUsers scan: %w", err)
		}
		rec.AllowedPages = parseJSONStringArray(pagesRaw)
		if roleName != nil {
			rec.Roles = &struct {
				Name  string  `json:"name"`
				Color *string `json:"color,omitempty"`
			}{Name: *roleName, Color: roleColor}
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// ApproveInput captures the patch applied when an admin approves a user.
type ApproveInput struct {
	ApprovedBy   string   `json:"approved_by"`
	RoleCode     string   `json:"role_code"`
	AllowedPages []string `json:"allowed_pages"`
}

func (r *UserAdminRepo) ApproveUser(ctx context.Context, userID string, in ApproveInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.users
		SET access_status = 'approved',
		    approved_by   = $1::uuid,
		    approved_at   = NOW(),
		    role_code     = $2,
		    allowed_pages = $3::jsonb
		WHERE id = $4
	`, in.ApprovedBy, in.RoleCode, allowedPagesJSON(in.AllowedPages), userID)
	if err != nil {
		return fmt.Errorf("userAdminRepo.ApproveUser: %w", err)
	}
	return nil
}

func (r *UserAdminRepo) DeleteUser(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("userAdminRepo.DeleteUser: %w", err)
	}
	return nil
}

func (r *UserAdminRepo) SetUserAccessEnabled(ctx context.Context, id string, enabled bool) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.users SET access_enabled = $1 WHERE id = $2
	`, enabled, id)
	if err != nil {
		return fmt.Errorf("userAdminRepo.SetUserAccessEnabled: %w", err)
	}
	return nil
}

type UpdateUserProfileInput struct {
	FullName     *string  `json:"full_name"`
	Email        *string  `json:"email"`
	RoleCode     *string  `json:"role_code"`
	AllowedPages []string `json:"allowed_pages"`
}

func (r *UserAdminRepo) UpdateUserProfile(ctx context.Context, id string, in UpdateUserProfileInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.users
		SET full_name     = COALESCE($1, full_name),
		    email         = COALESCE($2, email),
		    role_code     = COALESCE($3, role_code),
		    allowed_pages = COALESCE($4::jsonb, allowed_pages)
		WHERE id = $5
	`, in.FullName, in.Email, in.RoleCode, allowedPagesJSON(in.AllowedPages), id)
	if err != nil {
		return fmt.Errorf("userAdminRepo.UpdateUserProfile: %w", err)
	}
	return nil
}

func (r *UserAdminRepo) SyncUsersAllowedPagesByRole(ctx context.Context, roleCode string, pages []string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.users SET allowed_pages = $1::jsonb WHERE role_code = $2
	`, allowedPagesJSON(pages), roleCode)
	if err != nil {
		return fmt.Errorf("userAdminRepo.SyncUsersAllowedPagesByRole: %w", err)
	}
	return nil
}

func (r *UserAdminRepo) CountUsersWithRole(ctx context.Context, roleCode string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM public.users WHERE role_code = $1
	`, roleCode).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("userAdminRepo.CountUsersWithRole: %w", err)
	}
	return n, nil
}

// ─── Roles ──────────────────────────────────────────────────────────────────

type AdminRoleRow struct {
	Code         string   `json:"code"`
	Name         string   `json:"name"`
	AllowedPages []string `json:"allowed_pages"`
	IsSystemRole bool     `json:"is_system_role"`
	Color        *string  `json:"color,omitempty"`
	CreatedAt    *string  `json:"created_at,omitempty"`
	UpdatedAt    *string  `json:"updated_at,omitempty"`
}

const adminRoleSelect = `
	SELECT code, name, COALESCE(allowed_pages::text, '[]'),
	       COALESCE(is_system_role, false), color,
	       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	FROM public.roles
`

func scanAdminRole(scanner interface{ Scan(...any) error }) (AdminRoleRow, error) {
	var (
		row      AdminRoleRow
		pagesRaw string
	)
	err := scanner.Scan(&row.Code, &row.Name, &pagesRaw, &row.IsSystemRole,
		&row.Color, &row.CreatedAt, &row.UpdatedAt)
	if err == nil {
		row.AllowedPages = parseJSONStringArray(pagesRaw)
	}
	return row, err
}

func (r *UserAdminRepo) ListRoles(ctx context.Context) ([]AdminRoleRow, error) {
	rows, err := r.pool.Query(ctx, adminRoleSelect+" ORDER BY name")
	if err != nil {
		return nil, fmt.Errorf("userAdminRepo.ListRoles: %w", err)
	}
	defer rows.Close()
	out := make([]AdminRoleRow, 0)
	for rows.Next() {
		row, err := scanAdminRole(rows)
		if err != nil {
			return nil, fmt.Errorf("userAdminRepo.ListRoles scan: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (r *UserAdminRepo) FindRoleByCode(ctx context.Context, code string) (*AdminRoleRow, error) {
	row, err := scanAdminRole(r.pool.QueryRow(ctx, adminRoleSelect+" WHERE code = $1", code))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("userAdminRepo.FindRoleByCode: %w", err)
	}
	return &row, nil
}

func (r *UserAdminRepo) FindRoleByName(ctx context.Context, name string) (*AdminRoleRow, error) {
	row, err := scanAdminRole(r.pool.QueryRow(ctx, adminRoleSelect+" WHERE name = $1", name))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("userAdminRepo.FindRoleByName: %w", err)
	}
	return &row, nil
}

type RoleInput struct {
	Code  string `json:"code"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (r *UserAdminRepo) CreateRole(ctx context.Context, in RoleInput) (*AdminRoleRow, error) {
	row, err := scanAdminRole(r.pool.QueryRow(ctx, `
		INSERT INTO public.roles (code, name, color)
		VALUES ($1, $2, $3)
		RETURNING code, name, COALESCE(allowed_pages::text, '[]'),
		          COALESCE(is_system_role, false), color,
		          to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		          to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	`, in.Code, in.Name, in.Color))
	if err != nil {
		return nil, fmt.Errorf("userAdminRepo.CreateRole: %w", err)
	}
	return &row, nil
}

func (r *UserAdminRepo) UpdateRoleAllowedPages(ctx context.Context, code string, pages []string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.roles
		SET allowed_pages = $1::jsonb, updated_at = NOW()
		WHERE code = $2
	`, allowedPagesJSON(pages), code)
	if err != nil {
		return fmt.Errorf("userAdminRepo.UpdateRoleAllowedPages: %w", err)
	}
	return nil
}

func (r *UserAdminRepo) DeleteRole(ctx context.Context, code string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.roles WHERE code = $1`, code)
	if err != nil {
		return fmt.Errorf("userAdminRepo.DeleteRole: %w", err)
	}
	return nil
}

// allowedPagesJSON serialises a string slice into the JSONB representation
// stored in users.allowed_pages / roles.allowed_pages. Nil → JSON null so
// COALESCE preserves the existing column on partial UPDATEs.
func allowedPagesJSON(pages []string) any {
	if pages == nil {
		return nil
	}
	bytes, err := json.Marshal(pages)
	if err != nil {
		return "[]"
	}
	return string(bytes)
}
