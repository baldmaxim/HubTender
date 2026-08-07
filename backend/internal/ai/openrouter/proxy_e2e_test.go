package openrouter

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
)

// Сквозная проверка против ЖИВОГО fake-proxy-llm-server.mjs.
// Пропускается, если сервер не поднят: FAKE_PROXY_URL не задан.
func TestProxyEndToEndAgainstFakeServer(t *testing.T) {
	base := os.Getenv("FAKE_PROXY_URL")
	if base == "" {
		t.Skip("FAKE_PROXY_URL не задан — сквозная проверка пропущена")
	}
	c, err := New(Config{
		APIKey: strings.Repeat("a", 64), BaseURL: base,
		Timeout: 10 * time.Second, Transport: TransportProxyLLM,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := c.ProxyHealth(context.Background()); err != nil {
		t.Fatalf("ProxyHealth: %v", err)
	}
	s := testSettings(ProxyModelID)
	s.ProviderPolicyVersion = ProviderPolicyVersionProxy
	r := NewReranker(c, s)

	resp, _, err := r.RerankWithUsage(context.Background(), simpleBatch())
	if err != nil {
		t.Fatalf("RerankWithUsage: %v", err)
	}
	// Фейк отвергает 400, если нет X-Idempotency-Key или если мы прислали
	// provider/stream — успешный ответ и есть доказательство обоих инвариантов.
	if resp.Status != ainom.ProviderAvailable {
		t.Fatalf("status = %s", resp.Status)
	}
	// Вариант A: ответила ДРУГАЯ модель, дрейф обязан быть виден.
	if resp.Model == ProxyModelID || resp.Model == "" {
		t.Fatalf("фактическая модель обязана отличаться от заглушки, got %q", resp.Model)
	}
	t.Logf("фактическая модель прокси: %s", resp.Model)
}
