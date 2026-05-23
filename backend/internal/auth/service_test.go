package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"strings"
	"testing"
	"time"
)

// fakeRepo is a programmable in-memory Repository replacement used by the
// service / handler tests in this package. No DB.
type fakeRepo struct {
	authByEmail map[string]*AuthUserRow
	authByID    map[string]*AuthUserRow
	pub         map[string]*PublicUserRow
	tokens      map[string]*RefreshTokenRow // keyed by ID
	byHash      map[string]string           // token_hash -> token ID
	events      []event

	failInsert bool
}

type event struct {
	UserID    string
	EventType string
	Metadata  map[string]any
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		authByEmail: map[string]*AuthUserRow{},
		authByID:    map[string]*AuthUserRow{},
		pub:         map[string]*PublicUserRow{},
		tokens:      map[string]*RefreshTokenRow{},
		byHash:      map[string]string{},
	}
}

func (f *fakeRepo) GetAuthUserByEmail(_ context.Context, email string) (*AuthUserRow, error) {
	row, ok := f.authByEmail[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return nil, ErrInvalidCredentials
	}
	return row, nil
}

func (f *fakeRepo) GetAuthUserByID(_ context.Context, id string) (*AuthUserRow, error) {
	row, ok := f.authByID[id]
	if !ok {
		return nil, ErrAccountMissing
	}
	return row, nil
}

func (f *fakeRepo) GetPublicUserByID(_ context.Context, id string) (*PublicUserRow, error) {
	row, ok := f.pub[id]
	if !ok {
		return nil, ErrAccountMissing
	}
	return row, nil
}

func (f *fakeRepo) InsertRefreshToken(_ context.Context, userID, tokenHash, familyID string, issuedAt, expiresAt time.Time, _ SessionContext) (string, error) {
	if f.failInsert {
		return "", errors.New("forced insert failure")
	}
	id := "rt-" + tokenHash[:8]
	row := &RefreshTokenRow{
		ID:            id,
		UserID:        userID,
		TokenHash:     tokenHash,
		TokenFamilyID: familyID,
		IssuedAt:      issuedAt,
		ExpiresAt:     expiresAt,
	}
	f.tokens[id] = row
	f.byHash[tokenHash] = id
	return id, nil
}

func (f *fakeRepo) FindRefreshTokenByHash(_ context.Context, h string) (*RefreshTokenRow, error) {
	id, ok := f.byHash[h]
	if !ok {
		return nil, ErrRefreshNotFound
	}
	row := *f.tokens[id]
	return &row, nil
}

func (f *fakeRepo) RevokeRefreshToken(_ context.Context, id string) error {
	row, ok := f.tokens[id]
	if !ok {
		return nil // idempotent
	}
	if row.RevokedAt == nil {
		now := time.Now().UTC()
		row.RevokedAt = &now
	}
	return nil
}

func (f *fakeRepo) RevokeTokenFamily(_ context.Context, familyID string) error {
	now := time.Now().UTC()
	for _, row := range f.tokens {
		if row.TokenFamilyID == familyID && row.RevokedAt == nil {
			t := now
			row.RevokedAt = &t
		}
	}
	return nil
}

func (f *fakeRepo) RotateRefreshToken(_ context.Context, oldID, userID, newHash, familyID string, issuedAt, expiresAt time.Time, _ SessionContext) (string, error) {
	now := time.Now().UTC()
	newID := "rt-" + newHash[:8]
	newRow := &RefreshTokenRow{
		ID:            newID,
		UserID:        userID,
		TokenHash:     newHash,
		TokenFamilyID: familyID,
		IssuedAt:      issuedAt,
		ExpiresAt:     expiresAt,
	}
	f.tokens[newID] = newRow
	f.byHash[newHash] = newID
	if old, ok := f.tokens[oldID]; ok {
		t := now
		old.RevokedAt = &t
		old.ReplacedBy = &newID
	}
	return newID, nil
}

func (f *fakeRepo) LogAuthEvent(_ context.Context, userID, eventType string, _ SessionContext, metadata map[string]any) error {
	f.events = append(f.events, event{UserID: userID, EventType: eventType, Metadata: metadata})
	return nil
}

func (f *fakeRepo) RegisterUser(_ context.Context, in RegisterInput) (*RegisterResultDB, error) {
	// Case-insensitive duplicate guard, same as the real repo.
	if _, ok := f.authByEmail[strings.ToLower(in.Email)]; ok {
		return nil, ErrEmailAlreadyExists
	}
	// Synth a deterministic user id from the email so tests can introspect.
	uid := "u-" + strings.ToLower(in.Email)
	au := &AuthUserRow{ID: uid, Email: in.Email, EncryptedPassword: in.PasswordHash}
	f.authByEmail[strings.ToLower(in.Email)] = au
	f.authByID[uid] = au
	// Pretend the legacy role-pages resolver returned "/dashboard" for
	// engineer; first-user check is always false in tests (we seed at least
	// one user before calling Register) so access_status = pending.
	access := "pending"
	if len(f.pub) == 0 {
		access = "approved"
	}
	f.pub[uid] = &PublicUserRow{
		ID:            uid,
		FullName:      in.FullName,
		RoleCode:      "engineer",
		AccessStatus:  access,
		AccessEnabled: true,
		AllowedPages:  []string{"/dashboard"},
	}
	return &RegisterResultDB{UserID: uid, AccessStatus: access}, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func newTestSigningKey(t *testing.T) *SigningKey {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa.GenerateKey: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("MarshalPKCS8PrivateKey: %v", err)
	}
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	sk, err := LoadSigningKey(pemBytes)
	if err != nil {
		t.Fatalf("LoadSigningKey: %v", err)
	}
	return sk
}

func newTestService(t *testing.T, repo *fakeRepo) *Service {
	t.Helper()
	iss, err := NewIssuer(IssuerConfig{
		SigningKey: newTestSigningKey(t),
		Issuer:     "https://test.local",
		Audience:   "test-aud",
		AccessTTL:  5 * time.Minute,
		RefreshTTL: 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	return NewService(repo, iss)
}

// seedUser inserts a user with the given (lowercased) email and bcrypt
// hash, plus a matching public.users row in "approved + enabled" state.
func seedUser(t *testing.T, f *fakeRepo, userID, email, password string) {
	t.Helper()
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	au := &AuthUserRow{ID: userID, Email: email, EncryptedPassword: hash}
	f.authByEmail[strings.ToLower(email)] = au
	f.authByID[userID] = au
	f.pub[userID] = &PublicUserRow{
		ID:            userID,
		FullName:      "Test User",
		RoleCode:      "engineer",
		AccessStatus:  "approved",
		AccessEnabled: true,
		AllowedPages:  []string{"/dashboard"},
	}
}

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
