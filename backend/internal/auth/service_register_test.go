package auth

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

func TestRegister_OK(t *testing.T) {
	repo := newFakeRepo()
	// Seed an existing user so we don't trip the first-user-privileged branch.
	seedUser(t, repo, "u-existing", "existing@b.com", "pwd123456")
	svc := newTestService(t, repo)
	res, err := svc.Register(context.Background(), RegisterRequest{
		Email:    "  NEW@B.COM  ",
		Password: "valid-password",
		FullName: "  New User  ",
	}, SessionContext{})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if res.Email != "new@b.com" {
		t.Fatalf("email not lower/trimmed: %q", res.Email)
	}
	if res.AccessStatus != "pending" {
		t.Fatalf("expected pending access_status, got %q", res.AccessStatus)
	}
	au, ok := repo.authByEmail["new@b.com"]
	if !ok {
		t.Fatalf("auth.users row not created")
	}
	if au.EncryptedPassword == "" || strings.HasPrefix(au.EncryptedPassword, "valid-password") {
		t.Fatalf("password not bcrypt'd")
	}
	if !strings.HasPrefix(au.EncryptedPassword, "$2a$") {
		t.Fatalf("expected $2a$ bcrypt prefix, got %q", au.EncryptedPassword[:4])
	}
	if pub, ok := repo.pub[res.UserID]; !ok {
		t.Fatalf("public.users row not created")
	} else if pub.FullName != "New User" || pub.RoleCode != "engineer" {
		t.Fatalf("public row wrong: %+v", pub)
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "dup@b.com", "pwd123456")
	svc := newTestService(t, repo)
	_, err := svc.Register(context.Background(), RegisterRequest{
		Email: "DUP@b.com", Password: "another-pwd", FullName: "Other",
	}, SessionContext{})
	if !errors.Is(err, ErrEmailAlreadyExists) {
		t.Fatalf("expected ErrEmailAlreadyExists, got %v", err)
	}
}

func TestRegister_WeakPassword(t *testing.T) {
	svc := newTestService(t, newFakeRepo())
	_, err := svc.Register(context.Background(), RegisterRequest{
		Email: "weak@b.com", Password: "12345", FullName: "Weak",
	}, SessionContext{})
	if !errors.Is(err, ErrPasswordTooShort) {
		t.Fatalf("expected ErrPasswordTooShort, got %v", err)
	}
}

func TestRegister_EmptyEmail(t *testing.T) {
	svc := newTestService(t, newFakeRepo())
	_, err := svc.Register(context.Background(), RegisterRequest{
		Email: "   ", Password: "valid-password", FullName: "X",
	}, SessionContext{})
	if !errors.Is(err, ErrInvalidEmail) {
		t.Fatalf("expected ErrInvalidEmail, got %v", err)
	}
}

func TestRegister_MalformedEmail(t *testing.T) {
	svc := newTestService(t, newFakeRepo())
	_, err := svc.Register(context.Background(), RegisterRequest{
		Email: "not-an-email", Password: "valid-password", FullName: "X",
	}, SessionContext{})
	if !errors.Is(err, ErrInvalidEmail) {
		t.Fatalf("expected ErrInvalidEmail, got %v", err)
	}
}

func TestRegister_EmptyFullName(t *testing.T) {
	svc := newTestService(t, newFakeRepo())
	_, err := svc.Register(context.Background(), RegisterRequest{
		Email: "x@b.com", Password: "valid-password", FullName: "   ",
	}, SessionContext{})
	if !errors.Is(err, ErrFullNameRequired) {
		t.Fatalf("expected ErrFullNameRequired, got %v", err)
	}
}
