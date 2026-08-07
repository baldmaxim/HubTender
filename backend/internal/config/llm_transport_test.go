package config

import (
	"strings"
	"testing"

	"github.com/spf13/viper"
)

const validToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func proxyViper(overrides map[string]any) *viper.Viper {
	v := viper.New()
	v.SetDefault("PROXY_LLM_TIMEOUT_SECONDS", 200)
	v.Set("AI_PROVIDER_MODE", "proxy_llm")
	v.Set("PROXY_LLM_BASE_URL", "https://proxy.example.com")
	v.Set("PROXY_LLM_TOKEN", validToken)
	for k, val := range overrides {
		v.Set(k, val)
	}
	return v
}

// Дефолт — прямой OpenRouter: существующие развёртывания не должны заметить
// появления режимов.
func TestLLMTransportDefaults(t *testing.T) {
	v := viper.New()
	v.SetDefault("PROXY_LLM_TIMEOUT_SECONDS", 200)
	mode, base, token, timeout, err := loadLLMTransport(v, "production")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if mode != "openrouter" || base != "" || token != "" || timeout != 200 {
		t.Fatalf("got %q / %q / token=%v / %d", mode, base, token != "", timeout)
	}
}

func TestLLMTransportProxyHappyPath(t *testing.T) {
	mode, base, token, timeout, err := loadLLMTransport(proxyViper(nil), "production")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if mode != "proxy_llm" || base != "https://proxy.example.com" || token != validToken || timeout != 200 {
		t.Fatalf("got %q / %q / %d", mode, base, timeout)
	}
}

// База в SDK-форме приводится к origin: иначе получим /api/v1/api/v1/…
func TestLLMTransportNormalizesBase(t *testing.T) {
	_, base, _, _, err := loadLLMTransport(
		proxyViper(map[string]any{"PROXY_LLM_BASE_URL": "https://proxy.example.com/api/v1/"}), "production")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if base != "https://proxy.example.com" {
		t.Fatalf("base = %q", base)
	}
}

// Каждая из этих ошибок обязана валить старт, а не деградировать молча.
func TestLLMTransportFailFast(t *testing.T) {
	cases := map[string]struct {
		env    map[string]any
		appEnv string
	}{
		"опечатка в режиме":      {map[string]any{"AI_PROVIDER_MODE": "proxyllm"}, "production"},
		"нет base URL":           {map[string]any{"PROXY_LLM_BASE_URL": ""}, "production"},
		"http в production":      {map[string]any{"PROXY_LLM_BASE_URL": "http://proxy.example.com"}, "production"},
		"короткий токен":         {map[string]any{"PROXY_LLM_TOKEN": "deadbeef"}, "production"},
		"токен не hex":           {map[string]any{"PROXY_LLM_TOKEN": strings.Repeat("z", 64)}, "production"},
		"ключ OpenRouter вместо": {map[string]any{"PROXY_LLM_TOKEN": "sk-or-v1-" + strings.Repeat("a", 40)}, "production"},
		"таймаут вне диапазона":  {map[string]any{"PROXY_LLM_TIMEOUT_SECONDS": 5000}, "production"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, _, _, _, err := loadLLMTransport(proxyViper(tc.env), tc.appEnv)
			if err == nil {
				t.Fatal("ожидалась ошибка старта")
			}
			// Значение токена не должно протекать в текст ошибки.
			if tok, ok := tc.env["PROXY_LLM_TOKEN"].(string); ok && len(tok) > 8 &&
				strings.Contains(err.Error(), tok) {
				t.Fatalf("токен протёк в ошибку: %v", err)
			}
		})
	}
}

// Вне production http допустим — fake-сервер readiness-тестов.
func TestLLMTransportAllowsHTTPOutsideProduction(t *testing.T) {
	_, base, _, _, err := loadLLMTransport(
		proxyViper(map[string]any{"PROXY_LLM_BASE_URL": "http://127.0.0.1:8391"}), "development")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if base != "http://127.0.0.1:8391" {
		t.Fatalf("base = %q", base)
	}
}
