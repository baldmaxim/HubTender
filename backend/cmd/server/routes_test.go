package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The frontend sends Cache-Control: no-cache on realtime-triggered refetches
// (positions/with-costs); the header is not CORS-safelisted, so the preflight
// must explicitly allow it or the browser blocks the request entirely.
func TestCORSPreflightAllowsCacheControl(t *testing.T) {
	h := corsMiddleware([]string{"http://localhost:5185"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Error("preflight must not reach the next handler")
		}),
	)

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/tenders/x/positions/with-costs", nil)
	req.Header.Set("Origin", "http://localhost:5185")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "cache-control")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if allow := rec.Header().Get("Access-Control-Allow-Headers"); !strings.Contains(allow, "Cache-Control") {
		t.Errorf("Access-Control-Allow-Headers = %q, want Cache-Control included", allow)
	}
	if rec.Header().Get("Access-Control-Max-Age") == "" {
		t.Error("Access-Control-Max-Age not set on preflight")
	}
}

func TestCORSUnknownOriginGetsNoCORSHeaders(t *testing.T) {
	h := corsMiddleware([]string{"http://localhost:5185"})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}),
	)

	req := httptest.NewRequest(http.MethodOptions, "/api/v1/tenders", nil)
	req.Header.Set("Origin", "http://evil.example")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Errorf("Access-Control-Allow-Origin = %q for unknown origin, want empty", got)
	}
}
