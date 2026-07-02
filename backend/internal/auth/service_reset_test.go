package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Forgot / Reset / ChangePassword
// ---------------------------------------------------------------------------

func TestForgot_UnknownEmailGenericSuccess(t *testing.T) {
	svc := newTestService(t, newFakeRepo()).WithAppEnv("development")
	res, err := svc.Forgot(context.Background(), "nobody@nowhere.com", SessionContext{})
	if err != nil {
		t.Fatalf("Forgot: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected Success=true for anti-enumeration")
	}
	if res.ResetURL != "" {
		t.Fatalf("ResetURL leaked for unknown email: %q", res.ResetURL)
	}
}

func TestForgot_KnownEmail_NonProdReturnsResetURL(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	svc := newTestService(t, repo).WithAppEnv("development").WithAppBaseURL("https://test.local")
	res, err := svc.Forgot(context.Background(), "A@b.com", SessionContext{})
	if err != nil {
		t.Fatalf("Forgot: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected Success=true")
	}
	if res.ResetURL == "" {
		t.Fatalf("expected ResetURL in dev mode")
	}
	if !strings.HasPrefix(res.ResetURL, "https://test.local/reset-password?token=") {
		t.Fatalf("unexpected reset URL: %q", res.ResetURL)
	}
	// Token is stored only as hash. Find any stored token and compare.
	if len(repo.resetByHash) != 1 {
		t.Fatalf("expected 1 reset token stored, got %d", len(repo.resetByHash))
	}
	var stored *ResetTokenRow
	for _, v := range repo.resetByHash {
		stored = v
	}
	if stored.TokenHash == "" {
		t.Fatalf("expected non-empty token hash")
	}
	// The plaintext token MUST NOT equal its hash representation.
	if strings.Contains(res.ResetURL, stored.TokenHash) {
		t.Fatalf("response URL contains the hash itself, expected plaintext token")
	}
}

func TestForgot_ProdWithoutSMTP_Returns503Error(t *testing.T) {
	// Production + NoopMailer (default for newTestService) — must fail
	// fast with ErrMailerNotConfigured BEFORE creating any token, to
	// avoid the false-positive "we sent you a letter" UX.
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	svc := newTestService(t, repo).WithAppEnv("production")
	_, err := svc.Forgot(context.Background(), "a@b.com", SessionContext{})
	if !errors.Is(err, ErrMailerNotConfigured) {
		t.Fatalf("expected ErrMailerNotConfigured, got %v", err)
	}
	if len(repo.resetByHash) != 0 {
		t.Fatalf("no reset token should be persisted on guard failure, got %d", len(repo.resetByHash))
	}
}

func TestForgot_ProdWithSMTP_OKHidesResetURL(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	mailer := &fakeMailer{configured: true}
	svc := newTestService(t, repo).
		WithAppEnv("production").
		WithAppBaseURL("https://prod.local").
		WithMailer(mailer)
	res, err := svc.Forgot(context.Background(), "a@b.com", SessionContext{})
	if err != nil {
		t.Fatalf("Forgot: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected Success=true")
	}
	if res.ResetURL != "" {
		t.Fatalf("ResetURL must NEVER appear in prod, got %q", res.ResetURL)
	}
	if len(mailer.sent) != 1 {
		t.Fatalf("expected one email sent, got %d", len(mailer.sent))
	}
	if mailer.sent[0].to != "a@b.com" {
		t.Fatalf("wrong recipient: %s", mailer.sent[0].to)
	}
	if !strings.Contains(mailer.sent[0].body, "https://prod.local/reset-password?token=") {
		t.Fatalf("email body missing reset URL")
	}
}

func TestForgot_ProdWithSMTP_UnknownEmailGenericSuccess(t *testing.T) {
	// In prod with SMTP configured, unknown email STILL returns 200
	// success — anti-enumeration. No email is sent.
	repo := newFakeRepo()
	mailer := &fakeMailer{configured: true}
	svc := newTestService(t, repo).WithAppEnv("production").WithMailer(mailer)
	res, err := svc.Forgot(context.Background(), "nobody@nowhere.com", SessionContext{})
	if err != nil {
		t.Fatalf("Forgot: %v", err)
	}
	if !res.Success || res.ResetURL != "" {
		t.Fatalf("expected generic success without URL, got %+v", res)
	}
	if len(mailer.sent) != 0 {
		t.Fatalf("expected no email sent for unknown address, got %d", len(mailer.sent))
	}
}

func TestReset_OK_RevokesRefreshTokensAndAcceptsNewPassword(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	svc := newTestService(t, repo).WithAppEnv("development").WithAppBaseURL("https://test.local")

	// Issue a reset token via Forgot.
	res, err := svc.Forgot(context.Background(), "a@b.com", SessionContext{})
	if err != nil || res.ResetURL == "" {
		t.Fatalf("Forgot: err=%v url=%q", err, res.ResetURL)
	}
	token := extractTokenFromURL(t, res.ResetURL)

	// Issue an existing refresh-token first so we can verify it gets revoked.
	login, err := svc.Login(context.Background(), "a@b.com", "oldpassword", SessionContext{})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	rtID := repo.byHash[HashRefreshToken(login.RefreshToken)]
	if repo.tokens[rtID].RevokedAt != nil {
		t.Fatalf("pre-reset refresh token unexpectedly already revoked")
	}

	// Reset.
	if err := svc.Reset(context.Background(), token, "newpassword", SessionContext{}); err != nil {
		t.Fatalf("Reset: %v", err)
	}
	// Old password rejected.
	if _, err := svc.Login(context.Background(), "a@b.com", "oldpassword", SessionContext{}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials with old password, got %v", err)
	}
	// New password accepted.
	if _, err := svc.Login(context.Background(), "a@b.com", "newpassword", SessionContext{}); err != nil {
		t.Fatalf("expected new password to authenticate, got %v", err)
	}
	// Refresh token revoked.
	if repo.tokens[rtID].RevokedAt == nil {
		t.Fatalf("expected pre-reset refresh token to be revoked after Reset")
	}
}

func TestReset_TokenSingleUse(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	svc := newTestService(t, repo).WithAppEnv("development").WithAppBaseURL("https://test.local")
	res, _ := svc.Forgot(context.Background(), "a@b.com", SessionContext{})
	token := extractTokenFromURL(t, res.ResetURL)
	if err := svc.Reset(context.Background(), token, "first-new-pwd", SessionContext{}); err != nil {
		t.Fatalf("first Reset: %v", err)
	}
	if err := svc.Reset(context.Background(), token, "second-new-pwd", SessionContext{}); !errors.Is(err, ErrResetTokenUsed) {
		t.Fatalf("expected ErrResetTokenUsed on replay, got %v", err)
	}
}

func TestReset_ExpiredTokenFails(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	// 1 ns TTL → token expires by the time Reset() runs.
	svc := newTestService(t, repo).WithAppEnv("development").WithAppBaseURL("https://test.local").WithResetTokenTTL(time.Nanosecond)
	res, _ := svc.Forgot(context.Background(), "a@b.com", SessionContext{})
	token := extractTokenFromURL(t, res.ResetURL)
	time.Sleep(2 * time.Millisecond)
	if err := svc.Reset(context.Background(), token, "newpwd", SessionContext{}); !errors.Is(err, ErrResetTokenExpired) {
		t.Fatalf("expected ErrResetTokenExpired, got %v", err)
	}
}

func TestReset_UnknownTokenFails(t *testing.T) {
	svc := newTestService(t, newFakeRepo()).WithAppEnv("development")
	if err := svc.Reset(context.Background(), "no-such-token", "newpwd", SessionContext{}); !errors.Is(err, ErrResetTokenNotFound) {
		t.Fatalf("expected ErrResetTokenNotFound, got %v", err)
	}
}

func TestReset_WeakPasswordFails(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	svc := newTestService(t, repo).WithAppEnv("development").WithAppBaseURL("https://test.local")
	res, _ := svc.Forgot(context.Background(), "a@b.com", SessionContext{})
	token := extractTokenFromURL(t, res.ResetURL)
	if err := svc.Reset(context.Background(), token, "12345", SessionContext{}); !errors.Is(err, ErrPasswordTooShort) {
		t.Fatalf("expected ErrPasswordTooShort, got %v", err)
	}
}

func TestChangePassword_OK_RevokesRefreshTokens(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	svc := newTestService(t, repo)
	login, _ := svc.Login(context.Background(), "a@b.com", "oldpassword", SessionContext{})
	rtID := repo.byHash[HashRefreshToken(login.RefreshToken)]
	if err := svc.ChangePassword(context.Background(), "u1", "oldpassword", "brand-new-pwd", SessionContext{}); err != nil {
		t.Fatalf("ChangePassword: %v", err)
	}
	if repo.tokens[rtID].RevokedAt == nil {
		t.Fatalf("expected refresh tokens revoked after ChangePassword")
	}
	if _, err := svc.Login(context.Background(), "a@b.com", "brand-new-pwd", SessionContext{}); err != nil {
		t.Fatalf("expected new password to authenticate, got %v", err)
	}
	if _, err := svc.Login(context.Background(), "a@b.com", "oldpassword", SessionContext{}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected old password rejected, got %v", err)
	}
}

func TestChangePassword_WrongCurrentFails(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	svc := newTestService(t, repo)
	if err := svc.ChangePassword(context.Background(), "u1", "wrong-current", "newpwd123", SessionContext{}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestChangePassword_WeakNewFails(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "oldpassword")
	svc := newTestService(t, repo)
	if err := svc.ChangePassword(context.Background(), "u1", "oldpassword", "123", SessionContext{}); !errors.Is(err, ErrPasswordTooShort) {
		t.Fatalf("expected ErrPasswordTooShort, got %v", err)
	}
}
