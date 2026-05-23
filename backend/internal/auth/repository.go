package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/su10/hubtender/backend/internal/access"
)

// Repository is the pgx-backed persistence layer for the app-auth package.
// Pure data access; no business logic, no hashing, no token minting.
type Repository struct {
	pool *pgxpool.Pool
}

// NewRepository wires a Repository to the given pool.
func NewRepository(pool *pgxpool.Pool) *Repository {
	return &Repository{pool: pool}
}

// ---------------------------------------------------------------------------
// auth.users / public.users reads
// ---------------------------------------------------------------------------

// GetAuthUserByEmail looks up the auth.users bridge row by case-insensitive
// email. Returns (nil, ErrInvalidCredentials) when no row matches — the
// caller has no business knowing whether the email was wrong or whether the
// password verification would fail.
func (r *Repository) GetAuthUserByEmail(ctx context.Context, email string) (*AuthUserRow, error) {
	const q = `
SELECT id::text, COALESCE(email,''), COALESCE(encrypted_password,'')
FROM auth.users
WHERE LOWER(email) = LOWER($1)
LIMIT 1
`
	var row AuthUserRow
	err := r.pool.QueryRow(ctx, q, email).Scan(&row.ID, &row.Email, &row.EncryptedPassword)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidCredentials
		}
		return nil, fmt.Errorf("authRepo.GetAuthUserByEmail: %w", err)
	}
	return &row, nil
}

// GetAuthUserByID returns the auth.users row for a known user id. Used by
// Refresh / Me to surface the current email in the access-token claim and
// the user payload even though both endpoints don't know the email up front.
func (r *Repository) GetAuthUserByID(ctx context.Context, userID string) (*AuthUserRow, error) {
	const q = `
SELECT id::text, COALESCE(email,''), COALESCE(encrypted_password,'')
FROM auth.users
WHERE id = $1::uuid
LIMIT 1
`
	var row AuthUserRow
	err := r.pool.QueryRow(ctx, q, userID).Scan(&row.ID, &row.Email, &row.EncryptedPassword)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAccountMissing
		}
		return nil, fmt.Errorf("authRepo.GetAuthUserByID: %w", err)
	}
	return &row, nil
}

// GetPublicUserByID returns the public.users + roles projection needed to
// build the login response payload (full_name, role_code, access_status,
// access_enabled, allowed_pages — same shape as the existing /me handler).
//
// Returns (nil, ErrAccountMissing) if auth.users had a row but public.users
// does not — a half-provisioned state. Login refuses such accounts.
func (r *Repository) GetPublicUserByID(ctx context.Context, userID string) (*PublicUserRow, error) {
	const q = `
SELECT
    u.id::text,
    COALESCE(u.full_name, '') AS full_name,
    u.role_code,
    COALESCE(u.access_status::text, '') AS access_status,
    COALESCE(u.access_enabled, false) AS access_enabled,
    u.allowed_pages
FROM public.users u
WHERE u.id = $1
LIMIT 1
`
	var (
		id            string
		fullName      string
		roleCode      string
		accessStatus  string
		accessEnabled bool
		allowedPages  []byte
	)
	err := r.pool.QueryRow(ctx, q, userID).Scan(&id, &fullName, &roleCode, &accessStatus, &accessEnabled, &allowedPages)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAccountMissing
		}
		return nil, fmt.Errorf("authRepo.GetPublicUserByID: %w", err)
	}
	return &PublicUserRow{
		ID:            id,
		FullName:      fullName,
		RoleCode:      roleCode,
		AccessStatus:  accessStatus,
		AccessEnabled: accessEnabled,
		AllowedPages:  access.GetAllowedPages(roleCode, allowedPages),
	}, nil
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// RegisterInput carries the values RegisterUser writes. password_hash MUST
// be a bcrypt $2a$10$… string produced by auth.HashPassword (we never
// accept a plaintext password at the repository layer).
type RegisterInput struct {
	Email        string
	PasswordHash string
	FullName     string
}

// RegisterResultDB is the DB-side outcome of RegisterUser. AccessStatus
// is computed inside the transaction (first-privileged-user → approved;
// otherwise pending) — so the caller learns whether an admin notification
// was fanned out.
type RegisterResultDB struct {
	UserID       string
	AccessStatus string
}

// RegisterUser provisions a brand-new user in a single transaction:
//
//  1. duplicate-email guard against auth.users (LOWER comparison).
//  2. INSERT auth.users — id (uuid), email, encrypted_password,
//     email_confirmed_at=NOW(). Token / change string columns rely on
//     their schema-level DEFAULTs (”), see db/yandex/sql/01_auth_compat….
//  3. allowed_pages = roles.allowed_pages for the pinned 'engineer' role
//     (server-side; client cannot override).
//  4. first-user check + privileged-role check (mirrors legacy
//     repository/user_register.go).
//  5. INSERT public.users — pending by default, approved iff first user is
//     somehow being created with a privileged role (kept for parity, but
//     the new endpoint pins role_code='engineer', so this branch will only
//     fire if an operator changes the pinned role later).
//  6. INSERT public.notifications fan-out to admins (when access_status=pending).
//
// Returns ErrEmailAlreadyExists on duplicate — handler maps to 409.
func (r *Repository) RegisterUser(ctx context.Context, in RegisterInput) (*RegisterResultDB, error) {
	const roleCode = "engineer" // pinned server-side — no privilege escalation via the public sign-up form

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("authRepo.RegisterUser: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// 1. Duplicate guard.
	var existingID *string
	if err := tx.QueryRow(ctx,
		`SELECT id::text FROM auth.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
		in.Email,
	).Scan(&existingID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("authRepo.RegisterUser: dup check: %w", err)
	}
	if existingID != nil {
		return nil, ErrEmailAlreadyExists
	}

	// 2. INSERT auth.users — generate uuid via gen_random_uuid().
	var userID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
		VALUES (gen_random_uuid(), $1, $2, NOW(), '{}'::jsonb, '{}'::jsonb)
		RETURNING id::text
	`, in.Email, in.PasswordHash).Scan(&userID); err != nil {
		return nil, fmt.Errorf("authRepo.RegisterUser: insert auth.users: %w", err)
	}

	// 3. allowed_pages from role default; fall back to '[]'.
	var pages []byte
	if err := tx.QueryRow(ctx,
		`SELECT allowed_pages FROM public.roles WHERE code = $1`,
		roleCode,
	).Scan(&pages); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("authRepo.RegisterUser: role pages: %w", err)
		}
		pages = []byte(`[]`)
	}
	if len(pages) == 0 {
		pages = []byte(`[]`)
	}

	// 4. First-user check.
	var isFirstUser bool
	if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM public.users LIMIT 1)`).Scan(&isFirstUser); err != nil {
		return nil, fmt.Errorf("authRepo.RegisterUser: first-user check: %w", err)
	}
	privileged := roleCode == "administrator" || roleCode == "director" || roleCode == "developer"
	approved := isFirstUser && privileged

	// 5. INSERT public.users.
	accessStatus := "pending"
	if approved {
		accessStatus = "approved"
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.users (id, full_name, email, role_code, access_status, allowed_pages, approved_by, approved_at)
			VALUES ($1::uuid, $2, $3, $4, 'approved', $5, $1::uuid, NOW())
		`, userID, in.FullName, in.Email, roleCode, pages); err != nil {
			return nil, fmt.Errorf("authRepo.RegisterUser: insert public.users (approved): %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.users (id, full_name, email, role_code, access_status, allowed_pages)
			VALUES ($1::uuid, $2, $3, $4, 'pending', $5)
		`, userID, in.FullName, in.Email, roleCode, pages); err != nil {
			return nil, fmt.Errorf("authRepo.RegisterUser: insert public.users (pending): %w", err)
		}
	}

	// 6. Admin notification (only when pending — same shape as legacy
	//    register flow, so the existing admin UI keeps working unchanged).
	if !approved {
		title := "Новый запрос на регистрацию"
		msg := fmt.Sprintf("%s (%s) запросил доступ к системе", in.FullName, in.Email)
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.notifications
			    (type, title, message, related_entity_type, related_entity_id, is_read)
			VALUES ('pending', $1, $2, 'registration_request', $3::uuid, false)
		`, title, msg, userID); err != nil {
			return nil, fmt.Errorf("authRepo.RegisterUser: notify: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("authRepo.RegisterUser: commit: %w", err)
	}
	return &RegisterResultDB{UserID: userID, AccessStatus: accessStatus}, nil
}

// ---------------------------------------------------------------------------
// refresh_tokens
// ---------------------------------------------------------------------------

// InsertRefreshToken writes a new refresh-token row. tokenFamilyID groups
// rotation chains; pass uuid.Nil-equivalent ("") to mint a fresh family
// (used at login time — see Service.Login). Returns the assigned id.
//
// userAgent / ipAddress are best-effort; empty strings store SQL NULL.
func (r *Repository) InsertRefreshToken(
	ctx context.Context,
	userID, tokenHash, tokenFamilyID string,
	issuedAt, expiresAt time.Time,
	sess SessionContext,
) (string, error) {
	const q = `
INSERT INTO app_auth.refresh_tokens
    (user_id, token_hash, token_family_id, issued_at, expires_at, user_agent, ip_address)
VALUES
    ($1::uuid, $2, $3::uuid, $4, $5, NULLIF($6,''), NULLIF($7,'')::inet)
RETURNING id::text
`
	var id string
	err := r.pool.QueryRow(ctx, q,
		userID,
		tokenHash,
		tokenFamilyID,
		issuedAt,
		expiresAt,
		sess.UserAgent,
		sess.IPAddress,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("authRepo.InsertRefreshToken: %w", err)
	}
	return id, nil
}

// FindRefreshTokenByHash returns the row whose token_hash matches. Returns
// ErrRefreshNotFound if no match — leaks no information about whether the
// hash was ever issued.
func (r *Repository) FindRefreshTokenByHash(ctx context.Context, tokenHash string) (*RefreshTokenRow, error) {
	const q = `
SELECT
    id::text,
    user_id::text,
    token_hash,
    token_family_id::text,
    issued_at,
    expires_at,
    revoked_at,
    replaced_by::text
FROM app_auth.refresh_tokens
WHERE token_hash = $1
LIMIT 1
`
	var (
		row         RefreshTokenRow
		revokedAt   *time.Time
		replacedBy  *string
		replacedRaw *string // separate sentinel since pgx scans uuid::text NULL into *string
	)
	err := r.pool.QueryRow(ctx, q, tokenHash).Scan(
		&row.ID,
		&row.UserID,
		&row.TokenHash,
		&row.TokenFamilyID,
		&row.IssuedAt,
		&row.ExpiresAt,
		&revokedAt,
		&replacedRaw,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrRefreshNotFound
		}
		return nil, fmt.Errorf("authRepo.FindRefreshTokenByHash: %w", err)
	}
	row.RevokedAt = revokedAt
	if replacedRaw != nil && *replacedRaw != "" {
		v := *replacedRaw
		replacedBy = &v
	}
	row.ReplacedBy = replacedBy
	return &row, nil
}

// RevokeRefreshToken sets revoked_at = now() for a single row. Idempotent —
// safe to call on an already-revoked token (no rows updated, no error).
func (r *Repository) RevokeRefreshToken(ctx context.Context, id string) error {
	const q = `
UPDATE app_auth.refresh_tokens
SET revoked_at = now()
WHERE id = $1::uuid AND revoked_at IS NULL
`
	if _, err := r.pool.Exec(ctx, q, id); err != nil {
		return fmt.Errorf("authRepo.RevokeRefreshToken: %w", err)
	}
	return nil
}

// RevokeTokenFamily revokes every NON-revoked row in a family in one round
// trip. Used by reuse detection — if any rotated-chain token is re-presented,
// the whole family is compromised.
func (r *Repository) RevokeTokenFamily(ctx context.Context, familyID string) error {
	const q = `
UPDATE app_auth.refresh_tokens
SET revoked_at = now()
WHERE token_family_id = $1::uuid AND revoked_at IS NULL
`
	if _, err := r.pool.Exec(ctx, q, familyID); err != nil {
		return fmt.Errorf("authRepo.RevokeTokenFamily: %w", err)
	}
	return nil
}

// RotateRefreshToken atomically:
//  1. Marks the old row revoked_at = now(), replaced_by = new.id.
//  2. Inserts the new row with the same token_family_id.
//
// Runs in a single pgx.Tx so reuse-detection lookups in another request
// cannot see a half-rotated state. Returns the id of the newly inserted row.
func (r *Repository) RotateRefreshToken(
	ctx context.Context,
	oldID, userID, newTokenHash, tokenFamilyID string,
	issuedAt, expiresAt time.Time,
	sess SessionContext,
) (string, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("authRepo.RotateRefreshToken: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const insertNew = `
INSERT INTO app_auth.refresh_tokens
    (user_id, token_hash, token_family_id, issued_at, expires_at, user_agent, ip_address)
VALUES
    ($1::uuid, $2, $3::uuid, $4, $5, NULLIF($6,''), NULLIF($7,'')::inet)
RETURNING id::text
`
	var newID string
	if err := tx.QueryRow(ctx, insertNew,
		userID, newTokenHash, tokenFamilyID, issuedAt, expiresAt,
		sess.UserAgent, sess.IPAddress,
	).Scan(&newID); err != nil {
		return "", fmt.Errorf("authRepo.RotateRefreshToken: insert: %w", err)
	}

	const revokeOld = `
UPDATE app_auth.refresh_tokens
SET revoked_at = now(), replaced_by = $2::uuid
WHERE id = $1::uuid AND revoked_at IS NULL
`
	if _, err := tx.Exec(ctx, revokeOld, oldID, newID); err != nil {
		return "", fmt.Errorf("authRepo.RotateRefreshToken: revoke: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("authRepo.RotateRefreshToken: commit: %w", err)
	}
	return newID, nil
}

// ---------------------------------------------------------------------------
// password_reset_tokens
// ---------------------------------------------------------------------------

// LookupAuthUserIDByEmail returns the auth.users.id for the given case-
// insensitive email, or ("", false, nil) when not found. Used by the
// /forgot-password flow — distinct from GetAuthUserByEmail (which maps
// "not found" to ErrInvalidCredentials, suitable for login but not for
// the anti-enumeration forgot flow that must NEVER differentiate).
func (r *Repository) LookupAuthUserIDByEmail(ctx context.Context, email string) (string, bool, error) {
	var id string
	err := r.pool.QueryRow(ctx,
		`SELECT id::text FROM auth.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
		email,
	).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("authRepo.LookupAuthUserIDByEmail: %w", err)
	}
	return id, true, nil
}

// InsertResetToken writes a new password-reset row. token_hash is SHA-256
// of the plaintext (caller hashes via HashRefreshToken / equivalent). The
// plaintext token leaves the issuer-response path only and is NEVER persisted.
func (r *Repository) InsertResetToken(
	ctx context.Context,
	userID, tokenHash string,
	requestedAt, expiresAt time.Time,
	sess SessionContext,
) (string, error) {
	const q = `
INSERT INTO app_auth.password_reset_tokens
    (user_id, token_hash, requested_at, expires_at, user_agent, ip_address)
VALUES
    ($1::uuid, $2, $3, $4, NULLIF($5,''), NULLIF($6,'')::inet)
RETURNING id::text
`
	var id string
	err := r.pool.QueryRow(ctx, q,
		userID, tokenHash, requestedAt, expiresAt,
		sess.UserAgent, sess.IPAddress,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("authRepo.InsertResetToken: %w", err)
	}
	return id, nil
}

// FindResetTokenByHash returns the row whose token_hash matches. Returns
// ErrResetTokenNotFound on miss — the service then maps that to a generic
// 401 on the wire.
func (r *Repository) FindResetTokenByHash(ctx context.Context, tokenHash string) (*ResetTokenRow, error) {
	const q = `
SELECT id::text, user_id::text, token_hash, requested_at, expires_at, used_at
FROM app_auth.password_reset_tokens
WHERE token_hash = $1
LIMIT 1
`
	var (
		row    ResetTokenRow
		usedAt *time.Time
	)
	err := r.pool.QueryRow(ctx, q, tokenHash).Scan(
		&row.ID, &row.UserID, &row.TokenHash, &row.RequestedAt, &row.ExpiresAt, &usedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrResetTokenNotFound
		}
		return nil, fmt.Errorf("authRepo.FindResetTokenByHash: %w", err)
	}
	row.UsedAt = usedAt
	return &row, nil
}

// MarkResetTokenUsed flips used_at = now() on the matching row. Single-use
// enforcement happens at the service layer (FindResetTokenByHash returns
// the row; service checks UsedAt != nil and rejects with ErrResetTokenUsed
// BEFORE calling this).
func (r *Repository) MarkResetTokenUsed(ctx context.Context, id string) error {
	const q = `
UPDATE app_auth.password_reset_tokens
SET used_at = now()
WHERE id = $1::uuid AND used_at IS NULL
`
	if _, err := r.pool.Exec(ctx, q, id); err != nil {
		return fmt.Errorf("authRepo.MarkResetTokenUsed: %w", err)
	}
	return nil
}

// UpdateEncryptedPassword swaps auth.users.encrypted_password and updates
// updated_at. Caller MUST pass a bcrypt hash already produced by
// auth.HashPassword (we never accept plaintext at the repo layer).
func (r *Repository) UpdateEncryptedPassword(ctx context.Context, userID, passwordHash string) error {
	const q = `
UPDATE auth.users
SET encrypted_password = $2, updated_at = now()
WHERE id = $1::uuid
`
	if _, err := r.pool.Exec(ctx, q, userID, passwordHash); err != nil {
		return fmt.Errorf("authRepo.UpdateEncryptedPassword: %w", err)
	}
	return nil
}

// RevokeAllUserRefreshTokens marks every non-revoked refresh token of a
// given user as revoked. Called after a successful password reset / change
// so any previously-issued session is immediately invalidated and the
// user must re-login.
func (r *Repository) RevokeAllUserRefreshTokens(ctx context.Context, userID string) error {
	const q = `
UPDATE app_auth.refresh_tokens
SET revoked_at = now()
WHERE user_id = $1::uuid AND revoked_at IS NULL
`
	if _, err := r.pool.Exec(ctx, q, userID); err != nil {
		return fmt.Errorf("authRepo.RevokeAllUserRefreshTokens: %w", err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// auth_events
// ---------------------------------------------------------------------------

// LogAuthEvent appends to app_auth.auth_events. Non-fatal: callers log the
// error but do NOT fail the auth operation if event-recording fails.
//
// metadata is marshalled to JSON; pass nil for an empty object. The schema
// constraint guarantees plaintext tokens / passwords MUST never be passed in
// here — the call sites in service.go obey this.
func (r *Repository) LogAuthEvent(
	ctx context.Context,
	userID, eventType string,
	sess SessionContext,
	metadata map[string]any,
) error {
	var meta []byte
	if metadata != nil {
		b, err := json.Marshal(metadata)
		if err != nil {
			return fmt.Errorf("authRepo.LogAuthEvent: marshal metadata: %w", err)
		}
		meta = b
	} else {
		meta = []byte(`{}`)
	}

	const q = `
INSERT INTO app_auth.auth_events
    (user_id, event_type, ip_address, user_agent, metadata)
VALUES
    (NULLIF($1,'')::uuid, $2, NULLIF($3,'')::inet, NULLIF($4,''), $5::jsonb)
`
	if _, err := r.pool.Exec(ctx, q, userID, eventType, sess.IPAddress, sess.UserAgent, meta); err != nil {
		return fmt.Errorf("authRepo.LogAuthEvent: %w", err)
	}
	return nil
}
