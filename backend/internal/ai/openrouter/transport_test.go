package openrouter

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 1. Дефолт транспорта — openrouter, и поведение прежнее. Существующие вызовы
// New(Config{…}) без Transport не должны заметить появления режимов.
func TestTransportDefaultsToOpenRouter(t *testing.T) {
	c, err := New(Config{APIKey: "sk-test"})
	if err != nil {
		t.Fatal(err)
	}
	if c.Transport() != TransportOpenRouter {
		t.Fatalf("default transport = %q", c.Transport())
	}
	if c.baseURL.String() != DefaultBaseURL {
		t.Fatalf("default base = %q", c.baseURL.String())
	}
	p := c.Transport().profile()
	if !p.supportsKeyAPI || !p.supportsCatalog || !p.sendProvider ||
		p.requireIdempotencyKey || !p.sendVendorHeaders || !p.allowUIKey {
		t.Fatalf("openrouter profile changed: %+v", p)
	}
}

func TestParseTransport(t *testing.T) {
	for _, in := range []string{"", "openrouter", " OpenRouter "} {
		if got, err := ParseTransport(in); err != nil || got != TransportOpenRouter {
			t.Fatalf("ParseTransport(%q) = %q, %v", in, got, err)
		}
	}
	if got, err := ParseTransport("proxy_llm"); err != nil || got != TransportProxyLLM {
		t.Fatalf("ParseTransport(proxy_llm) = %q, %v", got, err)
	}
	// Опечатка обязана быть громкой: молчаливый откат на openrouter означал бы
	// вызовы в сеть, которой у прод-хоста нет.
	if _, err := ParseTransport("proxyllm"); err == nil {
		t.Fatal("unknown transport must be rejected")
	}
}

// 2. Нормализация базы: origin и SDK-форма с /api/v1 дают один и тот же
// chat-URL, без /api/v1/api/v1.
func TestNormalizeProxyBaseURL(t *testing.T) {
	for _, in := range []string{
		"https://p.example.com", "https://p.example.com/",
		"https://p.example.com/api/v1", "https://p.example.com/api/v1/",
	} {
		got, err := NormalizeProxyBaseURL(in, true)
		if err != nil {
			t.Fatalf("NormalizeProxyBaseURL(%q): %v", in, err)
		}
		if got != "https://p.example.com" {
			t.Fatalf("NormalizeProxyBaseURL(%q) = %q", in, got)
		}
	}

	for name, in := range map[string]string{
		"пустая":            "",
		"без host":          "https://",
		"http в production": "http://p.example.com",
		"с креденшелами":    "https://user:pw@p.example.com",
		"с query":           "https://p.example.com?a=1",
		"чужой путь":        "https://p.example.com/v2",
		"чужая схема":       "ftp://p.example.com",
	} {
		if _, err := NormalizeProxyBaseURL(in, true); err == nil {
			t.Fatalf("%s (%q) должна отвергаться", name, in)
		}
	}
	// Вне production http допустим — fake-сервер в тестах.
	if _, err := NormalizeProxyBaseURL("http://127.0.0.1:8391", false); err != nil {
		t.Fatalf("http вне production: %v", err)
	}
}

// 3. В proxy-режиме chat уходит на <origin>/api/v1/chat/completions.
func TestProxyChatPath(t *testing.T) {
	var gotPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(chatBodyOK))
	}))
	defer srv.Close()

	c := proxyClient(t, srv)
	if _, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: ProxyModelID, Messages: []ChatMessage{{Role: "user", Content: "ping"}},
		IdempotencyKey: "k",
	}); err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if gotPath != "/api/v1/chat/completions" {
		t.Fatalf("chat path = %q", gotPath)
	}
}

// 4. Отсутствующие у прокси эндпоинты не зовутся по сети вообще.
func TestProxyUnsupportedEndpoints(t *testing.T) {
	called := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
	}))
	defer srv.Close()
	c := proxyClient(t, srv)

	if _, err := c.GetKeyStatus(context.Background()); !errors.Is(err, ErrEndpointUnsupported) {
		t.Fatalf("GetKeyStatus: want ErrEndpointUnsupported, got %v", err)
	}
	if _, err := c.ListUserModels(context.Background()); !errors.Is(err, ErrEndpointUnsupported) {
		t.Fatalf("ListUserModels: want ErrEndpointUnsupported, got %v", err)
	}
	if called != 0 {
		t.Fatalf("сеть не должна вызываться, вызовов %d", called)
	}
}

// 5. Без idempotency-ключа chat в proxy-режиме не уходит вовсе: ретраи есть,
// и молчаливый вызов без ключа оплачивался бы дважды на каждом повторе.
func TestProxyRequiresIdempotencyKey(t *testing.T) {
	called := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
	}))
	defer srv.Close()

	c := proxyClient(t, srv)
	_, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: ProxyModelID, Messages: []ChatMessage{{Role: "user", Content: "ping"}},
	})
	if !errors.Is(err, ErrIdempotencyKeyRequired) {
		t.Fatalf("want ErrIdempotencyKeyRequired, got %v", err)
	}
	if called != 0 {
		t.Fatalf("сеть не должна вызываться, вызовов %d", called)
	}
}

// 6. provider и маркетинговые заголовки в proxy-режиме не отправляются:
// прокси их вырезает, а отправка маскировала бы потерю privacy-гарантии.
func TestProxyOmitsProviderAndVendorHeaders(t *testing.T) {
	var body string
	var referer, title string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := make([]byte, 4096)
		n, _ := r.Body.Read(b)
		body = string(b[:n])
		referer, title = r.Header.Get("HTTP-Referer"), r.Header.Get("X-Title")
		_, _ = w.Write([]byte(chatBodyOK))
	}))
	defer srv.Close()

	c, err := New(Config{
		APIKey: strings.Repeat("a", 64), BaseURL: srv.URL, Timeout: 5 * time.Second,
		Transport: TransportProxyLLM, HTTPReferer: "https://tender.example", AppTitle: "HUBTender",
	})
	if err != nil {
		t.Fatal(err)
	}
	c.sleepFor = func(time.Duration, context.Context) error { return nil }

	zdr := true
	if _, err := c.CreateChatCompletion(context.Background(), ChatRequest{
		Model: ProxyModelID, Messages: []ChatMessage{{Role: "user", Content: "ping"}},
		Provider: &ProviderPrefs{DataCollection: "deny", ZDR: &zdr}, IdempotencyKey: "k",
	}); err != nil {
		t.Fatalf("CreateChatCompletion: %v", err)
	}
	if strings.Contains(body, `"provider"`) {
		t.Fatalf("provider должен быть вырезан на нашей стороне: %s", body)
	}
	if referer != "" || title != "" {
		t.Fatalf("маркетинговые заголовки OpenRouter не для прокси: %q / %q", referer, title)
	}
}

// 7. 504 → ProviderTimeout, но остаётся ErrUnavailable для существующих веток.
func TestUpstreamTimeoutWrapsUnavailable(t *testing.T) {
	if !errors.Is(ErrUpstreamTimeout, ErrUnavailable) {
		t.Fatal("ErrUpstreamTimeout обязан оборачивать ErrUnavailable")
	}
	if got := classifyHTTPStatus(504); !errors.Is(got, ErrUpstreamTimeout) {
		t.Fatalf("classifyHTTPStatus(504) = %v", got)
	}
	if got := StatusCode(ErrUpstreamTimeout); got != "unavailable" {
		t.Fatalf("StatusCode должен остаться стабильным для админки, got %q", got)
	}
}

// 8. 502 в proxy-режиме не ретраится (upstream_response_too_large — отказ
// детерминированный), в openrouter-режиме — ретраится как прежде.
func TestProxyDoesNotRetry502(t *testing.T) {
	for _, tc := range []struct {
		name  string
		mode  Transport
		want  int
		idKey string
	}{
		{"proxy не ретраит", TransportProxyLLM, 1, "k"},
		{"openrouter ретраит", TransportOpenRouter, 2, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(502)
			}))
			defer srv.Close()
			c, err := New(Config{APIKey: "sk-test", BaseURL: srv.URL, Timeout: 5 * time.Second, Transport: tc.mode})
			if err != nil {
				t.Fatal(err)
			}
			c.sleepFor = func(time.Duration, context.Context) error { return nil }
			_, _ = c.CreateChatCompletion(context.Background(), ChatRequest{
				Model: "m", Messages: []ChatMessage{{Role: "user", Content: "x"}}, IdempotencyKey: tc.idKey,
			})
			if calls != tc.want {
				t.Fatalf("attempts = %d, want %d", calls, tc.want)
			}
		})
	}
}

// 9. Синтетический каталог проходит существующий контур фильтрации без правок
// и не выглядит ни router-моделью, ни free-вариантом.
func TestProxySyntheticCatalog(t *testing.T) {
	raw, err := ProxyCatalogLister{}.ListUserModels(context.Background())
	if err != nil || len(raw) != 1 {
		t.Fatalf("ListUserModels = %v, %v", raw, err)
	}
	models := FilterCatalog(raw, time.Now())
	if len(models) != 1 {
		t.Fatalf("FilterCatalog отбросил синтетическую модель: %+v", models)
	}
	m := models[0]
	if m.ID != ProxyModelID {
		t.Fatalf("model ID = %q", m.ID)
	}
	if m.IsFreeVariant {
		t.Fatal("пустые цены не должны читаться как free-вариант")
	}
	// Вендорного префикса быть не должно: на нём срабатывает CI-гвард,
	// запрещающий хардкод слагов моделей.
	if strings.Contains(m.ID, "/") {
		t.Fatalf("заглушка не должна выглядеть слагом модели: %q", m.ID)
	}
	if m.PricePer1MInputTokens != "" || m.ContextLength != nil {
		t.Fatalf("неизвестные параметры обязаны остаться пустыми: %+v", m)
	}
}

// proxyClient — клиент в proxy-режиме против httptest.
func proxyClient(t *testing.T, srv *httptest.Server) *Client {
	t.Helper()
	c, err := New(Config{
		APIKey: strings.Repeat("a", 64), BaseURL: srv.URL,
		Timeout: 5 * time.Second, Transport: TransportProxyLLM,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	c.sleepFor = func(time.Duration, context.Context) error { return nil }
	return c
}
