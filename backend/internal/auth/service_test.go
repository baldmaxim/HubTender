package auth

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Shared fixtures (fakeRepo, fakeMailer, newTestService, seedUser,
// extractTokenFromURL) live in fakes_test.go. Register tests are in
// service_register_test.go; Forgot/Reset/ChangePassword tests are in
// service_reset_test.go.

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

func TestLogin_OK(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")

	res, err := svc.Login(context.Background(), "A@B.com", "password1", SessionContext{UserAgent: "ua", IPAddress: "127.0.0.1"})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if res.AccessToken == "" || res.RefreshToken == "" {
		t.Fatalf("expected non-empty tokens")
	}
	if res.User.ID != "u1" || res.User.Email != "a@b.com" {
		t.Fatalf("unexpected user payload: %+v", res.User)
	}
	if res.User.RoleCode != "engineer" || res.User.AccessStatus != "approved" {
		t.Fatalf("unexpected role/status: %+v", res.User)
	}
	if len(repo.events) != 1 || repo.events[0].EventType != EventLoginSuccess {
		t.Fatalf("expected one login_success event, got %+v", repo.events)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")

	_, err := svc.Login(context.Background(), "a@b.com", "wrong", SessionContext{})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_UnknownEmail(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	_, err := svc.Login(context.Background(), "nobody@nowhere.com", "x", SessionContext{})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}
}

func TestLogin_NullPasswordHash(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	repo.authByEmail["a@b.com"].EncryptedPassword = ""

	_, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for empty hash, got %v", err)
	}
}

func TestLogin_BlockedByAccessStatus(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	repo.pub["u1"].AccessStatus = "pending"

	_, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if !errors.Is(err, ErrUserBlocked) {
		t.Fatalf("expected ErrUserBlocked, got %v", err)
	}
}

func TestLogin_BlockedByAccessEnabledFalse(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	repo.pub["u1"].AccessEnabled = false

	_, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if !errors.Is(err, ErrUserBlocked) {
		t.Fatalf("expected ErrUserBlocked, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

func TestRefresh_RotatesAndOldFails(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")

	login, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	oldRefresh := login.RefreshToken

	r1, err := svc.Refresh(context.Background(), oldRefresh, SessionContext{})
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	if r1.RefreshToken == oldRefresh {
		t.Fatalf("rotation did not change the refresh token")
	}
	// Same family ID must survive across rotations.
	oldRow := repo.tokens[repo.byHash[HashRefreshToken(oldRefresh)]]
	newRow := repo.tokens[repo.byHash[HashRefreshToken(r1.RefreshToken)]]
	if oldRow.TokenFamilyID != newRow.TokenFamilyID {
		t.Fatalf("expected same family id across rotation, got %s vs %s", oldRow.TokenFamilyID, newRow.TokenFamilyID)
	}
	if oldRow.RevokedAt == nil {
		t.Fatalf("old token must be revoked after rotation")
	}

	// Replay the old token — must fail with reuse.
	_, err = svc.Refresh(context.Background(), oldRefresh, SessionContext{})
	if !errors.Is(err, ErrRefreshReuse) {
		t.Fatalf("expected ErrRefreshReuse on replay, got %v", err)
	}
}

func TestRefresh_ReuseRevokesFamily(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	login, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	r1, err := svc.Refresh(context.Background(), login.RefreshToken, SessionContext{})
	if err != nil {
		t.Fatalf("Refresh: %v", err)
	}
	// Trigger reuse with the original token.
	_, _ = svc.Refresh(context.Background(), login.RefreshToken, SessionContext{})

	// The successor token must now be revoked too (family-wide).
	successor := repo.tokens[repo.byHash[HashRefreshToken(r1.RefreshToken)]]
	if successor.RevokedAt == nil {
		t.Fatalf("expected successor revoked after family revoke")
	}
}

func TestRefresh_UnknownTokenFails(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	_, err := svc.Refresh(context.Background(), "definitely-not-issued", SessionContext{})
	if !errors.Is(err, ErrRefreshNotFound) {
		t.Fatalf("expected ErrRefreshNotFound, got %v", err)
	}
}

func TestRefresh_ExpiredTokenFails(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	login, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	// Backdate the stored expiry past now.
	row := repo.tokens[repo.byHash[HashRefreshToken(login.RefreshToken)]]
	row.ExpiresAt = time.Now().Add(-1 * time.Minute)

	_, err = svc.Refresh(context.Background(), login.RefreshToken, SessionContext{})
	if !errors.Is(err, ErrRefreshExpired) {
		t.Fatalf("expected ErrRefreshExpired, got %v", err)
	}
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

func TestLogout_Idempotent(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	login, _ := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})

	if err := svc.Logout(context.Background(), login.RefreshToken, SessionContext{}); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	row := repo.tokens[repo.byHash[HashRefreshToken(login.RefreshToken)]]
	if row.RevokedAt == nil {
		t.Fatalf("expected token revoked after logout")
	}

	// Second logout — must still succeed silently.
	if err := svc.Logout(context.Background(), login.RefreshToken, SessionContext{}); err != nil {
		t.Fatalf("Logout(2): %v", err)
	}
	if err := svc.Logout(context.Background(), "", SessionContext{}); err != nil {
		t.Fatalf("Logout(empty): %v", err)
	}
	if err := svc.Logout(context.Background(), "unknown-token", SessionContext{}); err != nil {
		t.Fatalf("Logout(unknown): %v", err)
	}
}

// ---------------------------------------------------------------------------
// Me
// ---------------------------------------------------------------------------

func TestMe_OK(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	seedUser(t, repo, "u1", "a@b.com", "password1")
	p, err := svc.Me(context.Background(), "u1")
	if err != nil {
		t.Fatalf("Me: %v", err)
	}
	if p.ID != "u1" || p.Email != "a@b.com" {
		t.Fatalf("unexpected payload: %+v", p)
	}
}

func TestMe_MissingUser(t *testing.T) {
	repo := newFakeRepo()
	svc := newTestService(t, repo)
	_, err := svc.Me(context.Background(), "nope")
	if !errors.Is(err, ErrAccountMissing) {
		t.Fatalf("expected ErrAccountMissing, got %v", err)
	}
}
