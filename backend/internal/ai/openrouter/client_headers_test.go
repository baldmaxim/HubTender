package openrouter

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// Трассировка и дедуп: X-Idempotency-Key и X-Request-Id (SKILL §5).
//
// Инвариант, ради которого всё это существует: при ретрае одной задачи
// idempotency-ключ обязан СОВПАДАТЬ (иначе повтор уходит upstream новым платным
// вызовом), а request-id обязан РАЗЛИЧАТЬСЯ (иначе две попытки неразличимы
// в трассировке).

// recordingServer — фиксирует заголовки каждой попытки. Первые failures
// ответов отдаёт status, дальше — 200 с телом body.
func recordingServer(t *testing.T, failures int, status int, retryAfter string, body string) (*httptest.Server, *[]http.Header) {
	t.Helper()
	var mu sync.Mutex
	var seen []http.Header
	n := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.Header.Clone())
		attempt := n
		n++
		mu.Unlock()
		if attempt < failures {
			if retryAfter != "" {
				w.Header().Set("Retry-After", retryAfter)
			}
			w.WriteHeader(status)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	return srv, &seen
}

// 17. Ретрай сохраняет idempotency-ключ и меняет request-id.
func TestClientIdempotencyKeyStableAcrossRetry(t *testing.T) {
	srv, seen := recordingServer(t, 1, 503, "1", chatBodyOK)
	defer srv.Close()

	c := testClient(t, srv, "sk-test")
	if _, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model:          "prov/m",
		Messages:       []ChatMessage{{Role: "user", Content: "ping"}},
		IdempotencyKey: "task-abc",
	}); err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}

	got := *seen
	if len(got) != 2 {
		t.Fatalf("want 2 attempts (503 → retry → 200), got %d", len(got))
	}
	if a, b := got[0].Get("X-Idempotency-Key"), got[1].Get("X-Idempotency-Key"); a != "task-abc" || b != "task-abc" {
		t.Fatalf("idempotency key must be identical across attempts: %q vs %q", a, b)
	}
	a, b := got[0].Get("X-Request-Id"), got[1].Get("X-Request-Id")
	if a == "" || b == "" {
		t.Fatalf("X-Request-Id must be set on every attempt: %q / %q", a, b)
	}
	if a == b {
		t.Fatalf("X-Request-Id must differ per attempt, both = %q", a)
	}
	if len(a) > 128 {
		t.Fatalf("X-Request-Id must be ≤128 chars, got %d", len(a))
	}
}

// 18. Пустой ключ → заголовок не отправляется (прямой OpenRouter не требует его).
func TestClientNoIdempotencyHeaderWhenUnset(t *testing.T) {
	srv, seen := recordingServer(t, 0, 200, "", chatBodyOK)
	defer srv.Close()

	c := testClient(t, srv, "sk-test")
	if _, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: "prov/m", Messages: []ChatMessage{{Role: "user", Content: "ping"}},
	}); err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if v, ok := (*seen)[0]["X-Idempotency-Key"]; ok {
		t.Fatalf("header must be absent when key is empty, got %v", v)
	}
}

// 19. Retry-After уважается на 503, а не только на 429 (прокси шлёт его при
// queue_full / dedup_full).
//
// Пауза намеренно меньше таймаута клиента (5 с): при большей срабатывает
// отдельный guard «retry не влезает в дедлайн» — см. TestClientRetryAfterBeyondTimeout.
// В проде прокси шлёт Retry-After: 10, поэтому таймаут обязан быть с запасом.
func TestClientRetryAfterHonoredOn503(t *testing.T) {
	srv, seen := recordingServer(t, 1, 503, "2", chatBodyOK)
	defer srv.Close()

	c := testClient(t, srv, "sk-test")
	var slept time.Duration
	c.sleepFor = func(d time.Duration, _ context.Context) error { slept = d; return nil }

	if _, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: "prov/m", Messages: []ChatMessage{{Role: "user", Content: "ping"}},
	}); err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if len(*seen) != 2 {
		t.Fatalf("503 must be retried, attempts = %d", len(*seen))
	}
	if slept != 2*time.Second {
		t.Fatalf("Retry-After: 2 must drive the backoff, slept %v", slept)
	}
}

// 20. Ответные id прокси доезжают до ChatResponse (сверка биллинга).
func TestClientCapturesProxyResponseIDs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("x-proxy-request-id", "px-42")
		w.Header().Set("x-openrouter-request-id", "gen-99")
		_, _ = w.Write([]byte(chatBodyOK))
	}))
	defer srv.Close()

	c := testClient(t, srv, "sk-test")
	resp, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: "prov/m", Messages: []ChatMessage{{Role: "user", Content: "ping"}},
	})
	if err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if resp.ProxyRequestID != "px-42" || resp.UpstreamRequestID != "gen-99" {
		t.Fatalf("proxy ids not captured: %q / %q", resp.ProxyRequestID, resp.UpstreamRequestID)
	}
}

// 21. 413 payload_too_large не ретраится (детерминированный отказ, §7 SKILL).
func TestClientNoRetryOn413(t *testing.T) {
	srv, seen := recordingServer(t, 5, 413, "", chatBodyOK)
	defer srv.Close()

	c := testClient(t, srv, "sk-test")
	if _, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: "prov/m", Messages: []ChatMessage{{Role: "user", Content: "ping"}},
	}); err == nil {
		t.Fatal("want error on 413")
	}
	if len(*seen) != 1 {
		t.Fatalf("413 must not be retried, attempts = %d", len(*seen))
	}
}

const chatBodyOK = `{"id":"gen-1","model":"prov/m","choices":[{"finish_reason":"stop",
"message":{"role":"assistant","content":"\"ok\""}}],
"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`
