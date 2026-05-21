package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func newTestHandler(t *testing.T, repo *fakeRepo) *Handler {
	t.Helper()
	return NewHandler(newTestService(t, repo))
}

func doJSON(t *testing.T, h http.Handler, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode: %v", err)
		}
	}
	r := httptest.NewRequest(method, target, &buf)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestHandler_Login_OK(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	h := newTestHandler(t, repo)

	w := doJSON(t, http.HandlerFunc(h.Login), http.MethodPost, "/api/v1/auth/login", LoginRequest{Email: "a@b.com", Password: "password1"})
	if w.Code != http.StatusOK {
		t.Fatalf("status: %d, body=%s", w.Code, w.Body.String())
	}
	var got AuthResult
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.AccessToken == "" || got.RefreshToken == "" {
		t.Fatalf("missing tokens in response")
	}
	if got.TokenType != "Bearer" {
		t.Fatalf("expected token_type=Bearer, got %q", got.TokenType)
	}
	if got.User.ID != "u1" {
		t.Fatalf("expected user_id=u1, got %q", got.User.ID)
	}
}

func TestHandler_Login_InvalidCredentials_Returns401(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	h := newTestHandler(t, repo)

	w := doJSON(t, http.HandlerFunc(h.Login), http.MethodPost, "/api/v1/auth/login", LoginRequest{Email: "a@b.com", Password: "wrong"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d, body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Login_Blocked_Returns403(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	repo.pub["u1"].AccessStatus = "pending"
	h := newTestHandler(t, repo)

	w := doJSON(t, http.HandlerFunc(h.Login), http.MethodPost, "/api/v1/auth/login", LoginRequest{Email: "a@b.com", Password: "password1"})
	if w.Code != http.StatusForbidden {
		t.Fatalf("status: %d, body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Refresh_OK(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	svc := newTestService(t, repo)
	h := NewHandler(svc)
	login, err := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})
	if err != nil {
		t.Fatalf("Login: %v", err)
	}

	w := doJSON(t, http.HandlerFunc(h.Refresh), http.MethodPost, "/api/v1/auth/refresh", RefreshRequest{RefreshToken: login.RefreshToken})
	if w.Code != http.StatusOK {
		t.Fatalf("status: %d, body=%s", w.Code, w.Body.String())
	}
	var got AuthResult
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.RefreshToken == login.RefreshToken {
		t.Fatalf("expected rotated refresh token")
	}
}

func TestHandler_Refresh_Unknown_Returns401(t *testing.T) {
	repo := newFakeRepo()
	h := newTestHandler(t, repo)
	w := doJSON(t, http.HandlerFunc(h.Refresh), http.MethodPost, "/api/v1/auth/refresh", RefreshRequest{RefreshToken: "not-issued"})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d, body=%s", w.Code, w.Body.String())
	}
}

func TestHandler_Logout_AlwaysNoContent(t *testing.T) {
	repo := newFakeRepo()
	seedUser(t, repo, "u1", "a@b.com", "password1")
	svc := newTestService(t, repo)
	h := NewHandler(svc)
	login, _ := svc.Login(context.Background(), "a@b.com", "password1", SessionContext{})

	for _, body := range []any{
		LogoutRequest{RefreshToken: login.RefreshToken},
		LogoutRequest{RefreshToken: "unknown"},
		LogoutRequest{},
	} {
		w := doJSON(t, http.HandlerFunc(h.Logout), http.MethodPost, "/api/v1/auth/logout", body)
		if w.Code != http.StatusNoContent {
			t.Fatalf("expected 204, got %d body=%s", w.Code, w.Body.String())
		}
	}
}

func TestHandler_JWKS_ServesPublicKey(t *testing.T) {
	repo := newFakeRepo()
	h := newTestHandler(t, repo)
	r := httptest.NewRequest(http.MethodGet, "/.well-known/jwks.json", nil)
	w := httptest.NewRecorder()
	h.JWKS(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status: %d", w.Code)
	}
	var set JWKSet
	if err := json.Unmarshal(w.Body.Bytes(), &set); err != nil {
		t.Fatalf("decode jwks: %v", err)
	}
	if len(set.Keys) != 1 {
		t.Fatalf("expected one key, got %d", len(set.Keys))
	}
	k := set.Keys[0]
	if k.Kty != "RSA" || k.Alg != "RS256" || k.Kid == "" || k.N == "" || k.E == "" {
		t.Fatalf("malformed jwk: %+v", k)
	}
}
