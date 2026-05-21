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

func TestParseAuthMode(t *testing.T) {
	cases := map[string]AuthMode{
		"":         AuthModeSupabase,
		"supabase": AuthModeSupabase,
		"SUPABASE": AuthModeSupabase,
		" dual\n ": AuthModeDual,
		"app":      AuthModeApp,
	}
	for in, want := range cases {
		got, err := ParseAuthMode(in)
		if err != nil || got != want {
			t.Fatalf("ParseAuthMode(%q): got=%q err=%v want=%q", in, got, err, want)
		}
	}
	if _, err := ParseAuthMode("nope"); err == nil {
		t.Fatalf("expected error on unknown mode")
	}
}

func TestVerifyToken_App_OK(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		Mode:         AuthModeApp,
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

func TestVerifyToken_App_AcceptedInDualMode(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		Mode:           AuthModeDual,
		AppPublicKey:   &priv.PublicKey,
		AppIssuer:      "https://api.test.local",
		SupabaseIssuer: "https://supabase.io/auth/v1",
	}
	raw := mintAppToken(t, priv, "https://api.test.local", "", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	if _, err := VerifyToken(cfg, raw); err != nil {
		t.Fatalf("dual-mode app verify: %v", err)
	}
}

func TestVerifyToken_App_RejectedInSupabaseMode(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		Mode:           AuthModeSupabase,
		AppPublicKey:   &priv.PublicKey,
		AppIssuer:      "https://api.test.local",
		SupabaseIssuer: "https://supabase.io/auth/v1",
	}
	raw := mintAppToken(t, priv, "https://api.test.local", "", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	if _, err := VerifyToken(cfg, raw); err == nil {
		t.Fatalf("expected rejection of app JWT in supabase mode")
	}
}

func TestVerifyToken_ExpiredFails(t *testing.T) {
	priv := newTestPriv(t)
	cfg := VerifyConfig{
		Mode:         AuthModeApp,
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
		Mode:         AuthModeApp,
		AppPublicKey: &priv.PublicKey,
		AppIssuer:    "https://api.test.local",
	}
	raw := mintAppToken(t, priv, "https://attacker.local", "", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	if _, err := VerifyToken(cfg, raw); err == nil {
		t.Fatalf("expected rejection on wrong issuer")
	}
}

func TestVerifyToken_UnknownIssuerFails(t *testing.T) {
	cfg := VerifyConfig{
		Mode:           AuthModeDual,
		AppIssuer:      "https://api.test.local",
		SupabaseIssuer: "https://supabase.io/auth/v1",
	}
	priv := newTestPriv(t)
	raw := mintAppToken(t, priv, "https://random.local", "", "user-1", "a@b.com", time.Now().Add(5*time.Minute))
	if _, err := VerifyToken(cfg, raw); err == nil {
		t.Fatalf("expected unknown-issuer rejection")
	}
}
