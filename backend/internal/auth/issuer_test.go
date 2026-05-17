package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// generateTestKey returns a 2048-bit RSA key encoded as PKCS#8 PEM. 2048
// keeps tests fast (~50 ms) — production should use 4096 in JWT_PRIVATE_KEY_PEM.
func generateTestKey(t *testing.T) []byte {
	t.Helper()
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA: %v", err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal PKCS8: %v", err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
}

func newTestIssuer(t *testing.T) *Issuer {
	t.Helper()
	key, err := LoadSigningKey(generateTestKey(t))
	if err != nil {
		t.Fatalf("LoadSigningKey: %v", err)
	}
	iss, err := NewIssuer(IssuerConfig{
		SigningKey: key,
		Issuer:     "https://api.test.local",
		Audience:   "test-frontend",
		AccessTTL:  10 * time.Minute,
		RefreshTTL: 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewIssuer: %v", err)
	}
	return iss
}

func TestLoadSigningKey_RejectsShortKey(t *testing.T) {
	priv, _ := rsa.GenerateKey(rand.Reader, 1024)
	der, _ := x509.MarshalPKCS8PrivateKey(priv)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	if _, err := LoadSigningKey(pemBytes); err == nil {
		t.Fatal("expected error for 1024-bit key")
	}
}

func TestIssueAccessToken_VerifiesWithJWKS(t *testing.T) {
	iss := newTestIssuer(t)
	access, err := iss.IssueAccessToken(
		"00000000-0000-0000-0000-000000000001",
		"alice@example.com",
		"administrator",
	)
	if err != nil {
		t.Fatalf("IssueAccessToken: %v", err)
	}

	// Parse the issued token using only the public key — this is what every
	// JWKS consumer (the JWTAuth middleware, third-party services) does.
	pub := &iss.key.Private.PublicKey
	tok, err := jwt.ParseWithClaims(access.Token, &AccessClaims{}, func(t *jwt.Token) (any, error) {
		if t.Method.Alg() != jwt.SigningMethodRS256.Alg() {
			t.Header = nil // make the failure obvious in the error
			return nil, jwt.ErrSignatureInvalid
		}
		return pub, nil
	})
	if err != nil {
		t.Fatalf("ParseWithClaims: %v", err)
	}
	if !tok.Valid {
		t.Fatal("token marked invalid")
	}

	got := tok.Claims.(*AccessClaims)
	if got.Subject != "00000000-0000-0000-0000-000000000001" {
		t.Errorf("sub = %q", got.Subject)
	}
	if got.Email != "alice@example.com" {
		t.Errorf("email = %q", got.Email)
	}
	if got.Role != "administrator" {
		t.Errorf("role = %q", got.Role)
	}
	if got.Issuer != "https://api.test.local" {
		t.Errorf("iss = %q", got.Issuer)
	}
	if len(got.Audience) == 0 || got.Audience[0] != "test-frontend" {
		t.Errorf("aud = %v", got.Audience)
	}
	if kid, _ := tok.Header["kid"].(string); kid != iss.key.KID {
		t.Errorf("kid header = %q, want %q", kid, iss.key.KID)
	}
}

func TestIssueRefreshToken_OpaqueAndUnique(t *testing.T) {
	iss := newTestIssuer(t)
	a, _ := iss.IssueRefreshToken()
	b, _ := iss.IssueRefreshToken()

	if a.Token == b.Token {
		t.Fatal("refresh tokens collided")
	}
	if len(a.Token) < 40 {
		t.Fatalf("refresh token too short: %d chars", len(a.Token))
	}
	// base64url encoding of 32 bytes = 43 chars without padding.
	if strings.ContainsRune(a.Token, '=') {
		t.Errorf("expected raw base64url (no padding): %q", a.Token)
	}
	if a.ExpiresAt.Before(time.Now().UTC()) {
		t.Errorf("expiry must be in the future, got %v", a.ExpiresAt)
	}
}

func TestPublicJWKS_ContainsActiveKid(t *testing.T) {
	iss := newTestIssuer(t)
	jwks := iss.SigningKey().PublicJWKS()
	if len(jwks.Keys) != 1 {
		t.Fatalf("expected 1 key, got %d", len(jwks.Keys))
	}
	k := jwks.Keys[0]
	if k.Kid != iss.key.KID || k.Alg != "RS256" || k.Use != "sig" || k.Kty != "RSA" {
		t.Errorf("unexpected JWK fields: %+v", k)
	}
	if k.N == "" || k.E == "" {
		t.Error("JWK is missing modulus/exponent")
	}
}
