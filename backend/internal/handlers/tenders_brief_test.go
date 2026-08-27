package handlers

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Ограничение ключа по тендерам для списка без {id} в URL применяет хендлер:
// гейт здесь проверяет только область, и без фильтра ограниченный ключ увидел
// бы все тендеры портала.

type stubBriefSvc struct {
	lastParams repository.TenderBriefParams
	called     bool
	rows       []repository.TenderBriefRow
}

func (s *stubBriefSvc) ListTendersBrief(_ context.Context, p repository.TenderBriefParams) ([]repository.TenderBriefRow, error) {
	s.called = true
	s.lastParams = p
	return s.rows, nil
}

func briefRequest(svc *stubBriefSvc, principal *middleware.APIKeyPrincipal, query string) *httptest.ResponseRecorder {
	r := chi.NewRouter()
	r.Get("/api/v1/tenders/brief", NewTenderBriefHandler(svc).List)

	req := httptest.NewRequest("GET", "/api/v1/tenders/brief?"+query, nil)
	if principal != nil {
		req = req.WithContext(context.WithValue(req.Context(), middleware.CtxAPIKey, principal))
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestTenderBrief_RestrictedKeyNarrowsToAllowedTenders(t *testing.T) {
	svc := &stubBriefSvc{}
	w := briefRequest(svc, &middleware.APIKeyPrincipal{
		ID: "k1", Scopes: []string{"tenders:read"}, AllowedTenderIDs: []string{"t-1", "t-2"},
	}, "")

	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
	if got := svc.lastParams.IDs; len(got) != 2 || got[0] != "t-1" || got[1] != "t-2" {
		t.Fatalf("в выборку должен уйти список тендеров ключа, получено %#v", got)
	}
}

func TestTenderBrief_UnrestrictedKeySeesAll(t *testing.T) {
	svc := &stubBriefSvc{}
	briefRequest(svc, &middleware.APIKeyPrincipal{ID: "k1", Scopes: []string{"tenders:read"}}, "")

	if len(svc.lastParams.IDs) != 0 {
		t.Fatalf("ключ без ограничения не должен фильтровать по id, получено %#v", svc.lastParams.IDs)
	}
}

func TestTenderBrief_JWTUserSeesAll(t *testing.T) {
	svc := &stubBriefSvc{}
	briefRequest(svc, nil, "search=%D0%B6%D0%BA&is_archived=false")

	if len(svc.lastParams.IDs) != 0 {
		t.Fatalf("человек с JWT не ограничен списком тендеров, получено %#v", svc.lastParams.IDs)
	}
	if svc.lastParams.Search != "жк" {
		t.Fatalf("search = %q, want жк", svc.lastParams.Search)
	}
	if svc.lastParams.IsArchived == nil || *svc.lastParams.IsArchived {
		t.Fatalf("is_archived=false должен дойти до выборки, получено %#v", svc.lastParams.IsArchived)
	}
}

func TestTenderBrief_BadArchivedFlag(t *testing.T) {
	svc := &stubBriefSvc{}
	w := briefRequest(svc, nil, "is_archived=maybe")

	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if svc.called {
		t.Fatal("при невалидном фильтре сервис дёргаться не должен")
	}
}

func TestTenderBrief_EmptyListIsArray(t *testing.T) {
	w := briefRequest(&stubBriefSvc{}, nil, "")

	if !strings.Contains(w.Body.String(), `"data":[]`) {
		t.Fatalf("пустой список должен быть [] а не null: %s", w.Body.String())
	}
}
