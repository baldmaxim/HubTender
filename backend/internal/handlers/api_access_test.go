package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

// fakeApiAccessSvc реализует только UpdateKey; остальные методы интерфейса
// паникуют при вызове (в этих тестах их быть не должно).
type fakeApiAccessSvc struct {
	apiAccessServicer
	err   error
	calls int
}

func (f *fakeApiAccessSvc) UpdateKey(context.Context, string, services.UpdateApiKeyRequest) (*repository.ApiKeyRow, error) {
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return &repository.ApiKeyRow{ID: "k1", Name: "n", Status: "active"}, nil
}

func updateKeyReq(body string) *http.Request {
	r := httptest.NewRequest(http.MethodPut, "/api/v1/admin/api-access/keys/k1", strings.NewReader(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "k1")
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func TestApiAccessUpdateKey(t *testing.T) {
	const tid = "33333333-3333-3333-3333-333333333333"
	cases := []struct {
		name string
		body string
		err  error
		want int
		call int
	}{
		{"ok", `{"name":"k","scopes":["tenders:read"],"allowed_tender_ids":["` + tid + `"]}`, nil, http.StatusOK, 1},
		{"registry with tenders", `{"name":"k","scopes":["registry:read"],"allowed_tender_ids":["` + tid + `"]}`, nil, http.StatusBadRequest, 0},
		{"no scopes", `{"name":"k","scopes":[]}`, nil, http.StatusBadRequest, 0},
		{"not found", `{"name":"k","scopes":["tenders:read"]}`, repository.ErrApiKeyNotFound, http.StatusNotFound, 1},
		{"revoked", `{"name":"k","scopes":["tenders:read"]}`, repository.ErrApiKeyRevoked, http.StatusConflict, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := &fakeApiAccessSvc{err: tc.err}
			w := httptest.NewRecorder()
			NewApiAccessHandler(svc).UpdateKey(w, updateKeyReq(tc.body))
			if w.Code != tc.want {
				t.Fatalf("status = %d, want %d: %s", w.Code, tc.want, w.Body.String())
			}
			if svc.calls != tc.call {
				t.Fatalf("service calls = %d, want %d", svc.calls, tc.call)
			}
		})
	}
}
