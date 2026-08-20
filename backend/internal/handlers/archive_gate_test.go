package handlers

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/apikey"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

// Тумблеры и области ключа проверяются ДО обращения к данным: выключенный
// эндпоинт отвечает 503, ключ без области — 403, и ни в том, ни в другом
// случае сервис не дёргается.

type stubGate struct {
	disabled string
	settings *repository.ApiAccessSettings
}

func (g *stubGate) EnsureEndpointEnabled(_ context.Context, endpoint string) error {
	if g.disabled == endpoint {
		return services.ErrEndpointDisabled
	}
	return nil
}

func (g *stubGate) Settings(context.Context) (*repository.ApiAccessSettings, error) {
	if g.settings == nil {
		return &repository.ApiAccessSettings{
			MaxSearchLimit: 200, MaxCandidateLimit: 4000, MaxSuggestQueries: 100,
		}, nil
	}
	return g.settings, nil
}

type recordingArchiveSvc struct {
	stubArchiveSvc
	searchCalled  bool
	composeCalled bool
	lastRequest   services.ArchiveSearchRequest
}

func (s *recordingArchiveSvc) Search(_ context.Context, req services.ArchiveSearchRequest) ([]services.ArchiveSearchHit, error) {
	s.searchCalled = true
	s.lastRequest = req
	return []services.ArchiveSearchHit{}, nil
}

func (s *recordingArchiveSvc) Compose(context.Context, repository.ComposeInput) (*repository.ComposeResult, error) {
	s.composeCalled = true
	return &repository.ComposeResult{}, nil
}

func searchRequest(h *ArchiveHandler, principal *middleware.APIKeyPrincipal, query string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/api/v1/archive/positions/search", h.SearchPositions)

	req := httptest.NewRequest("GET", "/api/v1/archive/positions/search?"+query, nil)
	if principal != nil {
		req = req.WithContext(context.WithValue(req.Context(), middleware.CtxAPIKey, principal))
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestSearchBlockedWhenEndpointDisabled(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{disabled: endpointArchiveSearch})

	w := searchRequest(h, nil, "q=стяжка")
	if w.Code != 503 {
		t.Fatalf("status = %d, want 503 (body %s)", w.Code, w.Body.String())
	}
	if svc.searchCalled {
		t.Fatal("выключенный эндпоинт не должен доходить до сервиса")
	}
}

func TestSearchRejectsKeyWithoutReadScope(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{})

	w := searchRequest(h, &middleware.APIKeyPrincipal{
		ID: "k1", Scopes: []string{apikey.ScopeArchiveWrite},
	}, "q=стяжка")

	if w.Code != 403 {
		t.Fatalf("status = %d, want 403", w.Code)
	}
	if svc.searchCalled {
		t.Fatal("ключ без области не должен доходить до сервиса")
	}
}

func TestSearchAllowsKeyWithReadScope(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{})

	w := searchRequest(h, &middleware.APIKeyPrincipal{
		ID: "k1", Scopes: []string{apikey.ScopeArchiveRead},
	}, "q=стяжка")

	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
	if !svc.searchCalled {
		t.Fatal("сервис должен быть вызван")
	}
}

func TestSearchClampsLimitsToSettings(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{settings: &repository.ApiAccessSettings{
		MaxSearchLimit: 5, MaxCandidateLimit: 100, MaxSuggestQueries: 10,
	}})

	if w := searchRequest(h, nil, "q=стяжка&limit=999&candidate_limit=99999"); w.Code != 200 {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if svc.lastRequest.Limit != 5 {
		t.Fatalf("limit = %d, want 5 (потолок из настроек)", svc.lastRequest.Limit)
	}
	if svc.lastRequest.Filter.CandidateLimit != 100 {
		t.Fatalf("candidate_limit = %d, want 100", svc.lastRequest.Filter.CandidateLimit)
	}
}

func TestComposeRejectsKeyWithoutWriteScope(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{})

	r := chi.NewRouter()
	r.Post("/api/v1/archive/compose", h.Compose)

	req := httptest.NewRequest("POST", "/api/v1/archive/compose", strings.NewReader(composeBody))
	ctx := context.WithValue(req.Context(), middleware.CtxAPIKey, &middleware.APIKeyPrincipal{
		ID: "k1", Scopes: []string{apikey.ScopeArchiveRead},
	})
	ctx = context.WithValue(ctx, middleware.CtxUser,
		&middleware.AuthUser{ID: "44444444-4444-4444-4444-444444444444"})
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
	if svc.composeCalled {
		t.Fatal("ключ без archive:write не должен доходить до сборки")
	}
}

func TestComposeRejectsTenderOutsideKeyScope(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{})

	r := chi.NewRouter()
	r.Post("/api/v1/archive/compose", h.Compose)

	req := httptest.NewRequest("POST", "/api/v1/archive/compose", strings.NewReader(composeBody))
	ctx := context.WithValue(req.Context(), middleware.CtxAPIKey, &middleware.APIKeyPrincipal{
		ID:               "k1",
		Scopes:           []string{apikey.ScopeArchiveWrite},
		AllowedTenderIDs: []string{"99999999-9999-9999-9999-999999999999"},
	})
	ctx = context.WithValue(ctx, middleware.CtxUser,
		&middleware.AuthUser{ID: "44444444-4444-4444-4444-444444444444"})
	req = req.WithContext(ctx)

	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 403 {
		t.Fatalf("status = %d, want 403 (body %s)", w.Code, w.Body.String())
	}
	if svc.composeCalled {
		t.Fatal("тендер вне списка ключа не должен доходить до сборки")
	}
}

func TestJWTUserIsNotLimitedByScopes(t *testing.T) {
	svc := &recordingArchiveSvc{}
	h := NewArchiveHandler(svc, &stubGate{})

	// Принципала ключа нет — значит запрос от человека с JWT.
	if w := searchRequest(h, nil, "q=стяжка"); w.Code != 200 {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if !svc.searchCalled {
		t.Fatal("человек с JWT должен проходить без областей")
	}
}
