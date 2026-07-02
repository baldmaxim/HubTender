package auth

import (
	"context"
	"fmt"
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
// Flow implementations live in sibling files: service_session.go
// (Login/Refresh/Logout/Me) and service_password.go
// (Register/Forgot/Reset/ChangePassword).
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
