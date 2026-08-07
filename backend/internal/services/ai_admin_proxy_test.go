package services

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
)

// Режим proxy_llm в админке. Ключевой инвариант: у прокси НЕТ GET /key и
// GET /models/user, поэтому гейты, требовавшие view.Key != nil, обязаны
// пропускать вызов по достижимости прокси — иначе пилот не стартует никогда.

const proxyTestToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// newProxyAIAdmin — сервис в proxy-режиме против fake-прокси.
// Возвращает счётчики обращений к отсутствующим у прокси эндпоинтам.
func newProxyAIAdmin(t *testing.T, healthStatus int) (*AIAdminService, *fakeAIStore, *int32) {
	t.Helper()
	var forbidden int32
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(healthStatus)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	// Любое обращение к /key или /models/user — ошибка реализации, а не 404.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if strings.Contains(r.URL.Path, "/key") || strings.Contains(r.URL.Path, "/models") {
			atomic.AddInt32(&forbidden, 1)
		}
		w.WriteHeader(404)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client, err := openrouter.New(openrouter.Config{
		APIKey: proxyTestToken, BaseURL: srv.URL,
		Timeout: 5 * time.Second, Transport: openrouter.TransportProxyLLM,
	})
	if err != nil {
		t.Fatal(err)
	}
	store := newFakeAIStore()
	svc := NewAIAdminService(client, openrouter.NewCatalogCache(openrouter.ProxyCatalogLister{}, time.Minute), store)
	return svc, store, &forbidden
}

// Статус подключения строится из /healthz; лимиты ключа остаются пустыми.
func TestProxyStatusUsesHealthz(t *testing.T) {
	svc, _, forbidden := newProxyAIAdmin(t, 200)

	view := svc.Status(context.Background())
	if view.ProviderMode != "proxy_llm" {
		t.Fatalf("provider_mode = %q", view.ProviderMode)
	}
	if view.Connection != "connected" {
		t.Fatalf("connection = %q", view.Connection)
	}
	if view.Key != nil {
		t.Fatal("лимиты ключа в proxy-режиме неизвестны — Key обязан быть nil")
	}
	if view.Proxy == nil || view.Proxy.Health != "ok" || view.Proxy.HealthCheckedAt == nil {
		t.Fatalf("proxy status = %+v", view.Proxy)
	}
	if view.Proxy.LimitsKnown {
		t.Fatal("limits_known обязан быть false: бюджетом ключа владеет оператор прокси")
	}
	if atomic.LoadInt32(forbidden) != 0 {
		t.Fatalf("отсутствующие у прокси эндпоинты не должны вызываться, вызовов %d", *forbidden)
	}
}

// Недоступный прокси → connection unavailable, а не «connected без лимитов».
func TestProxyStatusUnreachable(t *testing.T) {
	svc, _, _ := newProxyAIAdmin(t, 503)

	view := svc.Status(context.Background())
	if view.Connection == "connected" {
		t.Fatalf("недоступный прокси не может быть connected: %+v", view)
	}
	if view.Proxy == nil || view.Proxy.Health != "unreachable" {
		t.Fatalf("proxy health = %+v", view.Proxy)
	}
}

// Главный гейт: без правки он возвращал provider_unavailable на каждом вызове,
// потому что требовал view.Key != nil, которого в proxy-режиме не бывает.
func TestProxyKeyLimitGatePasses(t *testing.T) {
	svc, _, _ := newProxyAIAdmin(t, 200)

	if denial := svc.keyLimitGate(context.Background(), "0.05"); denial != "" {
		t.Fatalf("гейт обязан пропускать при живом прокси, получено %q", denial)
	}
}

// Недоступный прокси гейт обязан по-прежнему закрывать (fail-safe сохраняется).
func TestProxyKeyLimitGateFailsWhenUnreachable(t *testing.T) {
	svc, _, _ := newProxyAIAdmin(t, 500)

	if denial := svc.keyLimitGate(context.Background(), "0.05"); denial != AICapProviderUnavail {
		t.Fatalf("недоступный прокси обязан закрывать гейт, получено %q", denial)
	}
}

// Гейт перехода в пилот: не удалён, а сведён к достижимости прокси.
func TestProxyKeyRemainingHealthy(t *testing.T) {
	svc, _, _ := newProxyAIAdmin(t, 200)

	ok, detail := svc.keyRemainingHealthy(context.Background())
	if !ok {
		t.Fatalf("гейт обязан проходить при живом прокси: %q", detail)
	}
	if !strings.Contains(detail, "оператор") {
		t.Fatalf("detail обязан объяснять, почему лимиты неизвестны: %q", detail)
	}

	down, _, _ := newProxyAIAdmin(t, 500)
	if ok, _ := down.keyRemainingHealthy(context.Background()); ok {
		t.Fatal("недоступный прокси обязан закрывать гейт перехода")
	}
}

// UI-ключ в proxy-режиме не сохраняется: клиент его игнорирует, и «ключ
// сохранён» при неработающем провайдере — худший из возможных ответов.
func TestProxySetAPIKeyRejected(t *testing.T) {
	svc, _, _ := newProxyAIAdmin(t, 200)
	svc.WithKeyManagement(&fakeKeyStore{}, nil, NewAIKeyResolver(nil, nil), true)

	_, err := svc.SetAPIKey(context.Background(), "sk-or-v1-"+strings.Repeat("a", 40), "actor")
	if err != ErrAIKeyProxyModeUnsupported {
		t.Fatalf("want ErrAIKeyProxyModeUnsupported, got %v", err)
	}
}

// Синтетический каталог доезжает до admin-представления как обычный каталог:
// radio-выбор и валидация model ID через FindModel продолжают работать.
func TestProxyCatalogViewIsSynthetic(t *testing.T) {
	svc, _, forbidden := newProxyAIAdmin(t, 200)

	view := svc.Models(context.Background(), false)
	if view.TotalCount != 1 {
		t.Fatalf("ожидалась ровно одна псевдо-модель, получено %d", view.TotalCount)
	}
	if view.Models[0].ID != openrouter.ProxyModelID {
		t.Fatalf("model ID = %q", view.Models[0].ID)
	}
	if view.Models[0].PricePer1MInputTokens != "" {
		t.Fatal("цена неизвестна и обязана остаться пустой, а не правдоподобной")
	}
	if atomic.LoadInt32(forbidden) != 0 {
		t.Fatal("каталог не должен ходить в сеть в proxy-режиме")
	}
}
