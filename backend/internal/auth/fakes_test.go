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
	resetByHash map[string]*ResetTokenRow   // password reset tokens keyed by hash
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
		resetByHash: map[string]*ResetTokenRow{},
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

func (f *fakeRepo) LookupAuthUserIDByEmail(_ context.Context, email string) (string, bool, error) {
	row, ok := f.authByEmail[strings.ToLower(strings.TrimSpace(email))]
	if !ok {
		return "", false, nil
	}
	return row.ID, true, nil
}

func (f *fakeRepo) InsertResetToken(_ context.Context, userID, tokenHash string, requestedAt, expiresAt time.Time, _ SessionContext) (string, error) {
	id := "rst-" + tokenHash[:8]
	f.resetByHash[tokenHash] = &ResetTokenRow{
		ID:          id,
		UserID:      userID,
		TokenHash:   tokenHash,
		RequestedAt: requestedAt,
		ExpiresAt:   expiresAt,
	}
	return id, nil
}

func (f *fakeRepo) FindResetTokenByHash(_ context.Context, tokenHash string) (*ResetTokenRow, error) {
	row, ok := f.resetByHash[tokenHash]
	if !ok {
		return nil, ErrResetTokenNotFound
	}
	cp := *row
	return &cp, nil
}

func (f *fakeRepo) MarkResetTokenUsed(_ context.Context, id string) error {
	for _, row := range f.resetByHash {
		if row.ID == id && row.UsedAt == nil {
			t := time.Now().UTC()
			row.UsedAt = &t
		}
	}
	return nil
}

func (f *fakeRepo) UpdateEncryptedPassword(_ context.Context, userID, passwordHash string) error {
	row, ok := f.authByID[userID]
	if !ok {
		return ErrAccountMissing
	}
	row.EncryptedPassword = passwordHash
	return nil
}

func (f *fakeRepo) RevokeAllUserRefreshTokens(_ context.Context, userID string) error {
	now := time.Now().UTC()
	for _, row := range f.tokens {
		if row.UserID == userID && row.RevokedAt == nil {
			t := now
			row.RevokedAt = &t
		}
	}
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

// fakeMailer is a Mailer implementation for tests that need
// IsConfigured()=true without actually sending mail.
type fakeMailer struct {
	configured bool
	sent       []struct{ to, subject, body string }
}

func (f *fakeMailer) IsConfigured() bool { return f.configured }

func (f *fakeMailer) Send(to, subject, body string) error {
	f.sent = append(f.sent, struct{ to, subject, body string }{to, subject, body})
	return nil
}

// extractTokenFromURL parses the ?token= param out of a reset URL.
func extractTokenFromURL(t *testing.T, raw string) string {
	t.Helper()
	idx := strings.Index(raw, "token=")
	if idx == -1 {
		t.Fatalf("no token in URL: %q", raw)
	}
	return raw[idx+len("token="):]
}
