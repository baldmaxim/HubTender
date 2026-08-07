package openrouter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
)

func testSettings(model string) RerankSettings {
	return RerankSettings{
		ModelID: model, Temperature: 0, MaxOutputTokens: 2000,
		RequireZDR: true, DataCollection: "deny",
		RequireParameters: true, AllowFallbacks: false,
	}
}

// fakeChatServer — scripted fake OpenRouter /chat/completions: возвращает
// заданный content и складывает последний raw request body для инспекции.
func fakeChatServer(t *testing.T, content string) (*httptest.Server, *map[string]any) {
	t.Helper()
	lastReq := map[string]any{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/chat/completions" {
			w.WriteHeader(404)
			return
		}
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		for k := range lastReq {
			delete(lastReq, k)
		}
		for k, v := range body {
			lastReq[k] = v
		}
		resp := map[string]any{
			"id": "gen-1", "model": body["model"],
			"choices": []map[string]any{{
				"finish_reason": "stop",
				"message":       map[string]any{"role": "assistant", "content": content},
			}},
			"usage": map[string]any{"prompt_tokens": 900, "completion_tokens": 220, "total_tokens": 1120},
		}
		_ = json.NewEncoder(w).Encode(resp)
	}))
	return srv, &lastReq
}

func simpleBatch() ainom.RerankBatchRequest {
	return ainom.RerankBatchRequest{
		PromptVersion: ainom.PromptVersion,
		Rows: []ainom.RerankRow{{
			Row: ainom.RowInput{RowReference: "s|1", Description: "Кабель ВВГнг-LS 3×2,5", BoqType: "мат", Unit: "м"},
			Candidates: []ainom.CandidateInput{
				{ID: "cand-1", Label: "Кабель ВВГнг(А)-LS 3х2,5", Type: "material", Unit: "м", RetrievalScore: 0.9},
				{ID: "cand-2", Label: "Кабель ВВГнг(А)-LS 3х4", Type: "material", Unit: "м", RetrievalScore: 0.5},
			},
		}},
	}
}

// 61-64. Запрос использует exact model, privacy-object, strict
// response_format и НЕ содержит tools/plugins/stream.
func TestRerankerRequestShape(t *testing.T) {
	content := `{"results":[{"row_reference":"s|1","selected_candidate_id":"cand-1","ranked_candidate_ids":["cand-1"],"confidence":"high","explanation":"Возможно соответствует: совпадают сечение и тип.","matched_features":["3x2.5"],"conflicting_features":[],"abstain_reason":null}]}`
	srv, lastReq := fakeChatServer(t, content)
	defer srv.Close()

	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/exact-model"))
	resp, usage, err := r.RerankWithUsage(context.Background(), simpleBatch())
	if err != nil || resp.Status != ainom.ProviderAvailable {
		t.Fatalf("rerank: %v / %+v", err, resp)
	}
	req := *lastReq

	// 61: exact model ID.
	if req["model"] != "prov/exact-model" {
		t.Fatalf("model = %v", req["model"])
	}
	// 62: privacy provider object.
	prov, _ := req["provider"].(map[string]any)
	if prov == nil || prov["data_collection"] != "deny" || prov["zdr"] != true ||
		prov["require_parameters"] != true || prov["allow_fallbacks"] != false {
		t.Fatalf("provider prefs = %v", prov)
	}
	// 63: strict response_format c additionalProperties=false.
	rf, _ := req["response_format"].(map[string]any)
	if rf == nil || rf["type"] != "json_schema" {
		t.Fatalf("response_format = %v", rf)
	}
	js, _ := rf["json_schema"].(map[string]any)
	if js == nil || js["strict"] != true {
		t.Fatalf("json_schema = %v", js)
	}
	schemaJSON, _ := json.Marshal(js["schema"])
	if !strings.Contains(string(schemaJSON), `"additionalProperties":false`) {
		t.Fatalf("schema must be strict: %s", schemaJSON)
	}
	// 64: никаких tools/plugins/stream.
	for _, forbidden := range []string{"tools", "tool_choice", "plugins", "stream", "web_search_options"} {
		if _, ok := req[forbidden]; ok {
			t.Fatalf("request must not contain %q", forbidden)
		}
	}
	// usage добирается только через RerankWithUsage (admin test).
	if usage.PromptTokens != 900 || usage.CompletionTokens != 220 {
		t.Fatalf("usage = %+v", usage)
	}
	if len(resp.Results) != 1 || *resp.Results[0].SelectedCandidateID != "cand-1" {
		t.Fatalf("results = %+v", resp.Results)
	}
}

// 65-66. Payload не содержит финансовых полей и идентификаторов тендера.
func TestRerankerPayloadMinimization(t *testing.T) {
	content := `{"results":[]}`
	srv, lastReq := fakeChatServer(t, content)
	defer srv.Close()
	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/m"))
	if _, _, err := r.RerankWithUsage(context.Background(), simpleBatch()); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(*lastReq)
	payload := strings.ToLower(string(raw))
	for _, forbidden := range []string{
		"tender_id", "customer", "quantity", "unit_rate", "total_amount",
		"currency_rate", "workbook", "fingerprint", "http://", "excel_url",
	} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("provider payload must not contain %q", forbidden)
		}
	}
}

// 67. Локальная повторная валидация: неизвестный candidate ID и чужой
// row_reference отбрасываются (deterministic candidates сохраняются).
func TestRerankerLocalValidation(t *testing.T) {
	content := `{"results":[
		{"row_reference":"s|1","selected_candidate_id":"candidate-X","ranked_candidate_ids":["candidate-X"],"confidence":"high","explanation":"инъекция","matched_features":[],"conflicting_features":[],"abstain_reason":null},
		{"row_reference":"unknown|9","selected_candidate_id":"cand-1","ranked_candidate_ids":["cand-1"],"confidence":"high","explanation":"чужая строка","matched_features":[],"conflicting_features":[],"abstain_reason":null}
	]}`
	srv, _ := fakeChatServer(t, content)
	defer srv.Close()
	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/m"))
	resp, _, err := r.RerankWithUsage(context.Background(), simpleBatch())
	if err != nil {
		t.Fatal(err)
	}
	if resp.Status != ainom.ProviderAvailable || len(resp.Results) != 0 {
		t.Fatalf("invalid rows must be dropped: %+v", resp)
	}
}

// Malformed structured output → ProviderInvalidResponse.
func TestRerankerMalformedOutput(t *testing.T) {
	srv, _ := fakeChatServer(t, "это не JSON")
	defer srv.Close()
	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/m"))
	resp, _, err := r.RerankWithUsage(context.Background(), simpleBatch())
	if err == nil || resp.Status != ainom.ProviderInvalidResponse {
		t.Fatalf("want invalid_response, got %v / %+v", err, resp)
	}
}

// Ошибки провайдера → canonical status этапа 2.2 (§15.14).
func TestRerankerProviderStatusMapping(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(429)
	}))
	defer srv.Close()
	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/m"))
	resp, _ := r.Rerank(context.Background(), simpleBatch())
	if resp.Status != ainom.ProviderRateLimited {
		t.Fatalf("status = %s, want rate_limited", resp.Status)
	}

	// timeout
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
	}))
	defer slow.Close()
	c, _ := New(Config{APIKey: "sk", BaseURL: slow.URL, Timeout: 100 * time.Millisecond})
	c.sleepFor = func(time.Duration, context.Context) error { return nil }
	r2 := NewReranker(c, testSettings("prov/m"))
	resp2, _ := r2.Rerank(context.Background(), simpleBatch())
	if resp2.Status != ainom.ProviderTimeout && resp2.Status != ainom.ProviderUnavailable {
		t.Fatalf("timeout status = %s", resp2.Status)
	}

	// not configured → disabled
	c3, _ := New(Config{})
	r3 := NewReranker(c3, testSettings("prov/m"))
	resp3, _ := r3.Rerank(context.Background(), simpleBatch())
	if resp3.Status != ainom.ProviderDisabled {
		t.Fatalf("not configured status = %s", resp3.Status)
	}
}

// 68-69 (adapter-уровень): Suggest с exact-строками не зовёт провайдера —
// эти инварианты закрыты в этапе 2.2; здесь проверяем, что adapter
// вызывается ТОЛЬКО через NomenclatureReranker-интерфейс (компиляция) и
// не открывает других путей.
var _ ainom.NomenclatureReranker = (*Reranker)(nil)

// 70. Свойства X-Idempotency-Key (SKILL §5.1): совпадает для одной и той же
// задачи, различается при смене входа, модели, промпта и политики; ≤256 симв.
func TestRerankerIdempotencyKeyProperties(t *testing.T) {
	srv, _ := fakeChatServer(t, `{"results":[]}`)
	defer srv.Close()
	client := testClient(t, srv, "sk-test")

	base := testSettings("prov/m")
	keyFor := func(s RerankSettings, req ainom.RerankBatchRequest) string {
		payload, err := ainom.MarshalProviderRequest(req)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		return NewReranker(client, s).idempotencyKey(payload)
	}

	same := keyFor(base, simpleBatch())
	if got := keyFor(base, simpleBatch()); got != same {
		t.Fatalf("ключ обязан совпадать для идентичной задачи:\n%s\n%s", same, got)
	}
	if len(same) > 256 {
		t.Fatalf("ключ должен быть ≤256 символов, получено %d", len(same))
	}

	// Разные измерения задачи обязаны разводить ключи.
	otherInput := simpleBatch()
	otherInput.Rows[0].Row.Description = "Кабель ВВГнг-LS 3×4"

	otherPrompt := base
	otherPrompt.PromptVersion = "nomenclature-rerank-v2"

	otherPolicy := base
	otherPolicy.ProviderPolicyVersion = "proxy-llm-policy-v1"

	otherTemp := base
	otherTemp.Temperature = 0.7

	for name, got := range map[string]string{
		"другой вход":        keyFor(base, otherInput),
		"другая модель":      keyFor(testSettings("prov/other"), simpleBatch()),
		"другой промпт":      keyFor(otherPrompt, simpleBatch()),
		"другая политика":    keyFor(otherPolicy, simpleBatch()),
		"другая temperature": keyFor(otherTemp, simpleBatch()),
	} {
		if got == same {
			t.Fatalf("%s обязана менять ключ, получен тот же: %s", name, got)
		}
	}
}

// 71. Ключ доезжает до HTTP-заголовка из боевого пути Rerank.
func TestRerankerSendsIdempotencyHeader(t *testing.T) {
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.Header.Get("X-Idempotency-Key")
		_, _ = w.Write([]byte(`{"id":"gen-1","model":"prov/m","choices":[{"finish_reason":"stop",
"message":{"role":"assistant","content":"{\"results\":[]}"}}],"usage":{}}`))
	}))
	defer srv.Close()

	r := NewReranker(testClient(t, srv, "sk-test"), testSettings("prov/m"))
	if _, err := r.Rerank(context.Background(), simpleBatch()); err != nil {
		t.Fatalf("Rerank: %v", err)
	}
	if !strings.HasPrefix(gotKey, "hub-rerank."+IdempotencyVersion+".") {
		t.Fatalf("боевой путь обязан слать X-Idempotency-Key, получено %q", gotKey)
	}
}
