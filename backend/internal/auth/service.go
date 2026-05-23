package auth

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

// repo is the slice of Repository methods Service actually needs. Carved
// out as an interface so handler / service tests can swap in a fake.
type repo interface {
	GetAuthUserByEmail(ctx context.Context, email string) (*AuthUserRow, error)
	GetAuthUserByID(ctx context.Context, userID string) (*AuthUserRow, error)
	GetPublicUserByID(ctx context.Context, userID string) (*PublicUserRow, error)
	InsertRefreshToken(ctx context.Context, userID, tokenHash, tokenFamilyID string, issuedAt, expiresAt time.Time, sess SessionContext) (string, error)
	FindRefreshTokenByHash(ctx context.Context, tokenHash string) (*RefreshTokenRow, error)
	RevokeRefreshToken(ctx context.Context, id string) error
	RevokeTokenFamily(ctx context.Context, familyID string) error
	RotateRefreshToken(ctx context.Context, oldID, userID, newTokenHash, tokenFamilyID string, issuedAt, expiresAt time.Time, sess SessionContext) (string, error)
	LogAuthEvent(ctx context.Context, userID, eventType string, sess SessionContext, metadata map[string]any) error
	RegisterUser(ctx context.Context, in RegisterInput) (*RegisterResultDB, error)
	LookupAuthUserIDByEmail(ctx context.Context, email string) (string, bool, error)
	InsertResetToken(ctx context.Context, userID, tokenHash string, requestedAt, expiresAt time.Time, sess SessionContext) (string, error)
	FindResetTokenByHash(ctx context.Context, tokenHash string) (*ResetTokenRow, error)
	MarkResetTokenUsed(ctx context.Context, id string) error
	UpdateEncryptedPassword(ctx context.Context, userID, passwordHash string) error
	RevokeAllUserRefreshTokens(ctx context.Context, userID string) error
}

// Service is the orchestration layer for the app-auth package — it knows
// the rules ("a blocked user cannot log in", "refresh reuse revokes the
// family") and stitches the issuer + password + repo together.
type Service struct {
	r        repo
	issuer   *Issuer
	mailer   Mailer
	appEnv   string // "development" | "staging" | "production"
	appBase  string // public origin for reset-link assembly, e.g. https://tender.su10.ru
	resetTTL time.Duration
}

// NewService wires a Service. The Issuer is the same one main.go feeds the
// JWKS handler — there is intentionally only one signing key in the
// process so JWKS clients converge on the kid we issue.
//
// mailer may be NoopMailer (when SMTP_HOST is empty) — Forgot() then
// returns the reset URL inline in non-prod environments and silently logs
// the unsent mail in prod.
func NewService(r repo, iss *Issuer) *Service {
	return &Service{r: r, issuer: iss, mailer: NoopMailer{}, appEnv: "development", resetTTL: 60 * time.Minute}
}

// WithMailer attaches an outbound email sender. Defaults to NoopMailer.
func (s *Service) WithMailer(m Mailer) *Service { s.mailer = m; return s }

// WithAppEnv sets APP_ENV used by the recovery flow's reset-URL exposure
// gate. Anything other than "production" is treated as non-prod.
func (s *Service) WithAppEnv(env string) *Service {
	s.appEnv = strings.ToLower(strings.TrimSpace(env))
	return s
}

// WithAppBaseURL sets the public origin used to build reset links.
// Trailing slash trimmed.
func (s *Service) WithAppBaseURL(base string) *Service {
	s.appBase = strings.TrimRight(strings.TrimSpace(base), "/")
	return s
}

// WithResetTokenTTL overrides the default 60-minute lifetime of password
// reset tokens (test helper).
func (s *Service) WithResetTokenTTL(d time.Duration) *Service { s.resetTTL = d; return s }

// Login implements POST /api/v1/auth/login.
//
// On any pre-token failure (unknown email, bcrypt mismatch, blocked user)
// the caller sees a single ErrInvalidCredentials / ErrUserBlocked — never
// "email not found" vs "password wrong", to avoid an account-enumeration
// oracle. The audit log records the real cause.
func (s *Service) Login(ctx context.Context, email, password string, sess SessionContext) (*AuthResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" || password == "" {
		return nil, ErrInvalidCredentials
	}

	authRow, err := s.r.GetAuthUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, ErrInvalidCredentials) {
			s.tryLogEvent(ctx, "", EventLoginFailed, sess, map[string]any{"reason": "unknown_email"})
		}
		return nil, err
	}
	if authRow.EncryptedPassword == "" {
		s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "no_password_hash"})
		return nil, ErrInvalidCredentials
	}

	if err := ComparePassword(authRow.EncryptedPassword, password); err != nil {
		if errors.Is(err, ErrPasswordMismatch) {
			s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "password_mismatch"})
			return nil, ErrInvalidCredentials
		}
		// Stored hash malformed — surface as generic invalid credentials but
		// log loudly so an oncaller can spot the corruption.
		log.Warn().Str("user_id", authRow.ID).Err(err).Msg("auth: bcrypt compare returned non-mismatch error")
		s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "hash_malformed"})
		return nil, ErrInvalidCredentials
	}

	pub, err := s.r.GetPublicUserByID(ctx, authRow.ID)
	if err != nil {
		if errors.Is(err, ErrAccountMissing) {
			s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{"reason": "public_users_missing"})
			return nil, ErrUserBlocked
		}
		return nil, fmt.Errorf("authService.Login: load profile: %w", err)
	}
	if !accessAllowed(pub) {
		s.tryLogEvent(ctx, authRow.ID, EventLoginFailed, sess, map[string]any{
			"reason":         "access_blocked",
			"access_status":  pub.AccessStatus,
			"access_enabled": pub.AccessEnabled,
		})
		return nil, ErrUserBlocked
	}

	pair, err := s.issuePair(ctx, authRow.ID, authRow.Email, pub.RoleCode, sess)
	if err != nil {
		return nil, err
	}

	s.tryLogEvent(ctx, authRow.ID, EventLoginSuccess, sess, nil)

	return &AuthResult{
		AccessToken:      pair.access.Token,
		TokenType:        "Bearer",
		ExpiresAt:        pair.access.ExpiresAt,
		ExpiresIn:        int(s.issuer.AccessTTL().Seconds()),
		RefreshToken:     pair.refresh.Token,
		RefreshExpiresAt: pair.refresh.ExpiresAt,
		User:             toPayload(authRow, pub),
	}, nil
}

// Refresh implements POST /api/v1/auth/refresh.
//
// Reuse-detection rule:
//   - If FindRefreshTokenByHash returns a row whose revoked_at IS NOT NULL,
//     the same hash was already rotated AND somebody is replaying it. The
//     entire token_family_id is revoked (defensive); caller gets
//     ErrRefreshReuse.
//   - If revoked_at IS NULL and not expired, rotate atomically.
func (s *Service) Refresh(ctx context.Context, refreshToken string, sess SessionContext) (*AuthResult, error) {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil, ErrRefreshNotFound
	}
	tokenHash := HashRefreshToken(refreshToken)

	row, err := s.r.FindRefreshTokenByHash(ctx, tokenHash)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()

	if row.RevokedAt != nil {
		// Reuse detected. Revoke the whole family to lock out the attacker
		// AND the legitimate user who already rotated to a successor token —
		// they re-login and get a fresh family.
		if err := s.r.RevokeTokenFamily(ctx, row.TokenFamilyID); err != nil {
			log.Error().Err(err).Str("family_id", row.TokenFamilyID).Msg("auth: failed to revoke token family on reuse")
		}
		s.tryLogEvent(ctx, row.UserID, EventRefreshReuseDetected, sess, map[string]any{
			"family_id": row.TokenFamilyID,
		})
		return nil, ErrRefreshReuse
	}
	if !row.ExpiresAt.After(now) {
		return nil, ErrRefreshExpired
	}

	// Load user profile fresh — access status may have flipped since the
	// last access token was issued.
	pub, err := s.r.GetPublicUserByID(ctx, row.UserID)
	if err != nil {
		if errors.Is(err, ErrAccountMissing) {
			return nil, ErrUserBlocked
		}
		return nil, fmt.Errorf("authService.Refresh: load profile: %w", err)
	}
	if !accessAllowed(pub) {
		return nil, ErrUserBlocked
	}

	// Resolve email for the new access-token claim. auth.users is the
	// authoritative source; if for any reason the row is gone (cascade
	// delete since the refresh token was issued), proceed with empty email.
	email := ""
	if au, err := s.lookupEmail(ctx, row.UserID); err == nil {
		email = au
	}

	// Mint new pair, rotate atomically.
	newAccess, err := s.issuer.IssueAccessToken(row.UserID, email, pub.RoleCode)
	if err != nil {
		return nil, fmt.Errorf("authService.Refresh: issue access: %w", err)
	}
	newRefresh, err := s.issuer.IssueRefreshToken()
	if err != nil {
		return nil, fmt.Errorf("authService.Refresh: issue refresh: %w", err)
	}
	newHash := HashRefreshToken(newRefresh.Token)

	if _, err := s.r.RotateRefreshToken(
		ctx,
		row.ID, row.UserID, newHash, row.TokenFamilyID,
		now, newRefresh.ExpiresAt, sess,
	); err != nil {
		return nil, fmt.Errorf("authService.Refresh: rotate: %w", err)
	}

	s.tryLogEvent(ctx, row.UserID, EventRefreshRotated, sess, map[string]any{
		"family_id": row.TokenFamilyID,
	})

	return &AuthResult{
		AccessToken:      newAccess.Token,
		TokenType:        "Bearer",
		ExpiresAt:        newAccess.ExpiresAt,
		ExpiresIn:        int(s.issuer.AccessTTL().Seconds()),
		RefreshToken:     newRefresh.Token,
		RefreshExpiresAt: newRefresh.ExpiresAt,
		User: UserPayload{
			ID:            pub.ID,
			Email:         email,
			FullName:      pub.FullName,
			RoleCode:      pub.RoleCode,
			AccessStatus:  pub.AccessStatus,
			AccessEnabled: pub.AccessEnabled,
			AllowedPages:  pub.AllowedPages,
		},
	}, nil
}

// Logout implements POST /api/v1/auth/logout.
//
// Always returns nil — clients must not learn whether the supplied token
// was known. If the token is empty, this is a no-op (the access JWT is
// still valid until it expires; that is by design for stateless JWTs).
func (s *Service) Logout(ctx context.Context, refreshToken string, sess SessionContext) error {
	refreshToken = strings.TrimSpace(refreshToken)
	if refreshToken == "" {
		return nil
	}
	tokenHash := HashRefreshToken(refreshToken)
	row, err := s.r.FindRefreshTokenByHash(ctx, tokenHash)
	if err != nil {
		// Token not found — treat as already-logged-out. Do NOT leak.
		return nil
	}
	if row.RevokedAt == nil {
		if err := s.r.RevokeRefreshToken(ctx, row.ID); err != nil {
			return fmt.Errorf("authService.Logout: revoke: %w", err)
		}
	}
	s.tryLogEvent(ctx, row.UserID, EventLogout, sess, map[string]any{
		"family_id": row.TokenFamilyID,
	})
	return nil
}

// Register implements POST /api/v1/auth/register.
//
// Validation:
//   - email: lowercased + trimmed; ErrInvalidEmail if empty (the handler
//     additionally enforces RFC-style format via go-playground/validator).
//   - full_name: trimmed; ErrFullNameRequired if empty after trim.
//   - password: minimum 6 chars (matches frontend Form rule); hashed via
//     auth.HashPassword (bcrypt cost 10, Supabase-compatible $2a$10$).
//
// The plaintext password is hashed inside this function and never logged.
// Only EventLoginFailed/Success-style events are recorded by the rest of
// the package; register itself doesn't emit an auth_event (it's a sign-up,
// not an authentication). The admin notification fan-out done by the repo
// surfaces the new request in the admin UI.
func (s *Service) Register(ctx context.Context, req RegisterRequest, sess SessionContext) (*RegisterResult, error) {
	_ = sess // currently unused; kept on the signature so future audit-trail can record IP / UA

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		return nil, ErrInvalidEmail
	}
	fullName := strings.TrimSpace(req.FullName)
	if fullName == "" {
		return nil, ErrFullNameRequired
	}
	if len(req.Password) < 6 {
		return nil, ErrPasswordTooShort
	}

	hash, err := HashPassword(req.Password)
	if err != nil {
		return nil, fmt.Errorf("authService.Register: hash: %w", err)
	}

	res, err := s.r.RegisterUser(ctx, RegisterInput{
		Email:        email,
		PasswordHash: hash,
		FullName:     fullName,
	})
	if err != nil {
		return nil, err
	}
	return &RegisterResult{
		UserID:       res.UserID,
		Email:        email,
		AccessStatus: res.AccessStatus,
	}, nil
}

// Forgot implements POST /api/v1/auth/forgot-password.
//
// Always returns nil error + a ForgotPasswordResult with Success=true
// regardless of whether the email exists — the wire-level response MUST
// NOT differentiate (anti-enumeration). When the email IS known:
//  1. mint a fresh 256-bit opaque reset token (same generator as refresh)
//  2. persist only its SHA-256 hash with expires_at = now + resetTTL
//  3. send the email containing the reset URL (or, in non-prod with no
//     mailer configured, return the URL inline so the operator can test)
//
// All logging keys/values are safe (event_type, redacted family/token ids).
// Plaintext reset token leaves the process only in the email body or, in
// dev, in the in-response ResetURL field — NEVER in logs.
func (s *Service) Forgot(ctx context.Context, email string, sess SessionContext) (*ForgotPasswordResult, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	res := &ForgotPasswordResult{Success: true}
	if email == "" || !strings.Contains(email, "@") {
		// Same generic answer — don't leak invalid-email feedback.
		return res, nil
	}

	userID, found, err := s.r.LookupAuthUserIDByEmail(ctx, email)
	if err != nil {
		// Log + still return success to preserve anti-enumeration semantics.
		log.Error().Err(err).Str("email_sha8", sha8(email)).Msg("auth: forgot: lookup error")
		return res, nil
	}
	if !found {
		s.tryLogEvent(ctx, "", "password_reset_requested_unknown_email", sess, map[string]any{"email_sha8": sha8(email)})
		return res, nil
	}

	// Mint a fresh opaque reset token.
	issued, err := s.issuer.IssueRefreshToken() // same 256-bit CSPRNG generator — repurposed
	if err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("auth: forgot: mint failed")
		return res, nil
	}
	now := time.Now().UTC()
	expires := now.Add(s.resetTTL)
	hash := HashRefreshToken(issued.Token)
	if _, err := s.r.InsertResetToken(ctx, userID, hash, now, expires, sess); err != nil {
		log.Error().Err(err).Str("user_id", userID).Msg("auth: forgot: persist failed")
		return res, nil
	}

	resetURL := s.buildResetURL(issued.Token)

	// Attempt to send mail. The mailer may be NoopMailer (SMTP not
	// configured) — that's expected in dev.
	if s.mailer.IsConfigured() {
		subject := "Восстановление пароля TenderHUB"
		body := fmt.Sprintf(
			"Здравствуйте!\n\nДля восстановления пароля перейдите по ссылке:\n%s\n\nСсылка действительна %d минут. Если вы не запрашивали восстановление, просто проигнорируйте это письмо.\n\n— TenderHUB",
			resetURL, int(s.resetTTL.Minutes()),
		)
		if err := s.mailer.Send(email, subject, body); err != nil {
			log.Error().Err(err).Str("user_id", userID).Msg("auth: forgot: email send failed")
			// Still return success — anti-enumeration. Operator sees the warning in logs.
		}
	} else if s.appEnv != "production" {
		// Non-prod convenience: expose the URL so the operator can test the
		// flow end-to-end without SMTP. NEVER do this in prod.
		res.ResetURL = resetURL
	} else {
		// Prod with no mailer configured. Drop silently with a loud server-log
		// warning so the operator notices and configures SMTP.
		log.Warn().
			Str("user_id", userID).
			Msg("auth: forgot-password called but mailer is not configured in production — reset email NOT sent")
	}

	s.tryLogEvent(ctx, userID, "password_reset_requested", sess, nil)
	return res, nil
}

// Reset implements POST /api/v1/auth/reset-password.
//
// On success:
//   - bcrypt-hashes the new password (cost 10, Supabase-compatible)
//   - updates auth.users.encrypted_password
//   - marks the reset row used (single-use)
//   - revokes ALL existing refresh tokens for the user (forced re-login)
//   - logs password_reset_success
//
// Maps:
//   - empty token / new_password too short    -> ErrPasswordTooShort / ErrInvalidEmail-style 400
//   - token not found / used / expired        -> ErrResetTokenNotFound (generic, handler 401)
func (s *Service) Reset(ctx context.Context, token, newPassword string, sess SessionContext) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrResetTokenNotFound
	}
	if len(newPassword) < 6 {
		return ErrPasswordTooShort
	}

	row, err := s.r.FindResetTokenByHash(ctx, HashRefreshToken(token))
	if err != nil {
		return err // ErrResetTokenNotFound
	}
	now := time.Now().UTC()
	if row.UsedAt != nil {
		return ErrResetTokenUsed
	}
	if !row.ExpiresAt.After(now) {
		return ErrResetTokenExpired
	}

	hash, err := HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("authService.Reset: hash: %w", err)
	}
	if err := s.r.UpdateEncryptedPassword(ctx, row.UserID, hash); err != nil {
		return fmt.Errorf("authService.Reset: update password: %w", err)
	}
	if err := s.r.MarkResetTokenUsed(ctx, row.ID); err != nil {
		// Non-fatal for the user — they have the new password — but log.
		log.Warn().Err(err).Str("user_id", row.UserID).Msg("auth: reset: mark used failed")
	}
	if err := s.r.RevokeAllUserRefreshTokens(ctx, row.UserID); err != nil {
		log.Warn().Err(err).Str("user_id", row.UserID).Msg("auth: reset: revoke refresh tokens failed")
	}
	s.tryLogEvent(ctx, row.UserID, "password_reset_success", sess, nil)
	return nil
}

// ChangePassword implements POST /api/v1/auth/change-password (authed).
//
// userID comes from the verified JWT (middleware). currentPassword is
// re-verified against the live bcrypt hash before the update lands —
// this protects against compromised access tokens being used to silently
// change the credentials.
//
// Strategy: on success ALL refresh tokens of the user are revoked.
// The current access token remains valid until its 15-min TTL elapses,
// but no further refresh will succeed — user must re-login.
func (s *Service) ChangePassword(ctx context.Context, userID, currentPassword, newPassword string, sess SessionContext) error {
	if userID == "" {
		return ErrInvalidCredentials
	}
	if len(newPassword) < 6 {
		return ErrPasswordTooShort
	}

	au, err := s.r.GetAuthUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if au.EncryptedPassword == "" {
		return ErrInvalidCredentials
	}
	if err := ComparePassword(au.EncryptedPassword, currentPassword); err != nil {
		if errors.Is(err, ErrPasswordMismatch) {
			s.tryLogEvent(ctx, userID, "password_change_failed", sess, map[string]any{"reason": "wrong_current_password"})
			return ErrInvalidCredentials
		}
		return fmt.Errorf("authService.ChangePassword: compare: %w", err)
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("authService.ChangePassword: hash: %w", err)
	}
	if err := s.r.UpdateEncryptedPassword(ctx, userID, hash); err != nil {
		return fmt.Errorf("authService.ChangePassword: update password: %w", err)
	}
	if err := s.r.RevokeAllUserRefreshTokens(ctx, userID); err != nil {
		log.Warn().Err(err).Str("user_id", userID).Msg("auth: change-password: revoke refresh tokens failed")
	}
	s.tryLogEvent(ctx, userID, "password_changed", sess, nil)
	return nil
}

// buildResetURL assembles the public reset link. Empty AppBaseURL falls
// back to a path-only string (callers in dev environments can prepend a
// localhost origin when copying).
func (s *Service) buildResetURL(token string) string {
	q := "?token=" + url.QueryEscape(token)
	if s.appBase != "" {
		return s.appBase + "/reset-password" + q
	}
	return "/reset-password" + q
}

// sha8 produces a tiny stable identifier from an email for log correlation
// without leaking the address itself.
func sha8(s string) string { return HashRefreshToken(s)[:8] }

// Me returns the public profile for the calling user (sourced from
// middleware-attached AuthUser.ID). Used by GET /api/v1/auth/me.
func (s *Service) Me(ctx context.Context, userID string) (*UserPayload, error) {
	if userID == "" {
		return nil, ErrInvalidCredentials
	}
	pub, err := s.r.GetPublicUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	email, _ := s.lookupEmail(ctx, userID)
	return &UserPayload{
		ID:            pub.ID,
		Email:         email,
		FullName:      pub.FullName,
		RoleCode:      pub.RoleCode,
		AccessStatus:  pub.AccessStatus,
		AccessEnabled: pub.AccessEnabled,
		AllowedPages:  pub.AllowedPages,
	}, nil
}

// Issuer exposes the underlying JWT issuer so the JWKS handler can grab the
// public key without us re-exporting it explicitly.
func (s *Service) Issuer() *Issuer { return s.issuer }

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// issuedPair is an internal carrier for the access + refresh token outputs
// of one issue+persist sequence.
type issuedPair struct {
	access  IssuedAccess
	refresh IssuedRefresh
}

// issuePair mints a fresh access + refresh token AND persists the refresh-
// token row under a brand new token_family_id. Used at Login (NOT refresh —
// refresh uses RotateRefreshToken to stay in the existing family).
func (s *Service) issuePair(ctx context.Context, userID, email, roleCode string, sess SessionContext) (issuedPair, error) {
	access, err := s.issuer.IssueAccessToken(userID, email, roleCode)
	if err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: access: %w", err)
	}
	refresh, err := s.issuer.IssueRefreshToken()
	if err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: refresh: %w", err)
	}
	familyID, err := NewFamilyID()
	if err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: family: %w", err)
	}
	if _, err := s.r.InsertRefreshToken(ctx,
		userID,
		HashRefreshToken(refresh.Token),
		familyID,
		time.Now().UTC(),
		refresh.ExpiresAt,
		sess,
	); err != nil {
		return issuedPair{}, fmt.Errorf("authService.issuePair: persist: %w", err)
	}
	return issuedPair{access: access, refresh: refresh}, nil
}

// lookupEmail re-reads auth.users.email for the given user. The login
// response carries this; Refresh needs it too because the access-token
// "email" claim must stay accurate even if the user changed emails.
func (s *Service) lookupEmail(ctx context.Context, userID string) (string, error) {
	row, err := s.r.GetAuthUserByID(ctx, userID)
	if err != nil {
		return "", err
	}
	return row.Email, nil
}

// tryLogEvent records an auth event and swallows the error after logging.
// We never want a logging failure to cascade into a denied login.
func (s *Service) tryLogEvent(ctx context.Context, userID, eventType string, sess SessionContext, metadata map[string]any) {
	if err := s.r.LogAuthEvent(ctx, userID, eventType, sess, metadata); err != nil {
		log.Warn().Err(err).Str("event_type", eventType).Msg("auth: failed to record auth event")
	}
}

// accessAllowed returns true when the user's row indicates they may sign in.
// Mirrors the frontend behaviour: access_enabled must be true AND status
// must be "approved". Any other state (pending, blocked, rejected, empty)
// fails.
func accessAllowed(p *PublicUserRow) bool {
	if !p.AccessEnabled {
		return false
	}
	return strings.EqualFold(p.AccessStatus, "approved")
}

func toPayload(authRow *AuthUserRow, pub *PublicUserRow) UserPayload {
	return UserPayload{
		ID:            pub.ID,
		Email:         authRow.Email,
		FullName:      pub.FullName,
		RoleCode:      pub.RoleCode,
		AccessStatus:  pub.AccessStatus,
		AccessEnabled: pub.AccessEnabled,
		AllowedPages:  pub.AllowedPages,
	}
}
