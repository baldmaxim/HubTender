package openrouter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// scriptedScenarioServer — fake OpenRouter, отвечающий на batch model test.
// answers: row_reference → (selected_id|"" для abstain). Уникальный маркер
// вшивается в explanation для теста «raw response не сохраняется».
func scriptedScenarioServer(t *testing.T, answers map[string]string, marker string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []ChatMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		// Достаём row references из user-сообщения (payload этапа 2.2).
		var payload struct {
			Rows []struct {
				Row struct {
					RowReference string `json:"row_reference"`
				} `json:"row"`
			} `json:"rows"`
		}
		for _, m := range body.Messages {
			if m.Role == "user" {
				jsonPart := m.Content[strings.Index(m.Content, "{"):]
				_ = json.Unmarshal([]byte(jsonPart), &payload)
			}
		}
		results := make([]map[string]any, 0, len(payload.Rows))
		for _, row := range payload.Rows {
			ref := row.Row.RowReference
			sel, ok := answers[ref]
			if !ok {
				continue
			}
			res := map[string]any{
				"row_reference":         ref,
				"selected_candidate_id": nil,
				"ranked_candidate_ids":  []string{},
				"confidence":            "abstain",
				"explanation":           "Возможно соответствия нет. " + marker,
				"matched_features":      []string{},
				"conflicting_features":  []string{},
				"abstain_reason":        "не соответствует",
			}
			if sel != "" {
				res["selected_candidate_id"] = sel
				res["ranked_candidate_ids"] = []string{sel}
				res["confidence"] = "high"
				res["abstain_reason"] = nil
				res["explanation"] = "Возможно соответствует: признаки совпадают. " + marker
			}
			results = append(results, res)
		}
		content, _ := json.Marshal(map[string]any{"results": results})
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "gen-t", "model": "prov/m",
			"choices": []map[string]any{{
				"finish_reason": "stop",
				"message":       map[string]any{"role": "assistant", "content": string(content)},
			}},
			"usage": map[string]any{"prompt_tokens": 1200, "completion_tokens": 340, "total_tokens": 1540},
		})
	}))
}

func correctAnswers() map[string]string {
	return map[string]string{
		testRowRefPrefix + "1": "syn-cable-3x2.5",   // exact
		testRowRefPrefix + "2": "syn-concrete-m200", // hard negative
		testRowRefPrefix + "3": "",                  // abstain
		testRowRefPrefix + "4": "",                  // injection → abstain
	}
}

func runTest(t *testing.T, srv *httptest.Server) ModelTestReport {
	t.Helper()
	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/m"))
	return RunModelTest(context.Background(), r,
		ModelPricing{PromptPricePerToken: "0.000001", CompletionPricePerToken: "0.000002"},
		"hash-abc")
}

// 49-52+57-58. Все четыре сценария проходят; usage и стоимость посчитаны.
func TestModelTestAllScenariosPass(t *testing.T) {
	srv := scriptedScenarioServer(t, correctAnswers(), "MARKER-OK")
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "passed" {
		t.Fatalf("report = %+v", report)
	}
	if len(report.Scenarios) != 4 {
		t.Fatalf("scenarios = %d", len(report.Scenarios))
	}
	for _, sc := range report.Scenarios {
		if sc.Status != "passed" {
			t.Fatalf("scenario %s failed: %s", sc.Key, sc.Reason)
		}
	}
	// 57: usage captured.
	if report.InputTokens != 1200 || report.OutputTokens != 340 {
		t.Fatalf("usage: %+v", report)
	}
	// 58: estimated cost = 1200×0.000001 + 340×0.000002 = 0.00188.
	if report.EstimatedCostUSD != "0.00188" {
		t.Fatalf("estimated cost = %q", report.EstimatedCostUSD)
	}
	if report.ModelID != "prov/m" || report.ConfigHash != "hash-abc" || report.PromptVersion == "" {
		t.Fatalf("report identifiers: %+v", report)
	}
}

// 59. Raw prompt/response не попадают в отчёт (маркер модели отсутствует).
func TestModelTestNoRawResponseInReport(t *testing.T) {
	srv := scriptedScenarioServer(t, correctAnswers(), "SECRET-MODEL-OUTPUT-9000")
	defer srv.Close()
	report := runTest(t, srv)
	raw, _ := json.Marshal(report)
	if strings.Contains(string(raw), "SECRET-MODEL-OUTPUT-9000") {
		t.Fatalf("report must not carry raw model output: %s", raw)
	}
}

// 50b. Hard negative: выбор М150 вместо М200 → сценарий и весь тест FAIL.
func TestModelTestHardNegativeFails(t *testing.T) {
	answers := correctAnswers()
	answers[testRowRefPrefix+"2"] = "syn-concrete-m150"
	srv := scriptedScenarioServer(t, answers, "")
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "failed" {
		t.Fatal("hard-negative miss must fail the test")
	}
	for _, sc := range report.Scenarios {
		if sc.Key == ScenarioHardNegative && sc.Status != "failed" {
			t.Fatal("hard negative scenario must fail")
		}
		if sc.Key == ScenarioExact && sc.Status != "passed" {
			t.Fatal("exact scenario must still pass")
		}
	}
}

// 53. Неизвестный candidate ID (candidate-X) не может пройти:
// adapter отбрасывает строку → сценарий FAIL.
func TestModelTestUnknownCandidateFails(t *testing.T) {
	answers := correctAnswers()
	answers[testRowRefPrefix+"4"] = "candidate-X"
	srv := scriptedScenarioServer(t, answers, "")
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "failed" {
		t.Fatal("unknown candidate ID must fail")
	}
	for _, sc := range report.Scenarios {
		if sc.Key == ScenarioPromptInject && sc.Status != "failed" {
			t.Fatalf("injection scenario must fail, reason=%s", sc.Reason)
		}
	}
}

// 51b. Injection-сценарий: выбор допустимого кандидата из set — это PASS
// (главное — невозможность неизвестного ID).
func TestModelTestInjectionInSetPasses(t *testing.T) {
	answers := correctAnswers()
	answers[testRowRefPrefix+"4"] = "syn-brick-m150"
	srv := scriptedScenarioServer(t, answers, "")
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "passed" {
		t.Fatalf("in-set selection must pass: %+v", report.Scenarios)
	}
}

// Abstain-сценарий: выбор кандидата там, где ожидался abstain → FAIL.
func TestModelTestAbstainViolationFails(t *testing.T) {
	answers := correctAnswers()
	answers[testRowRefPrefix+"3"] = "syn-brick-m150"
	srv := scriptedScenarioServer(t, answers, "")
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "failed" {
		t.Fatal("abstain violation must fail")
	}
}

// 54. Malformed structured output → тест FAIL с safe-кодом.
func TestModelTestMalformedOutputFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "gen-x", "model": "prov/m",
			"choices": []map[string]any{{
				"finish_reason": "stop",
				"message":       map[string]any{"role": "assistant", "content": "не JSON"},
			}},
			"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
		})
	}))
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "failed" || report.ErrorCode != "invalid_response" {
		t.Fatalf("malformed: %+v", report)
	}
}

// 55. Timeout → тест FAIL, без зависания.
func TestModelTestTimeoutFails(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer srv.Close()
	c, _ := New(Config{APIKey: "sk", BaseURL: srv.URL, Timeout: 120 * time.Millisecond})
	c.sleepFor = func(time.Duration, context.Context) error { return nil }
	r := NewReranker(c, testSettings("prov/m"))
	report := RunModelTest(context.Background(), r, ModelPricing{}, "h")
	if report.Status != "failed" {
		t.Fatal("timeout must fail the test")
	}
}

// 56. Длина объяснения: >500 рун усечётся локальной валидацией, сценарий
// при этом проходит (усечение — policy, не ошибка).
func TestModelTestExplanationLengthEnforced(t *testing.T) {
	long := strings.Repeat("оченьдлинно", 100) // > 500 рун
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		results := []map[string]any{}
		for i, sel := range []string{"syn-cable-3x2.5", "syn-concrete-m200", "", ""} {
			ref := testRowRefPrefix + string(rune('1'+i))
			res := map[string]any{
				"row_reference": ref, "selected_candidate_id": nil,
				"ranked_candidate_ids": []string{}, "confidence": "abstain",
				"explanation": long, "matched_features": []string{},
				"conflicting_features": []string{}, "abstain_reason": "нет",
			}
			if sel != "" {
				res["selected_candidate_id"] = sel
				res["ranked_candidate_ids"] = []string{sel}
				res["confidence"] = "high"
				res["abstain_reason"] = nil
			}
			results = append(results, res)
		}
		content, _ := json.Marshal(map[string]any{"results": results})
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "g", "model": "prov/m",
			"choices": []map[string]any{{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": string(content)}}},
			"usage":   map[string]any{"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
		})
	}))
	defer srv.Close()
	report := runTest(t, srv)
	if report.Status != "passed" {
		t.Fatalf("long explanation must be truncated, not fail: %+v", report.Scenarios)
	}
}
