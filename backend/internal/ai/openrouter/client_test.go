package openrouter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// testClient — клиент против httptest fake OpenRouter (§24: реальный внешний
// API в обязательных тестах не используется).
func testClient(t *testing.T, srv *httptest.Server, key string) *Client {
	t.Helper()
	c, err := New(Config{APIKey: key, BaseURL: srv.URL, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// Ретраи без реального сна — тесты быстрые.
	c.sleepFor = func(time.Duration, context.Context) error { return nil }
	return c
}

const keyStatusBody = `{"data":{"label":"sk-or-v1-abc...123","limit":100,"limit_remaining":97.5,
"limit_reset":"monthly","usage":2.5,"usage_daily":0.1,"usage_weekly":0.7,"usage_monthly":2.5,
"byok_usage":0,"byok_usage_daily":0,"byok_usage_weekly":0,"byok_usage_monthly":0,
"is_free_tier":false,"is_management_key":false,"is_provisioning_key":false,
"include_byok_in_limit":true,"creator_user_id":null,"expires_at":null,
"rate_limit":{"requests":-1,"interval":"10s","note":"legacy"}}}`

// 1. API key missing → ErrNotConfigured без сетевого вызова.
func TestClientAPIKeyMissing(t *testing.T) {
	called := int32(0)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
	}))
	defer srv.Close()
	c := testClient(t, srv, "")
	if _, err := c.GetKeyStatus(context.Background()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("want ErrNotConfigured, got %v", err)
	}
	if atomic.LoadInt32(&called) != 0 {
		t.Fatalf("network must not be called without API key")
	}
	if c.Configured() {
		t.Fatalf("Configured() must be false")
	}
}

// 2. Bearer header + маркетинговые заголовки.
func TestClientBearerHeader(t *testing.T) {
	var gotAuth, gotReferer, gotTitle string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotReferer = r.Header.Get("HTTP-Referer")
		gotTitle = r.Header.Get("X-Title")
		_, _ = w.Write([]byte(keyStatusBody))
	}))
	defer srv.Close()
	c, err := New(Config{APIKey: "sk-test", BaseURL: srv.URL, HTTPReferer: "https://tender.example", AppTitle: "HUBTender", Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetKeyStatus(context.Background()); err != nil {
		t.Fatalf("GetKeyStatus: %v", err)
	}
	if gotAuth != "Bearer sk-test" {
		t.Fatalf("Authorization = %q", gotAuth)
	}
	if gotReferer != "https://tender.example" || gotTitle != "HUBTender" {
		t.Fatalf("marketing headers not sent: %q %q", gotReferer, gotTitle)
	}
}

// 3. Key status parsing по официальной схеме.
func TestClientKeyStatusParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/key" {
			t.Errorf("path = %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(keyStatusBody))
	}))
	defer srv.Close()
	ks, err := testClient(t, srv, "sk-test").GetKeyStatus(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if ks.Label != "sk-or-v1-abc...123" || ks.Limit == nil || *ks.Limit != 100 ||
		ks.LimitRemaining == nil || *ks.LimitRemaining != 97.5 ||
		ks.LimitReset == nil || *ks.LimitReset != "monthly" ||
		ks.Usage != 2.5 || ks.UsageDaily != 0.1 || ks.UsageWeekly != 0.7 || ks.UsageMonthly != 2.5 ||
		ks.IsFreeTier || ks.ExpiresAt != nil {
		t.Fatalf("parsed key status mismatch: %+v", ks)
	}
}

func modelJSON(id, prompt, completion string, expiration *string) string {
	exp := "null"
	if expiration != nil {
		exp = fmt.Sprintf("%q", *expiration)
	}
	return fmt.Sprintf(`{
		"id": %q, "canonical_slug": %q, "name": "Model %s", "description": "test model",
		"created": 1700000000, "expiration_date": %s, "context_length": 128000,
		"architecture": {"modality":"text->text","input_modalities":["text"],"output_modalities":["text"],"tokenizer":"Other","instruct_type":null},
		"pricing": {"prompt": %q, "completion": %q, "request": "0"},
		"top_provider": {"context_length": 128000, "max_completion_tokens": 16000, "is_moderated": false},
		"per_request_limits": null,
		"supported_parameters": ["temperature","max_tokens","response_format","structured_outputs"],
		"default_parameters": null, "supported_voices": null, "links": {"details": "x"}
	}`, id, id, id, exp, prompt, completion)
}

// 4. Models/user parsing.
func TestClientModelsParsing(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models/user" {
			t.Errorf("path = %s", r.URL.Path)
		}
		body := `{"data":[` + modelJSON("prov/model-a", "0.000001", "0.000002", nil) + `],"total_count":1,"links":{"next":null}}`
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	models, err := testClient(t, srv, "sk-test").ListUserModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].ID != "prov/model-a" ||
		models[0].Pricing.Prompt != "0.000001" || models[0].Pricing.Completion != "0.000002" ||
		models[0].ContextLength == nil || *models[0].ContextLength != 128000 ||
		models[0].TopProvider.MaxCompletionTokens == nil || *models[0].TopProvider.MaxCompletionTokens != 16000 {
		t.Fatalf("models parsing mismatch: %+v", models)
	}
}

// 5. Models pagination — вторая страница дотягивается по links.next/offset.
func TestClientModelsPagination(t *testing.T) {
	var offsets []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		offset := r.URL.Query().Get("offset")
		offsets = append(offsets, offset)
		if offset == "" {
			next := "/api/v1/models/user?offset=1"
			body := `{"data":[` + modelJSON("prov/model-a", "0", "0", nil) + `],"total_count":2,"links":{"next":"` + next + `"}}`
			_, _ = w.Write([]byte(body))
			return
		}
		body := `{"data":[` + modelJSON("prov/model-b", "0", "0", nil) + `],"total_count":2,"links":{"next":null}}`
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()
	models, err := testClient(t, srv, "sk-test").ListUserModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0].ID != "prov/model-a" || models[1].ID != "prov/model-b" {
		t.Fatalf("pagination mismatch: %+v", models)
	}
	if len(offsets) != 2 || offsets[1] != "1" {
		t.Fatalf("offsets = %v", offsets)
	}
}

// 9-11. Типизация 401/402/429.
func TestClientTypedErrors(t *testing.T) {
	for _, tc := range []struct {
		status int
		want   error
	}{
		{401, ErrUnauthorized},
		{402, ErrPaymentRequired},
		{429, ErrRateLimited},
	} {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(`{"error":{"code":` + fmt.Sprint(tc.status) + `,"message":"secret upstream detail"}}`))
		}))
		c := testClient(t, srv, "sk-test")
		_, err := c.GetKeyStatus(context.Background())
		srv.Close()
		if !errors.Is(err, tc.want) {
			t.Fatalf("status %d: want %v, got %v", tc.status, tc.want, err)
		}
		// Raw upstream body не попадает в error string (§4.7).
		if err != nil && strings.Contains(err.Error(), "secret upstream detail") {
			t.Fatalf("raw provider message leaked: %v", err)
		}
	}
}

// 12+17. 5xx → ErrUnavailable, но один transient retry выполняется.
func TestClientRetryTransientOnce(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&calls, 1) == 1 {
			w.WriteHeader(502)
			return
		}
		_, _ = w.Write([]byte(keyStatusBody))
	}))
	defer srv.Close()
	if _, err := testClient(t, srv, "sk-test").GetKeyStatus(context.Background()); err != nil {
		t.Fatalf("retry should succeed: %v", err)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("calls = %d, want 2 (one retry)", calls)
	}
}

// 12b. Постоянный 5xx → ErrUnavailable и ровно 2 попытки (не больше).
func TestClientPersistent5xx(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.WriteHeader(503)
	}))
	defer srv.Close()
	if _, err := testClient(t, srv, "sk-test").GetKeyStatus(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want ErrUnavailable, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("calls = %d, want exactly 2", calls)
	}
}

// 18. 400/401/402 НЕ ретраятся.
func TestClientNoRetryOnClientErrors(t *testing.T) {
	for _, status := range []int{400, 401, 402, 422} {
		var calls int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			atomic.AddInt32(&calls, 1)
			w.WriteHeader(status)
		}))
		_, err := testClient(t, srv, "sk-test").GetKeyStatus(context.Background())
		srv.Close()
		if err == nil {
			t.Fatalf("status %d: want error", status)
		}
		if atomic.LoadInt32(&calls) != 1 {
			t.Fatalf("status %d: calls = %d, want 1 (no retry)", status, calls)
		}
	}
}

// 11b. 429 с Retry-After, не влезающим в общий таймаут → без retry.
func TestClientRetryAfterBeyondTimeout(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(429)
	}))
	defer srv.Close()
	c := testClient(t, srv, "sk-test") // timeout 5s < 3600s
	if _, err := c.GetKeyStatus(context.Background()); !errors.Is(err, ErrRateLimited) {
		t.Fatalf("want ErrRateLimited, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("calls = %d, want 1 (Retry-After beyond budget)", calls)
	}
}

// 13. Timeout → ошибка (unavailable/deadline), без зависания.
func TestClientTimeout(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer srv.Close()
	c, err := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Timeout: 150 * time.Millisecond})
	if err != nil {
		t.Fatal(err)
	}
	c.sleepFor = func(time.Duration, context.Context) error { return nil }
	start := time.Now()
	_, err = c.GetKeyStatus(context.Background())
	if err == nil {
		t.Fatal("want timeout error")
	}
	if time.Since(start) > 3*time.Second {
		t.Fatalf("timeout not enforced, took %v", time.Since(start))
	}
}

// 14. Context cancellation прерывает вызов немедленно.
func TestClientContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer srv.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(50 * time.Millisecond); cancel() }()
	start := time.Now()
	_, err := testClient(t, srv, "sk-test").GetKeyStatus(ctx)
	if err == nil {
		t.Fatal("want cancellation error")
	}
	if time.Since(start) > time.Second {
		t.Fatalf("cancellation not honored, took %v", time.Since(start))
	}
}

// 15. Response body limit.
func TestClientResponseBodyLimit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"label":"`))
		_, _ = w.Write([]byte(strings.Repeat("a", maxKeyBodyBytes+1024)))
		_, _ = w.Write([]byte(`"}}`))
	}))
	defer srv.Close()
	if _, err := testClient(t, srv, "sk-test").GetKeyStatus(context.Background()); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("want ErrInvalidResponse (body limit), got %v", err)
	}
}

// 16. Redirect отклоняется (в т.ч. на другой host) и не ретраится.
func TestClientRedirectRefused(t *testing.T) {
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("redirect target must never be called")
	}))
	defer evil.Close()
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		http.Redirect(w, r, evil.URL+"/key", http.StatusFound)
	}))
	defer srv.Close()
	_, err := testClient(t, srv, "sk-test").GetKeyStatus(context.Background())
	if err == nil || !strings.Contains(err.Error(), "redirect refused") {
		t.Fatalf("want redirect refusal, got %v", err)
	}
	if atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("redirect must not be retried, calls=%d", calls)
	}
}

// Chat completions: embedded error в 200-теле и пустые choices.
func TestClientChatCompletionInvalid(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"id":"gen-1","model":"m","choices":[],"usage":{"prompt_tokens":1,"completion_tokens":0,"total_tokens":1}}`))
	}))
	defer srv.Close()
	if _, err := testClient(t, srv, "sk-test").CreateChatCompletion(context.Background(), ChatRequest{Model: "m"}); !errors.Is(err, ErrInvalidResponse) {
		t.Fatalf("want ErrInvalidResponse for empty choices, got %v", err)
	}
}

func TestClientChatCompletionOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["model"] != "prov/model-a" {
			t.Errorf("model = %v", req["model"])
		}
		_, _ = w.Write([]byte(`{"id":"gen-1","model":"prov/model-a",
			"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"{\"results\":[]}"}}],
			"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}`))
	}))
	defer srv.Close()
	resp, err := testClient(t, srv, "sk-test").CreateChatCompletion(context.Background(), ChatRequest{Model: "prov/model-a"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Content != `{"results":[]}` || resp.Usage.PromptTokens != 10 || resp.Usage.CompletionTokens != 5 {
		t.Fatalf("chat response mismatch: %+v", resp)
	}
}
