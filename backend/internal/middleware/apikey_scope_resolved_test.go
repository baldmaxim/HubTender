package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Маршруты без id тендера в URL (PATCH /items/{id}) — тендер для ограничения
// ключа даёт резолвер. Ошибка резолвера = отказ, а не пропуск.

func resolvedRouter(resolve TenderResolver) *chi.Mux {
	r := chi.NewRouter()
	r.With(RequireAPIKeyScopeResolved("tenders:write", resolve)).
		Patch("/api/v1/items/{id}", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
	return r
}

func doResolved(t *testing.T, principal *APIKeyPrincipal, resolve TenderResolver) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("PATCH", "/api/v1/items/i-1", nil)
	if principal != nil {
		req = req.WithContext(context.WithValue(req.Context(), CtxAPIKey, principal))
	}
	w := httptest.NewRecorder()
	resolvedRouter(resolve).ServeHTTP(w, req)
	return w
}

func TestRequireAPIKeyScopeResolved_AllowsTenderFromResolver(t *testing.T) {
	w := doResolved(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:write"}, AllowedTenderIDs: []string{"t-1"},
	}, func(*http.Request) (string, error) { return "t-1", nil })
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
}

func TestRequireAPIKeyScopeResolved_RejectsTenderFromResolver(t *testing.T) {
	w := doResolved(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:write"}, AllowedTenderIDs: []string{"t-1"},
	}, func(*http.Request) (string, error) { return "t-other", nil })
	if w.Code != 403 || problemCode(t, w) != "API_KEY_TENDER_DENIED" {
		t.Fatalf("status = %d, code = %q", w.Code, problemCode(t, w))
	}
}

func TestRequireAPIKeyScopeResolved_ResolverErrorDenies(t *testing.T) {
	w := doResolved(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:write"}, AllowedTenderIDs: []string{"t-1"},
	}, func(*http.Request) (string, error) { return "", errors.New("no rows") })
	if w.Code != 403 || problemCode(t, w) != "API_KEY_TENDER_DENIED" {
		t.Fatalf("status = %d, code = %q", w.Code, problemCode(t, w))
	}
}

func TestRequireAPIKeyScopeResolved_UnrestrictedKeySkipsResolver(t *testing.T) {
	called := false
	w := doResolved(t, &APIKeyPrincipal{ID: "k1", Scopes: []string{"tenders:write"}},
		func(*http.Request) (string, error) { called = true; return "", errors.New("boom") })
	if w.Code != 200 || called {
		t.Fatalf("status = %d, resolver called = %v", w.Code, called)
	}
}

func TestRequireAPIKeyScopeResolved_ReadOnlyKeyDenied(t *testing.T) {
	w := doResolved(t, &APIKeyPrincipal{ID: "k1", Scopes: []string{"tenders:read"}},
		func(*http.Request) (string, error) { return "t-1", nil })
	if w.Code != 403 || problemCode(t, w) != "API_KEY_SCOPE_DENIED" {
		t.Fatalf("status = %d, code = %q", w.Code, problemCode(t, w))
	}
}
