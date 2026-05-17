package auth

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Issuer mints access and refresh tokens. It is stateless — refresh-token
// persistence (rotation, revocation) is a repository concern; here we only
// generate opaque random values and let the caller hash+store them.
type Issuer struct {
	key        *SigningKey
	issuer     string        // iss claim, e.g. "https://api.tenderhub.ru"
	audience   string        // aud claim, e.g. "tenderhub-frontend"
	accessTTL  time.Duration // typically 15m
	refreshTTL time.Duration // typically 30d
}

// IssuerConfig holds the knobs needed to construct an Issuer.
type IssuerConfig struct {
	SigningKey *SigningKey
	Issuer     string
	Audience   string
	AccessTTL  time.Duration
	RefreshTTL time.Duration
}

// NewIssuer validates the config and returns a ready-to-use issuer.
func NewIssuer(cfg IssuerConfig) (*Issuer, error) {
	if cfg.SigningKey == nil || cfg.SigningKey.Private == nil {
		return nil, errors.New("auth: SigningKey is required")
	}
	if cfg.Issuer == "" {
		return nil, errors.New("auth: Issuer is required")
	}
	if cfg.AccessTTL <= 0 {
		cfg.AccessTTL = 15 * time.Minute
	}
	if cfg.RefreshTTL <= 0 {
		cfg.RefreshTTL = 30 * 24 * time.Hour
	}
	return &Issuer{
		key:        cfg.SigningKey,
		issuer:     cfg.Issuer,
		audience:   cfg.Audience,
		accessTTL:  cfg.AccessTTL,
		refreshTTL: cfg.RefreshTTL,
	}, nil
}

// AccessClaims is the payload of an issued access token. Field names match
// the legacy Supabase JWT shape so the existing JWTAuth middleware (which
// reads `sub` and `email`) does not need to change.
type AccessClaims struct {
	Email string `json:"email,omitempty"`
	Role  string `json:"role,omitempty"` // public.users.role_code, e.g. "administrator"
	jwt.RegisteredClaims
}

// IssuedAccess is the public result of IssueAccessToken — the signed string
// plus the absolute expiry the frontend uses to schedule a pre-emptive refresh.
type IssuedAccess struct {
	Token     string
	ExpiresAt time.Time
}

// IssueAccessToken signs a fresh RS256 access JWT for a user. userID becomes
// the `sub` claim and must match the UUID stored in public.users.id.
func (i *Issuer) IssueAccessToken(userID, email, role string) (IssuedAccess, error) {
	if userID == "" {
		return IssuedAccess{}, errors.New("auth: userID is empty")
	}

	now := time.Now().UTC()
	exp := now.Add(i.accessTTL)

	claims := AccessClaims{
		Email: email,
		Role:  role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    i.issuer,
			Subject:   userID,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	if i.audience != "" {
		claims.Audience = jwt.ClaimStrings{i.audience}
	}

	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = i.key.KID

	signed, err := tok.SignedString(i.key.Private)
	if err != nil {
		return IssuedAccess{}, fmt.Errorf("auth: sign access token: %w", err)
	}
	return IssuedAccess{Token: signed, ExpiresAt: exp}, nil
}

// IssuedRefresh carries the raw opaque token returned to the client and the
// expiry the repository should write to refresh_tokens.expires_at. The token
// is 256 bits of CSPRNG entropy, base64url-encoded — long enough that an
// attacker cannot guess it but short enough to ride in an HttpOnly cookie.
type IssuedRefresh struct {
	Token     string
	ExpiresAt time.Time
}

// IssueRefreshToken returns a fresh opaque refresh token. The caller is
// responsible for hashing it (SHA-256) before persisting to the database —
// we never store raw refresh tokens, so a DB leak does not let an attacker
// resume sessions.
func (i *Issuer) IssueRefreshToken() (IssuedRefresh, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return IssuedRefresh{}, fmt.Errorf("auth: refresh randomness: %w", err)
	}
	tok := base64.RawURLEncoding.EncodeToString(b[:])
	return IssuedRefresh{
		Token:     tok,
		ExpiresAt: time.Now().UTC().Add(i.refreshTTL),
	}, nil
}

// AccessTTL exposes the configured access-token lifetime so handlers can
// surface it to the client (`expires_in` in the login response body).
func (i *Issuer) AccessTTL() time.Duration { return i.accessTTL }

// SigningKey returns the active key — handlers that serve JWKS need it.
func (i *Issuer) SigningKey() *SigningKey { return i.key }
