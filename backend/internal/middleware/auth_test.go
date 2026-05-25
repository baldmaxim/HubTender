package middleware

import (
	"crypto/rand"
	"crypto/rsa"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// mintAppToken builds and signs an RS256 token with the supplied iss/aud/exp.
// Used by tests to exercise VerifyToken without dragging in the auth package.
func mintAppToken(t *testing.T, priv *rsa.PrivateKey, iss, aud, sub, email string, exp time.Time) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":   iss,
		"sub":   sub,
		"email": email,
		"iat":   time.Now().Add(-1 * time.Second).Unix(),
		"exp":   exp.Unix(),
	}
	if aud != "" {
		claims["aud"] = aud
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

func newTestPriv(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	p, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	return p
}

func TestVerifyToken_App_OK(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		AppPublicKey: &priv.PublicKey,
		AppIssuer:    "https://api.test.local",
		AppAudience:  "test-aud",
	}
	raw := mintAppToken(t, priv, "https://api.test.local", "test-aud", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	au, err := VerifyToken(cfg, raw)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if au.ID != "user-1" || au.Email != "a@b.com" {
		t.Fatalf("unexpected user: %+v", au)
	}
}

func TestVerifyToken_ExpiredFails(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		AppPublicKey: &priv.PublicKey,
		AppIssuer:    "https://api.test.local",
	}
	raw := mintAppToken(t, priv, "https://api.test.local", "", "user-1", "a@b.com", time.Now().Add(-1*time.Minute))
	if _, err := VerifyToken(cfg, raw); err == nil {
		t.Fatalf("expected expired-token failure")
	}
}

func TestVerifyToken_WrongIssuerFails(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		AppPublicKey: &priv.PublicKey,
		AppIssuer:    "https://api.test.local",
	}
	raw := mintAppToken(t, priv, "https://attacker.local", "", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	if _, err := VerifyToken(cfg, raw); err == nil {
		t.Fatalf("expected rejection on wrong issuer")
	}
}

func TestVerifyToken_MissingPublicKeyFails(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		AppIssuer: "https://api.test.local",
	}
	raw := mintAppToken(t, priv, "https://api.test.local", "", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	if _, err := VerifyToken(cfg, raw); err == nil {
		t.Fatalf("expected failure when AppPublicKey is nil")
	}
}
