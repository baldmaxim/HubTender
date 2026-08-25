package main

import (
	"bytes"
	"compress/gzip"
	"io"
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

// Крупные агрегаты (positions/with-costs на 11 тыс. позиций — ~10 МБ) обязаны
// уезжать сжатыми: без gzip тело не укладывается в клиентский таймаут apiFetch,
// и страница «Позиции заказчика» рисует пустую таблицу поверх залитых данных.
func TestAPICompressGzipsLargeJSON(t *testing.T) {
	body := bytes.Repeat([]byte(`{"work_name":"Кладка стен из газобетона"},`), 20_000)
	h := apiCompressMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/x/positions/with-costs", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if got := rec.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if rec.Body.Len() >= len(body)/4 {
		t.Errorf("compressed body = %d bytes, want well under a quarter of %d", rec.Body.Len(), len(body))
	}

	zr, err := gzip.NewReader(rec.Body)
	if err != nil {
		t.Fatalf("gzip.NewReader: %v", err)
	}
	got, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	if !bytes.Equal(got, body) {
		t.Error("decompressed body differs from the handler output")
	}
}

// renderJSON отдаёт 304 без Content-Type — middleware не должен вешать на такой
// ответ Content-Encoding: тела нет, а заголовок ломал бы условные запросы.
func TestAPICompressLeavesNotModifiedAlone(t *testing.T) {
	h := apiCompressMiddleware()(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("ETag", `"deadbeef"`)
		w.WriteHeader(http.StatusNotModified)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNotModified)
	}
	if got := rec.Header().Get("Content-Encoding"); got != "" {
		t.Errorf("Content-Encoding = %q on 304, want empty", got)
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
