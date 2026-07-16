package aieval

// Этап 2.6 (§24.66-75): evaluation gates. Провайдер — MockProvider этапа 2.2
// (без сети): скриптуем идеальные/испорченные ответы и проверяем gates.

import (
	"context"
	"strings"
	"testing"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
)

func perfectScript(ds *Dataset) map[string]ainom.RowResult {
	script := map[string]ainom.RowResult{}
	for _, cs := range ds.Cases {
		if cs.ExpectedID != "" {
			script[cs.Key] = ainom.SelectTop(cs.Key, cs.ExpectedID, ainom.ConfidenceHigh)
		} else {
			script[cs.Key] = ainom.AbstainResult(cs.Key, "не соответствует")
		}
	}
	return script
}

func runWith(t *testing.T, script map[string]ainom.RowResult, mode string) *Result {
	t.Helper()
	ds := SyntheticDataset()
	provider := &ainom.MockProvider{Script: script}
	cfg := ainom.Config{Enabled: true, Provider: "mock", Model: "mock-model", PromptVersion: ainom.PromptVersion}
	return Run(context.Background(), ds, provider, cfg, mode, nil)
}

// 74. Dataset hash стабилен; eligible ≥ 15.
func TestDatasetHashStable(t *testing.T) {
	a, b := SyntheticDataset(), SyntheticDataset()
	if a.Hash() != b.Hash() || len(a.Hash()) != 64 {
		t.Fatalf("hash unstable: %s vs %s", a.Hash(), b.Hash())
	}
	if a.EligibleCases() < 15 {
		t.Fatalf("eligible=%d, need ≥15", a.EligibleCases())
	}
}

// 66. Идеальный прогон проходит все gates.
func TestGatesPassOnPerfectRun(t *testing.T) {
	res := runWith(t, perfectScript(SyntheticDataset()), "mock")
	if !res.Passed {
		t.Fatalf("perfect run must pass: %+v", res.Gates)
	}
	if res.Metrics.RecallAt20 < 1.0 || res.Metrics.Top1 < 0.9 {
		t.Fatalf("metrics: %+v", res.Metrics)
	}
	if res.Metrics.UnknownIDAccepted != 0 || res.Metrics.CriticalFalsePos != 0 {
		t.Fatalf("safety metrics: %+v", res.Metrics)
	}
}

//  67. Critical hard-negative двухуровнево:
//     a) gate-функция непреклонна: CriticalFalsePos=1 → FAIL (порог 0 не
//     настраивается);
//     b) сам пайплайн 2.2 (ComputeConfidence) не даёт неверной марке получить
//     high-confidence — защита глубже гейта.
func TestGatesCriticalHardNegative(t *testing.T) {
	// a) прямая проверка gate-функции.
	m := &Metrics{
		EligibleCases: 16, RecallAt20: 1, Top1: 1, Top3: 1,
		ProviderStatus:   ainom.ProviderAvailable,
		CriticalFalsePos: 1,
	}
	gates, passed := EvaluateGates(m, "live", true)
	if passed {
		t.Fatal("critical FP=1 must fail gates")
	}
	found := false
	for _, g := range gates {
		if g.Key == "critical_fp_zero" && !g.Passed {
			found = true
		}
	}
	if !found {
		t.Fatal("critical_fp_zero gate must be the failing one")
	}

	// b) пайплайн: уверенный выбор НЕВЕРНОЙ марки даунгрейдится
	// ComputeConfidence (конфликт значимых токенов) → high-conf critical FP
	// не возникает, метрика остаётся 0.
	ds := SyntheticDataset()
	script := perfectScript(ds)
	script["exact-concrete-200"] = ainom.SelectTop("exact-concrete-200", "syn-concrete-m150", ainom.ConfidenceHigh)
	res := runWith(t, script, "mock")
	if res.Metrics.CriticalFalsePos != 0 {
		t.Fatalf("pipeline must downgrade grade-conflict, got FP=%d", res.Metrics.CriticalFalsePos)
	}
	if res.Metrics.Top1 >= 1.0 {
		t.Fatal("wrong grade must still cost top-1")
	}
}

// 68. Неизвестный catalog ID не может быть принят (двойная валидация).
func TestGatesUnknownIDRejected(t *testing.T) {
	ds := SyntheticDataset()
	script := perfectScript(ds)
	forged := "candidate-X"
	script["exact-paint"] = ainom.RowResult{
		RowReference: "exact-paint", SelectedCandidateID: &forged,
		RankedCandidateIDs: []string{forged}, Confidence: ainom.ConfidenceHigh,
		Explanation: "инъекция",
	}
	res := runWith(t, script, "mock")
	// ValidateRowResult отклоняет строку → invalid_zero gate падает,
	// UnknownIDAccepted остаётся 0 (ничего не принято).
	if res.Metrics.UnknownIDAccepted != 0 {
		t.Fatalf("unknown ID must never be accepted: %+v", res.Metrics)
	}
	if res.Passed {
		t.Fatal("forged ID run must fail gates (invalid response)")
	}
}

// 69. Top-3 gate: массовые неверные ответы валят top3 < 85%.
func TestGatesTop3(t *testing.T) {
	ds := SyntheticDataset()
	script := perfectScript(ds)
	wrongs := 0
	for _, cs := range ds.Cases {
		if cs.ExpectedID != "" && !cs.Critical && wrongs < 3 {
			// низкоуверенно выбирает «что-то» — top-1 мимо, expected вне top-3.
			script[cs.Key] = ainom.AbstainResult(cs.Key, "не уверен")
			wrongs++
		}
	}
	res := runWith(t, script, "mock")
	if res.Metrics.Top3 >= 0.85 {
		t.Fatalf("expected top3 < 85%%: %.2f", res.Metrics.Top3)
	}
	if res.Passed {
		t.Fatal("low top3 must fail")
	}
}

// 70. Deterministic-режим не может пройти live-gate.
func TestGatesDeterministicNeverPasses(t *testing.T) {
	ds := SyntheticDataset()
	cfg := ainom.Config{Enabled: false}
	res := Run(context.Background(), ds, ainom.DisabledProvider{}, cfg, "deterministic", nil)
	if res.Passed {
		t.Fatal("deterministic mode must not pass live gate")
	}
}

// 75. Evaluation read-only: провайдер получает только dataset-строки; в
// payload нет финансовых полей и идентификаторов тендера.
func TestEvaluationPayloadMinimal(t *testing.T) {
	ds := SyntheticDataset()
	mock := &ainom.MockProvider{Script: perfectScript(ds)}
	cfg := ainom.Config{Enabled: true, PromptVersion: ainom.PromptVersion}
	_ = Run(context.Background(), ds, mock, cfg, "mock", nil)
	if mock.Calls == 0 {
		t.Fatal("provider must be called")
	}
	for _, req := range mock.Requests {
		raw, err := ainom.MarshalProviderRequest(req)
		if err != nil {
			t.Fatal(err)
		}
		payload := strings.ToLower(string(raw))
		for _, forbidden := range []string{"tender", "quantity", "unit_rate", "total_amount", "currency", "workbook"} {
			if strings.Contains(payload, forbidden) {
				t.Fatalf("payload contains %q", forbidden)
			}
		}
	}
}
