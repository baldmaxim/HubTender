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
	// Production deploy-gate: if SMTP is not configured we'd silently drop
	// the email and the end user would see a false-positive "we sent you a
	// letter" toast. Fail fast with a controlled error instead — the
	// handler maps it to 503. This is the ONE branch where we sacrifice
	// anti-enumeration semantics on purpose: telling all callers
	// "service unavailable" is preferable to telling them "all done" and
	// silently doing nothing. In non-production we keep the dev-friendly
	// reset_url-in-response path active.
	if s.appEnv == "production" && !s.mailer.IsConfigured() {
		log.Warn().Msg("auth: /forgot-password called in production with no mailer configured — returning 503")
		return nil, ErrMailerNotConfigured
	}

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
