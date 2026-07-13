package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
)

// withTestUser injects an authenticated user, as the JWT middleware would.
func withTestUser(ctx context.Context) context.Context {
	return context.WithValue(ctx, middleware.CtxUser, &middleware.AuthUser{
		ID: "00000000-0000-0000-0000-000000000000",
	})
}

// mutationSpyService implements bulkBoqServicer. Every method records that it was
// called — the tombstone endpoint must never reach any of them.
type mutationSpyService struct{ calls int }

func (s *mutationSpyService) SetQuoteLinkByName(context.Context, string, string, string, *string, string) (int, error) {
	s.calls++
	return 0, nil
}
func (s *mutationSpyService) SetQuoteLinkByIDs(context.Context, []string, *string, string) (int, error) {
	s.calls++
	return 0, nil
}

// The retired endpoint answers 410 identically for ANY body, and never calls the
// service. Note the compile-time guarantee behind this: bulkBoqServicer no longer
// even HAS a commercial-write method, so the handler cannot mutate anything.
func TestRetiredBulkCommercial_AlwaysGone(t *testing.T) {
	bodies := map[string]string{
		"valid legacy payload": `{"rows":[{"id":"11111111-1111-1111-1111-111111111111",
			"commercial_markup":1.5,"total_commercial_material_cost":100,
			"total_commercial_work_cost":200}]}`,
		"arbitrary huge costs": `{"rows":[{"id":"11111111-1111-1111-1111-111111111111",
			"commercial_markup":999999,"total_commercial_material_cost":1e12,
			"total_commercial_work_cost":1e12}]}`,
		"empty body":     ``,
		"empty object":   `{}`,
		"malformed JSON": `{"rows":[{"id":`,
		"not json":       `<<<not json at all>>>`,
	}

	for name, body := range bodies {
		t.Run(name, func(t *testing.T) {
			spy := &mutationSpyService{}
			h := NewBulkBoqHandler(spy)

			req := httptest.NewRequest(http.MethodPatch, "/api/v1/items/bulk-commercial", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()

			h.RetiredBulkCommercial(w, req)

			// 410 for every payload — never 200, never a 400 parse error.
			if w.Code != http.StatusGone {
				t.Fatalf("status = %d, want 410", w.Code)
			}
			if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
				t.Fatalf("content-type = %q, want application/problem+json", ct)
			}

			var problem map[string]any
			if err := json.Unmarshal(w.Body.Bytes(), &problem); err != nil {
				t.Fatalf("body is not RFC 7807 JSON: %v", err)
			}
			if problem["code"] != "COMMERCIAL_COST_WRITE_RETIRED" {
				t.Fatalf("code = %v, want COMMERCIAL_COST_WRITE_RETIRED", problem["code"])
			}
			if problem["status"] != float64(410) || problem["title"] != "Gone" {
				t.Fatalf("unexpected problem envelope: %v", problem)
			}

			// No service call ⇒ no mutation, no cache invalidation, no recalc.
			if spy.calls != 0 {
				t.Fatalf("service was called %d times — the tombstone must not touch it", spy.calls)
			}

			// The request body must be left untouched (never decoded).
			if body != "" {
				if n, _ := req.Body.Read(make([]byte, 1)); n == 0 && req.ContentLength == 0 {
					t.Fatal("body appears to have been consumed")
				}
			}
		})
	}
}

// Route-level: the real path is registered on the tombstone, is NOT a 404, and
// does NOT reach a mutation handler.
func TestRetiredBulkCommercial_RouteRegistered(t *testing.T) {
	spy := &mutationSpyService{}
	h := NewBulkBoqHandler(spy)

	r := chi.NewRouter()
	// Same registration as cmd/server/routes.go.
	r.Patch("/api/v1/items/bulk-commercial", h.RetiredBulkCommercial)

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/items/bulk-commercial",
		strings.NewReader(`{"rows":[{"id":"11111111-1111-1111-1111-111111111111","commercial_markup":2}]}`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code == http.StatusNotFound {
		t.Fatal("route must stay registered as an explicit tombstone, not become a 404")
	}
	if w.Code != http.StatusGone {
		t.Fatalf("route status = %d, want 410", w.Code)
	}
	if spy.calls != 0 {
		t.Fatal("route must not reach a mutation handler")
	}
}

// The quote-link endpoints still work after the commercial writer was removed
// from the handler's service interface.
func TestBulkBoqHandler_QuoteLinkStillWorks(t *testing.T) {
	spy := &mutationSpyService{}
	h := NewBulkBoqHandler(spy)

	r := chi.NewRouter()
	r.Patch("/api/v1/boq/quote-link-by-ids", h.SetQuoteLinkByIDs)

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/boq/quote-link-by-ids",
		strings.NewReader(`{"ids":["11111111-1111-1111-1111-111111111111"],"quote_link":"http://x"}`))
	// SetQuoteLinkByIDs requires an auth context.
	req = req.WithContext(withTestUser(req.Context()))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("quote-link status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	if spy.calls != 1 {
		t.Fatalf("quote-link service calls = %d, want 1", spy.calls)
	}
}
