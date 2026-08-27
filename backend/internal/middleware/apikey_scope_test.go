package middleware

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Маршрут вне домена архива открывается машинному доступу только гейтом:
// без него перенос под JWTOrAPIKey пустил бы туда любой валидный ключ.

func scopeRouter(scope string) *chi.Mux {
	r := chi.NewRouter()
	r.With(RequireAPIKeyScope(scope, "id")).
		Get("/api/v1/tenders/{id}/positions", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"data":[]}`))
		})
	return r
}

func doScoped(t *testing.T, principal *APIKeyPrincipal, tenderID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/v1/tenders/"+tenderID+"/positions", nil)
	if principal != nil {
		req = req.WithContext(context.WithValue(req.Context(), CtxAPIKey, principal))
	}
	w := httptest.NewRecorder()
	scopeRouter("tenders:read").ServeHTTP(w, req)
	return w
}

func problemCode(t *testing.T, w *httptest.ResponseRecorder) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("ответ не JSON: %s", w.Body.String())
	}
	code, _ := m["code"].(string)
	return code
}

func TestRequireAPIKeyScope_AllowsMatchingScope(t *testing.T) {
	w := doScoped(t, &APIKeyPrincipal{ID: "k1", Scopes: []string{"tenders:read"}}, "t-1")
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
}

func TestRequireAPIKeyScope_RejectsArchiveOnlyKey(t *testing.T) {
	// Ровно тот случай, ради которого гейт и нужен: архивный ключ не должен
	// получать доступ к списку позиций только потому, что маршрут переехал.
	w := doScoped(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"archive:read", "archive:write"},
	}, "t-1")

	if w.Code != 403 {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if got := problemCode(t, w); got != "API_KEY_SCOPE_DENIED" {
		t.Fatalf("code = %q, want API_KEY_SCOPE_DENIED", got)
	}
}

func TestRequireAPIKeyScope_RejectsTenderOutsideKeyList(t *testing.T) {
	w := doScoped(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:read"}, AllowedTenderIDs: []string{"t-other"},
	}, "t-1")

	if w.Code != 403 {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if got := problemCode(t, w); got != "API_KEY_TENDER_DENIED" {
		t.Fatalf("code = %q, want API_KEY_TENDER_DENIED", got)
	}
}

func TestRequireAPIKeyScope_AllowsTenderInKeyList(t *testing.T) {
	w := doScoped(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:read"}, AllowedTenderIDs: []string{"t-1", "t-2"},
	}, "t-1")
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestRequireAPIKeyScope_JWTUserPassesThrough(t *testing.T) {
	// Принципала ключа нет — запрос от человека, области к нему не применяются.
	w := doScoped(t, nil, "t-1")
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200", w.Code)
	}
}

func TestRequireAPIKeyScope_WritesCallLogCode(t *testing.T) {
	stat := &CallStat{}
	req := httptest.NewRequest("GET", "/api/v1/tenders/t-1/positions", nil)
	ctx := context.WithValue(req.Context(), CtxAPIKey,
		&APIKeyPrincipal{ID: "k1", Scopes: []string{"archive:read"}})
	ctx = context.WithValue(ctx, CtxCallStat, stat)
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	scopeRouter("tenders:read").ServeHTTP(w, req)

	if stat.ErrorCode != "API_KEY_SCOPE_DENIED" {
		t.Fatalf("в журнал ушёл код %q", stat.ErrorCode)
	}
}

// Маршрут без id тендера в URL (узкий список тендеров): гейт проверяет только
// область и не должен резать ключ, ограниченный списком тендеров, — фильтр по
// списку применяет хендлер.

func briefRouter() *chi.Mux {
	r := chi.NewRouter()
	r.With(RequireAPIKeyScope("tenders:read", "")).
		Get("/api/v1/tenders/brief", func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"data":[]}`))
		})
	return r
}

func doBrief(t *testing.T, principal *APIKeyPrincipal) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest("GET", "/api/v1/tenders/brief", nil)
	if principal != nil {
		req = req.WithContext(context.WithValue(req.Context(), CtxAPIKey, principal))
	}
	w := httptest.NewRecorder()
	briefRouter().ServeHTTP(w, req)
	return w
}

func TestRequireAPIKeyScope_NoTenderParam_AllowsReadKey(t *testing.T) {
	w := doBrief(t, &APIKeyPrincipal{ID: "k1", Scopes: []string{"tenders:read"}})
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
}

func TestRequireAPIKeyScope_NoTenderParam_RejectsArchiveOnlyKey(t *testing.T) {
	w := doBrief(t, &APIKeyPrincipal{ID: "k1", Scopes: []string{"archive:read", "archive:write"}})
	if w.Code != 403 {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if got := problemCode(t, w); got != "API_KEY_SCOPE_DENIED" {
		t.Fatalf("code = %q, want API_KEY_SCOPE_DENIED", got)
	}
}

func TestRequireAPIKeyScope_NoTenderParam_RestrictedKeyPasses(t *testing.T) {
	// Ограниченный ключ проходит гейт: сужать выборку до своих тендеров —
	// задача хендлера, а не гейта, у которого нет id тендера.
	w := doBrief(t, &APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:read"}, AllowedTenderIDs: []string{"t-1"},
	})
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
}
