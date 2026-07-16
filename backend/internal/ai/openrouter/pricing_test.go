package openrouter

import (
	"strings"
	"testing"
)

// 6+28. Decimal-safe цены: за токен → за 1M без binary-float дрейфа.
func TestPricePer1M(t *testing.T) {
	cases := map[string]string{
		"0.0000015":    "1.5",
		"0.000001":     "1",
		"0.00000055":   "0.55",
		"0":            "0",
		"0.000003":     "3",
		"0.0000000001": "0.0001",
		// binary float дал бы 2.9999999… — decimal-путь обязан дать ровно 3.
		"0.000000005": "0.005",
	}
	for in, want := range cases {
		if got := PricePer1M(in); got != want {
			t.Fatalf("PricePer1M(%q) = %q, want %q", in, got, want)
		}
	}
}

// 29. Мусор/NaN/Inf/экспоненты не превращаются в числа.
func TestPricePer1MRejectsGarbage(t *testing.T) {
	for _, in := range []string{"", "NaN", "Inf", "-Inf", "1e-6", "0x1p-3", "abc", "1.2.3", "--1", "1/2"} {
		if got := PricePer1M(in); got != "" {
			t.Fatalf("PricePer1M(%q) = %q, want empty", in, got)
		}
	}
	// Валидные отрицательные (router-цены) парсятся, но помечаются.
	if !isNegativePrice("-1") || isNegativePrice("0.5") {
		t.Fatal("isNegativePrice misclassified")
	}
	if !isZeroPrice("0") || !isZeroPrice("0.000") || isZeroPrice("0.1") {
		t.Fatal("isZeroPrice misclassified")
	}
}

// 58. Оценка стоимости теста: точная decimal-арифметика.
func TestEstimateCostUSD(t *testing.T) {
	// 1000 input × 0.000001 + 500 output × 0.000002 = 0.001 + 0.001 = 0.002
	cost, ok := EstimateCostUSD("0.000001", "0.000002", "", 1000, 500)
	if !ok || cost != "0.002" {
		t.Fatalf("cost = %q ok=%v", cost, ok)
	}
	// + request price
	cost, ok = EstimateCostUSD("0.000001", "0.000002", "0.0005", 1000, 500)
	if !ok || cost != "0.0025" {
		t.Fatalf("cost with request = %q ok=%v", cost, ok)
	}
	if _, ok := EstimateCostUSD("garbage", "0.1", "", 1, 1); ok {
		t.Fatal("garbage prices must not produce cost")
	}
}

// 33-36. Config hash: стабильность и чувствительность к значимым параметрам.
func TestConfigHash(t *testing.T) {
	base := ConfigHashInput{
		ModelID:                "prov/a",
		PromptVersion:          "nomenclature-rerank-v1",
		SchemaVersion:          SchemaVersion,
		ProviderPolicyVersion:  ProviderPolicyVersion,
		RequireZDR:             true,
		DataCollectionPolicy:   "deny",
		RequireParameters:      true,
		AllowProviderFallbacks: false,
		Temperature:            0,
		MaxOutputTokens:        2000,
		AdapterVersion:         AdapterVersion,
	}
	h1 := ComputeConfigHash(base)
	h2 := ComputeConfigHash(base)
	if h1 != h2 || len(h1) != 64 {
		t.Fatalf("hash must be stable sha256 hex: %q vs %q", h1, h2)
	}

	mut := base
	mut.ModelID = "prov/b"
	if ComputeConfigHash(mut) == h1 {
		t.Fatal("hash must change with model ID")
	}
	mut = base
	mut.PromptVersion = "nomenclature-rerank-v2"
	if ComputeConfigHash(mut) == h1 {
		t.Fatal("hash must change with prompt version")
	}
	mut = base
	mut.RequireZDR = false
	if ComputeConfigHash(mut) == h1 {
		t.Fatal("hash must change with ZDR policy")
	}
	mut = base
	mut.AllowProviderFallbacks = true
	if ComputeConfigHash(mut) == h1 {
		t.Fatal("hash must change with fallback policy")
	}
	mut = base
	mut.Temperature = 0.5
	if ComputeConfigHash(mut) == h1 {
		t.Fatal("hash must change with temperature")
	}
	mut = base
	mut.MaxOutputTokens = 4000
	if ComputeConfigHash(mut) == h1 {
		t.Fatal("hash must change with max output tokens")
	}

	if p := HashPrefix(h1); len(p) != 12 || !strings.HasPrefix(h1, p) {
		t.Fatalf("HashPrefix = %q", p)
	}
}
