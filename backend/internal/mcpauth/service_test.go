package mcpauth

import (
	"crypto/sha256"
	"encoding/base64"
	"regexp"
	"testing"

	"github.com/su10/hubtender/backend/internal/domain/user"
)

func TestValidateRedirectURI(t *testing.T) {
	good := []string{"https://agent.example/callback", "http://127.0.0.1:43210/callback", "http://localhost:8080/callback"}
	for _, raw := range good {
		if err := validateRedirectURI(raw); err != nil {
			t.Errorf("%s rejected: %v", raw, err)
		}
	}
	bad := []string{"http://public.example/callback", "https://user:pass@example.com/cb", "https://example.com/cb#fragment", "/relative"}
	for _, raw := range bad {
		if err := validateRedirectURI(raw); err == nil {
			t.Errorf("%s should be rejected", raw)
		}
	}
}

func TestVerifyPKCES256(t *testing.T) {
	verifier := "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	if !verifyPKCE(verifier, challenge) {
		t.Fatal("valid PKCE verifier rejected")
	}
	if verifyPKCE(verifier, "wrong") {
		t.Fatal("invalid PKCE verifier accepted")
	}
}

func TestAllowedScopesTemplateWriteRoleGate(t *testing.T) {
	engineer := &user.User{RoleCode: "engineer", AllowedPages: []string{"/positions", "/library/templates"}}
	if contains(allowedScopes(engineer), ScopeTemplatesWrite) {
		t.Fatal("engineer must not receive templates:write")
	}
	lead := &user.User{RoleCode: "veduschiy_inzhener", AllowedPages: []string{"/positions", "/library/templates"}}
	if !contains(allowedScopes(lead), ScopeTemplatesWrite) {
		t.Fatal("leading engineer should receive templates:write")
	}
}

func TestRandomUUIDShape(t *testing.T) {
	id, err := randomUUID()
	if err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id) {
		t.Fatalf("bad UUID: %s", id)
	}
}
func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
