package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/ai/aieval"
	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ─── Fake settings store (те же WHERE-гейты, что и SQL-репозиторий) ─────────

type fakeAIStore struct {
	mu  sync.Mutex
	row repository.AIFeatureSettings
	// rs — rollout-состояние этапа 2.6 (ai_rollout_fake_test.go).
	rs *fakeRolloutState
}

func newFakeAIStore() *fakeAIStore {
	return &fakeAIStore{row: repository.AIFeatureSettings{
		FeatureCode:            repository.AIFeatureNomenclatureRerank,
		Provider:               "openrouter",
		PromptVersion:          "nomenclature-rerank-v1",
		ProviderPolicyVersion:  "openrouter-policy-v1",
		RequireZDR:             true,
		DataCollectionPolicy:   "deny",
		RequireParameters:      true,
		AllowProviderFallbacks: false,
		RequestTimeoutSeconds:  30,
		MaxOutputTokens:        2000,
		Temperature:            0,
		CandidateLimit:         20,
		MaxRowsPerRequest:      200,
		MaxConcurrency:         2,
		ModelTestStatus:        repository.AITestRequired,
		Enabled:                false,
		// Этап 2.6: rollout-default'ы (зеркало DB-схемы).
		RolloutMode:               repository.AIRolloutOff,
		RolloutConfigVersion:      1,
		DailyRequestLimit:         20,
		DailyRowLimit:             400,
		RequestMaxReservedCost:    "0.05",
		CircuitFailureThreshold:   3,
		CircuitCooldownSeconds:    300,
		ReservationTimeoutSeconds: 120,
		UpdatedAt:                 time.Now(),
	}}
}

func (f *fakeAIStore) snapshot() *repository.AIFeatureSettings {
	cp := f.row
	return &cp
}

func (f *fakeAIStore) GetFeatureSettings(_ context.Context, _ string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.snapshot(), nil
}

func (f *fakeAIStore) SaveDraftModel(_ context.Context, _ string, m repository.AIDraftModel, resetTest bool, updatedBy string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id, name := m.ID, m.Name
	f.row.SelectedModelID = &id
	f.row.SelectedModelName = &name
	f.row.SelectedModelContextLength = m.ContextLength
	f.row.SelectedModelMaxCompletionTokens = m.MaxCompletionTokens
	pp, cp := m.PromptPrice, m.CompletionPrice
	f.row.SelectedModelPromptPrice = &pp
	f.row.SelectedModelCompletionPrice = &cp
	f.row.SelectedModelExpirationDate = m.ExpirationDate
	f.row.SelectedModelSupportedParameters = m.SupportedParameters
	f.row.NeedsReviewReason = nil
	f.row.Enabled = false
	f.row.UpdatedBy = &updatedBy
	if resetTest {
		f.row.ModelTestStatus = repository.AITestRequired
		f.row.ModelTestConfigHash = nil
		f.row.ModelTestedModelID = nil
		f.row.ModelTestedAt = nil
		f.row.ModelTestLatencyMs = nil
		f.row.ModelTestInputTokens = nil
		f.row.ModelTestOutputTokens = nil
		f.row.ModelTestEstimatedCost = nil
		f.row.ModelTestErrorCode = nil
	}
	return f.snapshot(), nil
}

func (f *fakeAIStore) SaveTestResult(_ context.Context, _ string, o repository.AITestOutcome) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	// Зеркало SQL WHERE selected_model_id = tested_model_id (§29).
	if f.row.SelectedModelID == nil || *f.row.SelectedModelID != o.TestedModelID {
		return nil, repository.ErrAISettingsConflict
	}
	now := time.Now()
	f.row.ModelTestStatus = o.Status
	f.row.ModelTestConfigHash = &o.ConfigHash
	f.row.ModelTestedModelID = &o.TestedModelID
	f.row.ModelTestedAt = &now
	f.row.ModelTestLatencyMs = &o.LatencyMs
	f.row.ModelTestInputTokens = &o.InputTokens
	f.row.ModelTestOutputTokens = &o.OutputTokens
	f.row.ModelTestEstimatedCost = o.EstimatedCost
	f.row.ModelTestErrorCode = o.ErrorCode
	// ВАЖНО: enabled не трогаем — тест никогда не включает модель (§12.B).
	return f.snapshot(), nil
}

func (f *fakeAIStore) Activate(_ context.Context, _ string, modelID, configHash, updatedBy string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.row.SelectedModelID == nil || *f.row.SelectedModelID != modelID ||
		f.row.ModelTestStatus != repository.AITestPassed ||
		f.row.ModelTestConfigHash == nil || *f.row.ModelTestConfigHash != configHash ||
		f.row.ModelTestedModelID == nil || *f.row.ModelTestedModelID != modelID {
		return nil, repository.ErrAISettingsConflict
	}
	f.row.Enabled = true
	f.row.NeedsReviewReason = nil
	f.row.UpdatedBy = &updatedBy
	return f.snapshot(), nil
}

func (f *fakeAIStore) Deactivate(_ context.Context, _ string, updatedBy string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.row.Enabled = false
	f.row.UpdatedBy = &updatedBy
	return f.snapshot(), nil
}

func (f *fakeAIStore) SetNeedsReview(_ context.Context, _ string, reason string) (*repository.AIFeatureSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.row.Enabled = false
	f.row.NeedsReviewReason = &reason
	return f.snapshot(), nil
}

// ─── Fake OpenRouter server (key + models/user + chat/completions) ──────────

type fakeOpenRouter struct {
	mu          sync.Mutex
	models      []string // model IDs, отдаются как text→text модели
	keyStatus   int      // 200 | 401 | 402 | 429 | 503
	modelsCode  int
	chatCode    int               // 0/200 | 429 | 500 ...
	chatAnswers map[string]string // row_reference → selected id ("" = abstain)
	keyCalls    int
	modelCalls  int
	chatCalls   int
	// onChat — hook mid-call (этап 2.6 §20): выполняется ВНУТРИ обработки
	// chat-запроса ДО ответа (kill switch/model change/pilot removal).
	onChat func()
}

func newFakeOpenRouter(models ...string) *fakeOpenRouter {
	answers := map[string]string{
		// Синтетический model test этапа 2.5.
		"synthetic|1": "syn-cable-3x2.5",
		"synthetic|2": "syn-concrete-m200",
		"synthetic|3": "",
		"synthetic|4": "",
	}
	// Evaluation-dataset этапа 2.6: идеальные ответы по expectations.
	for _, cs := range aieval.SyntheticDataset().Cases {
		answers[cs.Key] = cs.ExpectedID // "" = abstain
	}
	return &fakeOpenRouter{models: models, keyStatus: 200, modelsCode: 200, chatAnswers: answers}
}

func (f *fakeOpenRouter) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/key", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.keyCalls++
		code := f.keyStatus
		f.mu.Unlock()
		if code != 200 {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"error":{"code":` + fmt.Sprint(code) + `,"message":"nope"}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"label":"sk-or-test","limit":50,"limit_remaining":49.9,
			"limit_reset":"monthly","usage":0.1,"usage_daily":0.05,"usage_weekly":0.1,"usage_monthly":0.1,
			"byok_usage":0,"byok_usage_daily":0,"byok_usage_weekly":0,"byok_usage_monthly":0,
			"is_free_tier":false,"is_management_key":false,"is_provisioning_key":false,
			"include_byok_in_limit":true,"creator_user_id":null,"expires_at":null,
			"rate_limit":{"requests":-1,"interval":"10s","note":"legacy"}}}`))
	})
	mux.HandleFunc("/models/user", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.modelCalls++
		code := f.modelsCode
		ids := append([]string(nil), f.models...)
		f.mu.Unlock()
		if code != 200 {
			w.WriteHeader(code)
			return
		}
		items := make([]string, 0, len(ids))
		for _, id := range ids {
			items = append(items, fmt.Sprintf(`{
				"id": %q, "canonical_slug": %q, "name": "Model %s", "description": "d",
				"created": 1700000000, "expiration_date": null, "context_length": 64000,
				"architecture": {"modality":"text->text","input_modalities":["text"],"output_modalities":["text"],"tokenizer":"Other"},
				"pricing": {"prompt":"0.000001","completion":"0.000002","request":"0"},
				"top_provider": {"context_length":64000,"max_completion_tokens":8000,"is_moderated":false},
				"per_request_limits": null,
				"supported_parameters": ["temperature","max_tokens","response_format","structured_outputs"],
				"default_parameters": null, "supported_voices": null, "links": {"details":"x"}
			}`, id, id, id))
		}
		_, _ = w.Write([]byte(`{"data":[` + strings.Join(items, ",") + `],"total_count":` + fmt.Sprint(len(items)) + `,"links":{"next":null}}`))
	})
	mux.HandleFunc("/chat/completions", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.chatCalls++
		answers := f.chatAnswers
		code := f.chatCode
		hook := f.onChat
		f.mu.Unlock()
		if hook != nil {
			hook()
		}
		if code != 0 && code != 200 {
			w.WriteHeader(code)
			_, _ = w.Write([]byte(`{"error":{"code":` + fmt.Sprint(code) + `,"message":"nope"}}`))
			return
		}
		var body struct {
			Messages []openrouter.ChatMessage `json:"messages"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		var payload struct {
			Rows []struct {
				Row struct {
					RowReference string `json:"row_reference"`
				} `json:"row"`
			} `json:"rows"`
		}
		for _, m := range body.Messages {
			if m.Role == "user" {
				if i := strings.Index(m.Content, "{"); i >= 0 {
					_ = json.Unmarshal([]byte(m.Content[i:]), &payload)
				}
			}
		}
		results := make([]map[string]any, 0)
		for _, row := range payload.Rows {
			ref := row.Row.RowReference
			sel, ok := answers[ref]
			if !ok {
				continue
			}
			res := map[string]any{
				"row_reference": ref, "selected_candidate_id": nil,
				"ranked_candidate_ids": []string{}, "confidence": "abstain",
				"explanation": "Возможно соответствия нет.", "matched_features": []string{},
				"conflicting_features": []string{}, "abstain_reason": "не соответствует",
			}
			if sel != "" {
				res["selected_candidate_id"] = sel
				res["ranked_candidate_ids"] = []string{sel}
				res["confidence"] = "high"
				res["abstain_reason"] = nil
				res["explanation"] = "Возможно соответствует."
			}
			results = append(results, res)
		}
		content, _ := json.Marshal(map[string]any{"results": results})
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "gen", "model": "prov/m",
			"choices": []map[string]any{{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": string(content)}}},
			"usage":   map[string]any{"prompt_tokens": 800, "completion_tokens": 200, "total_tokens": 1000},
		})
	})
	return mux
}

// newTestAIAdmin — сервис против fake OpenRouter + fake store.
func newTestAIAdmin(t *testing.T, fake *fakeOpenRouter, apiKey string) (*AIAdminService, *fakeAIStore, *httptest.Server) {
	t.Helper()
	srv := httptest.NewServer(fake.handler())
	t.Cleanup(srv.Close)
	client, err := openrouter.New(openrouter.Config{APIKey: apiKey, BaseURL: srv.URL, Timeout: 5 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	catalog := openrouter.NewCatalogCache(client, time.Minute)
	store := newFakeAIStore()
	return NewAIAdminService(client, catalog, store), store, srv
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// 31. Безопасные default'ы: policy locked, enabled=false, тест required.
func TestAISettingsDefaultsSafe(t *testing.T) {
	svc, _, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/m"), "sk")
	view, err := svc.GetSettings(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if view.Enabled || view.Test.Status != "required" || view.SelectedModel != nil {
		t.Fatalf("defaults: %+v", view)
	}
	if !view.RequireZDR || view.DataCollectionPolicy != "deny" || !view.RequireParameters || view.AllowFallbacks {
		t.Fatal("privacy policy defaults must be locked-safe")
	}
	if view.LimitsEditable {
		t.Fatal("limits must be read-only in 2.5")
	}
	if view.RolloutStatus != "off" {
		t.Fatal("rollout must be off in 2.5")
	}
	if view.CanActivate {
		t.Fatal("cannot activate with no model")
	}
}

// 32+41. Draft сохраняется только из каталога; произвольный ID отклоняется.
func TestAISaveDraftFromCatalogOnly(t *testing.T) {
	svc, store, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/m"), "sk")
	if _, err := svc.SaveDraft(context.Background(), "prov/uninvited", "u-1"); !errors.Is(err, ErrAIModelNotAvailable) {
		t.Fatalf("arbitrary model must be rejected: %v", err)
	}
	view, err := svc.SaveDraft(context.Background(), "prov/m", "u-1")
	if err != nil {
		t.Fatal(err)
	}
	if view.SelectedModel == nil || view.SelectedModel.ID != "prov/m" || view.Enabled {
		t.Fatalf("draft: %+v", view)
	}
	if store.row.SelectedModelPromptPrice == nil || *store.row.SelectedModelPromptPrice != "0.000001" {
		t.Fatal("model snapshot (prices) must be persisted")
	}
	if view.Test.Status != "required" {
		t.Fatal("new draft requires test")
	}
}

// 42. Router-модель невыбираема (каталог её не содержит по построению).
func TestAIRouterModelRejected(t *testing.T) {
	svc, _, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/m"), "sk")
	if _, err := svc.SaveDraft(context.Background(), "openrouter/auto", "u-1"); !errors.Is(err, ErrAIModelNotAvailable) {
		t.Fatalf("router model must be rejected: %v", err)
	}
}

// 37+38. Повторный save той же модели тест НЕ сбрасывает; смена модели —
// сбрасывает и выключает.
func TestAIConfigHashResetSemantics(t *testing.T) {
	svc, store, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a", "prov/b"), "sk")
	ctx := context.Background()
	if _, err := svc.SaveDraft(ctx, "prov/a", "u-1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.TestModel(ctx, "u-1"); err != nil {
		t.Fatal(err)
	}
	if store.row.ModelTestStatus != repository.AITestPassed {
		t.Fatalf("test must pass: %+v", store.row.ModelTestStatus)
	}
	// Presentation re-save той же модели: тест сохраняется (§11).
	view, err := svc.SaveDraft(ctx, "prov/a", "u-1")
	if err != nil {
		t.Fatal(err)
	}
	if view.Test.Status != "passed" {
		t.Fatal("re-saving same model must not reset test")
	}
	// Смена модели: тест сброшен, enabled=false (§12.A).
	view, err = svc.SaveDraft(ctx, "prov/b", "u-1")
	if err != nil {
		t.Fatal(err)
	}
	if view.Test.Status != "required" || view.Enabled {
		t.Fatalf("model change must reset test and disable: %+v", view)
	}
}

// 44-46+60. Activate-гейты: без теста — отказ; после PASS — успех; тест сам
// по себе НЕ включает.
func TestAIActivationGates(t *testing.T) {
	svc, store, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a"), "sk")
	ctx := context.Background()

	if _, err := svc.Activate(ctx, "u-1"); !errors.Is(err, ErrAIModelNotSelected) {
		t.Fatalf("no model: %v", err)
	}
	if _, err := svc.SaveDraft(ctx, "prov/a", "u-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Activate(ctx, "u-1"); !errors.Is(err, ErrAIModelTestRequired) {
		t.Fatalf("without test: %v", err)
	}
	if _, _, err := svc.TestModel(ctx, "u-1"); err != nil {
		t.Fatal(err)
	}
	// 60: после PASS enabled остаётся false.
	if store.row.Enabled {
		t.Fatal("test must not auto-enable")
	}
	view, err := svc.Activate(ctx, "u-1")
	if err != nil {
		t.Fatal(err)
	}
	if !view.Enabled {
		t.Fatal("activation must enable")
	}
	// 47: deactivate.
	view, err = svc.Deactivate(ctx, "u-1")
	if err != nil || view.Enabled {
		t.Fatalf("deactivate: %v %+v", err, view)
	}
}

// 45. Stale тест (другая модель) не активирует изменённую конфигурацию.
func TestAIActivationStaleTestRejected(t *testing.T) {
	svc, _, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a", "prov/b"), "sk")
	ctx := context.Background()
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	if _, _, err := svc.TestModel(ctx, "u-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveDraft(ctx, "prov/b", "u-1"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Activate(ctx, "u-1"); !errors.Is(err, ErrAIModelTestRequired) {
		t.Fatalf("stale test must not activate: %v", err)
	}
}

// 48. Модель исчезла из свежего каталога → needs_review + автоотключение,
// БЕЗ автоперехода на другую модель.
func TestAIModelDisappearsNeedsReview(t *testing.T) {
	fake := newFakeOpenRouter("prov/a")
	svc, store, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	_, _, _ = svc.TestModel(ctx, "u-1")
	if _, err := svc.Activate(ctx, "u-1"); err != nil {
		t.Fatal(err)
	}
	// Модель пропадает из каталога.
	fake.mu.Lock()
	fake.models = []string{"prov/other"}
	fake.mu.Unlock()
	_ = svc.Models(ctx, true) // форс-рефреш каталога
	view, err := svc.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if view.Enabled {
		t.Fatal("vanished model must disable configuration")
	}
	if view.NeedsReviewReason == nil {
		t.Fatal("needs_review reason must be set")
	}
	if view.ModelAvailability != "missing" {
		t.Fatalf("availability = %s", view.ModelAvailability)
	}
	// Автоперехода нет: selected model осталась prov/a.
	if store.row.SelectedModelID == nil || *store.row.SelectedModelID != "prov/a" {
		t.Fatal("no automatic model switch allowed")
	}
}

// 30. Snapshot выбранной модели виден при недоступном каталоге.
func TestAISnapshotSurvivesCatalogOutage(t *testing.T) {
	fake := newFakeOpenRouter("prov/a")
	svc, _, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	// Каталог падает; кэш ещё жив → stale; создаём новый сервис без кэша,
	// чтобы смоделировать рестарт + недоступность.
	fake.mu.Lock()
	fake.modelsCode = 503
	fake.mu.Unlock()
	srv2 := httptest.NewServer(fake.handler())
	t.Cleanup(srv2.Close)
	client2, _ := openrouter.New(openrouter.Config{APIKey: "sk", BaseURL: srv2.URL, Timeout: 2 * time.Second})
	store2 := newFakeAIStore()
	id := "prov/a"
	store2.row.SelectedModelID = &id
	name := "Model prov/a"
	store2.row.SelectedModelName = &name
	svc2 := NewAIAdminService(client2, openrouter.NewCatalogCache(client2, time.Minute), store2)
	view, err := svc2.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if view.SelectedModel == nil || view.SelectedModel.ID != "prov/a" {
		t.Fatal("selected snapshot must remain visible")
	}
	if view.ModelAvailability != "catalog_unavailable" {
		t.Fatalf("availability = %s", view.ModelAvailability)
	}
	if view.CanActivate {
		t.Fatal("activation must be blocked while catalog unavailable")
	}
}

// 43. Истёкший snapshot отклоняет тест и активацию.
func TestAIExpiredSnapshotRejected(t *testing.T) {
	svc, store, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a"), "sk")
	ctx := context.Background()
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	past := time.Now().Add(-48 * time.Hour).Format("2006-01-02")
	store.mu.Lock()
	store.row.SelectedModelExpirationDate = &past
	store.mu.Unlock()
	if _, _, err := svc.TestModel(ctx, "u-1"); !errors.Is(err, ErrAIModelExpired) {
		t.Fatalf("expired model test: %v", err)
	}
	if _, err := svc.Activate(ctx, "u-1"); !errors.Is(err, ErrAIModelExpired) {
		t.Fatalf("expired model activate: %v", err)
	}
}

// Key status: GET кэшируется, «Проверить подключение» всегда live (§8).
func TestAIKeyStatusCacheAndForce(t *testing.T) {
	fake := newFakeOpenRouter("prov/a")
	svc, _, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	_ = svc.Status(ctx)
	_ = svc.Status(ctx)
	fake.mu.Lock()
	afterStatus := fake.keyCalls
	fake.mu.Unlock()
	if afterStatus != 1 {
		t.Fatalf("Status must cache: %d calls", afterStatus)
	}
	_ = svc.TestConnection(ctx)
	_ = svc.TestConnection(ctx)
	fake.mu.Lock()
	afterForce := fake.keyCalls
	fake.mu.Unlock()
	if afterForce != 3 {
		t.Fatalf("TestConnection must always hit server: %d calls", afterForce)
	}
}

// Connection state mapping: 401/402/not_configured.
func TestAIConnectionStates(t *testing.T) {
	fake := newFakeOpenRouter("prov/a")
	svc, _, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	if v := svc.TestConnection(ctx); v.Connection != "connected" || v.Key == nil || v.Key.Label != "sk-or-test" {
		t.Fatalf("connected: %+v", v)
	}
	fake.mu.Lock()
	fake.keyStatus = 401
	fake.mu.Unlock()
	if v := svc.TestConnection(ctx); v.Connection != "unauthorized" || v.Key != nil {
		t.Fatalf("unauthorized: %+v", v)
	}
	fake.mu.Lock()
	fake.keyStatus = 402
	fake.mu.Unlock()
	if v := svc.TestConnection(ctx); v.Connection != "payment_required" {
		t.Fatalf("payment: %+v", v)
	}

	svcNoKey, _, _ := newTestAIAdmin(t, newFakeOpenRouter(), "")
	if v := svcNoKey.Status(ctx); v.Connection != "not_configured" || v.APIKeyConfigured {
		t.Fatalf("not_configured: %+v", v)
	}
}

// Capability (этап 2.6): rollout off по умолчанию — user-вызовы запрещены
// независимо от готовности конфигурации.
func TestAICapabilityStates(t *testing.T) {
	ctx := context.Background()

	svc, _, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a"), "sk")
	cap0, err := svc.PilotCapability(ctx, "u-1")
	if err != nil || cap0.Status != AICapRolloutOff || cap0.RolloutMode != repository.AIRolloutOff {
		t.Fatalf("default capability: %+v %v", cap0, err)
	}
	if cap0.IsPilot || cap0.IndividualSuggestionsAllowed || cap0.BulkConfirmationAllowed {
		t.Fatalf("rollout off must not allow anything: %+v", cap0)
	}

	// Готовая конфигурация НЕ меняет rollout: всё ещё off.
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	_, _, _ = svc.TestModel(ctx, "u-1")
	cap1, _ := svc.PilotCapability(ctx, "u-1")
	if cap1.Status != AICapRolloutOff {
		t.Fatalf("ready config must stay rollout_off: %+v", cap1)
	}
}

// Test failure path: hard-negative провал сохраняется как failed, активация
// отклоняется (§12.C).
func TestAITestFailurePersisted(t *testing.T) {
	fake := newFakeOpenRouter("prov/a")
	fake.mu.Lock()
	fake.chatAnswers["synthetic|2"] = "syn-concrete-m150" // неверная марка
	fake.mu.Unlock()
	svc, store, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	report, view, err := svc.TestModel(ctx, "u-1")
	if err != nil {
		t.Fatal(err)
	}
	if report.Status != "failed" || view.Test.Status != "failed" {
		t.Fatalf("failed test not persisted: %s / %s", report.Status, view.Test.Status)
	}
	if store.row.Enabled {
		t.Fatal("failed test must not enable")
	}
	if _, err := svc.Activate(ctx, "u-1"); !errors.Is(err, ErrAIModelTestFailed) {
		t.Fatalf("activation after failed test: %v", err)
	}
}

// §16: rollout off — обычный Suggest-путь пользователей не имеет доступа к
// OpenRouter reranker'у: wire оставляет DisabledProvider (проверяется guard'ом
// и wire-кодом); здесь фиксируем, что admin-тест — единственный вызвавший chat.
func TestAIOnlyAdminTestCallsChat(t *testing.T) {
	fake := newFakeOpenRouter("prov/a")
	svc, _, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	_, _ = svc.SaveDraft(ctx, "prov/a", "u-1")
	_ = svc.Models(ctx, true)
	_ = svc.TestConnection(ctx)
	_, _ = svc.PilotCapability(ctx, "u-1")
	fake.mu.Lock()
	before := fake.chatCalls
	fake.mu.Unlock()
	if before != 0 {
		t.Fatalf("no admin action except test-model may call chat: %d", before)
	}
	_, _, _ = svc.TestModel(ctx, "u-1")
	fake.mu.Lock()
	after := fake.chatCalls
	fake.mu.Unlock()
	if after != 1 {
		t.Fatalf("model test must call chat exactly once: %d", after)
	}
}
