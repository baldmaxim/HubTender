package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
)

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
