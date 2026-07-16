package repository

// Этап 2.5: интеграционные тесты ai_feature_settings против реального
// PostgreSQL (COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL):
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run AiSettingsIntegration -v
//
// Проверяются SQL-инварианты, которые unit-fake повторяет лишь по контракту:
// безопасные default'ы, WHERE-гейты против гонок draft/test/activate,
// CHECK-страховка enabled, идемпотентность ensure-row.

import (
	"context"
	"sync"
	"testing"
)

func resetAISettings(t *testing.T, repo *AISettingsRepo) {
	t.Helper()
	_, err := repo.pool.Exec(context.Background(), `
		UPDATE public.ai_feature_settings SET
			selected_model_id = NULL, selected_model_name = NULL,
			selected_model_context_length = NULL, selected_model_max_completion_tokens = NULL,
			selected_model_prompt_price = NULL, selected_model_completion_price = NULL,
			selected_model_expiration_date = NULL,
			selected_model_supported_parameters = '[]'::jsonb,
			model_test_status = 'required', model_test_config_hash = NULL,
			model_tested_model_id = NULL, model_tested_at = NULL,
			model_test_latency_ms = NULL, model_test_input_tokens = NULL,
			model_test_output_tokens = NULL, model_test_estimated_cost = NULL,
			model_test_error_code = NULL,
			enabled = false, needs_review_reason = NULL, updated_by = NULL
		WHERE feature_code = $1`, AIFeatureNomenclatureRerank)
	if err != nil {
		t.Fatalf("reset: %v", err)
	}
}

func TestAiSettingsIntegration_DefaultsAndEnsureRow(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	ctx := context.Background()

	// Ensure-row идемпотентен (fresh install и повторные вызовы).
	for i := 0; i < 2; i++ {
		s, err := repo.GetFeatureSettings(ctx, AIFeatureNomenclatureRerank)
		if err != nil {
			t.Fatalf("get #%d: %v", i, err)
		}
		if s.Provider != "openrouter" || s.Enabled || s.ModelTestStatus != AITestRequired {
			t.Fatalf("defaults: %+v", s)
		}
		if !s.RequireZDR || s.DataCollectionPolicy != "deny" || !s.RequireParameters || s.AllowProviderFallbacks {
			t.Fatal("privacy defaults must be locked-safe")
		}
		if s.RequestTimeoutSeconds != 30 || s.MaxOutputTokens != 2000 || s.Temperature != 0 ||
			s.CandidateLimit != 20 || s.MaxRowsPerRequest != 200 || s.MaxConcurrency != 2 {
			t.Fatalf("limit defaults: %+v", s)
		}
	}
	resetAISettings(t, repo)
}

func TestAiSettingsIntegration_DraftTestActivateFlow(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	ctx := context.Background()
	resetAISettings(t, repo)

	adminID := seedAIAdminUser(t, repo)

	ctxLen := int64(64000)
	draft := AIDraftModel{
		ID: "prov/int-a", Name: "Int A", ContextLength: &ctxLen,
		PromptPrice: "0.000001", CompletionPrice: "0.000002",
		SupportedParameters: []string{"temperature", "response_format"},
	}
	s, err := repo.SaveDraftModel(ctx, AIFeatureNomenclatureRerank, draft, true, adminID)
	if err != nil {
		t.Fatalf("save draft: %v", err)
	}
	if s.SelectedModelID == nil || *s.SelectedModelID != "prov/int-a" || s.Enabled ||
		s.ModelTestStatus != AITestRequired {
		t.Fatalf("draft state: %+v", s)
	}
	if len(s.SelectedModelSupportedParameters) != 2 {
		t.Fatalf("supported params snapshot: %+v", s.SelectedModelSupportedParameters)
	}

	// Активация без PASS блокируется WHERE-гейтом (и CHECK-страховкой).
	if _, err := repo.Activate(ctx, AIFeatureNomenclatureRerank, "prov/int-a", "hash-x", adminID); err != ErrAISettingsConflict {
		t.Fatalf("activate without test: %v", err)
	}

	cost := "0.0018"
	s, err = repo.SaveTestResult(ctx, AIFeatureNomenclatureRerank, AITestOutcome{
		Status: AITestPassed, ConfigHash: "hash-x", TestedModelID: "prov/int-a",
		LatencyMs: 850, InputTokens: 1200, OutputTokens: 300, EstimatedCost: &cost,
	})
	if err != nil {
		t.Fatalf("save test: %v", err)
	}
	if s.ModelTestStatus != AITestPassed || s.Enabled {
		t.Fatalf("test must not auto-enable: %+v", s)
	}

	// Activate с неверным hash → конфликт (stale test).
	if _, err := repo.Activate(ctx, AIFeatureNomenclatureRerank, "prov/int-a", "hash-OTHER", adminID); err != ErrAISettingsConflict {
		t.Fatalf("stale hash activate: %v", err)
	}
	s, err = repo.Activate(ctx, AIFeatureNomenclatureRerank, "prov/int-a", "hash-x", adminID)
	if err != nil || !s.Enabled {
		t.Fatalf("activate: %v %+v", err, s)
	}

	// Смена draft при активной конфигурации выключает и сбрасывает тест.
	s, err = repo.SaveDraftModel(ctx, AIFeatureNomenclatureRerank, AIDraftModel{
		ID: "prov/int-b", Name: "Int B", PromptPrice: "0", CompletionPrice: "0",
	}, true, adminID)
	if err != nil {
		t.Fatalf("second draft: %v", err)
	}
	if s.Enabled || s.ModelTestStatus != AITestRequired || s.ModelTestConfigHash != nil {
		t.Fatalf("draft change must disable and reset: %+v", s)
	}

	// SaveTestResult для УЖЕ ЗАМЕНЁННОЙ модели отбрасывается (§29).
	if _, err := repo.SaveTestResult(ctx, AIFeatureNomenclatureRerank, AITestOutcome{
		Status: AITestPassed, ConfigHash: "h", TestedModelID: "prov/int-a",
	}); err != ErrAISettingsConflict {
		t.Fatalf("stale test result must conflict: %v", err)
	}

	// Deactivate + needs_review.
	if _, err := repo.Deactivate(ctx, AIFeatureNomenclatureRerank, adminID); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	s, err = repo.SetNeedsReview(ctx, AIFeatureNomenclatureRerank, "модель недоступна")
	if err != nil || s.Enabled || s.NeedsReviewReason == nil {
		t.Fatalf("needs review: %v %+v", err, s)
	}
	resetAISettings(t, repo)
}

// Гонка activation vs config change: конкурентные Activate и SaveDraftModel
// не могут дать enabled-строку с несоответствующим тестом (WHERE + CHECK).
func TestAiSettingsIntegration_ActivateVsDraftRace(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	ctx := context.Background()
	resetAISettings(t, repo)
	adminID := seedAIAdminUser(t, repo)

	for round := 0; round < 10; round++ {
		resetAISettings(t, repo)
		if _, err := repo.SaveDraftModel(ctx, AIFeatureNomenclatureRerank, AIDraftModel{
			ID: "prov/race-a", Name: "A", PromptPrice: "0", CompletionPrice: "0",
		}, true, adminID); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.SaveTestResult(ctx, AIFeatureNomenclatureRerank, AITestOutcome{
			Status: AITestPassed, ConfigHash: "hash-race", TestedModelID: "prov/race-a",
		}); err != nil {
			t.Fatal(err)
		}

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = repo.Activate(ctx, AIFeatureNomenclatureRerank, "prov/race-a", "hash-race", adminID)
		}()
		go func() {
			defer wg.Done()
			_, _ = repo.SaveDraftModel(ctx, AIFeatureNomenclatureRerank, AIDraftModel{
				ID: "prov/race-b", Name: "B", PromptPrice: "0", CompletionPrice: "0",
			}, true, adminID)
		}()
		wg.Wait()

		s, err := repo.GetFeatureSettings(ctx, AIFeatureNomenclatureRerank)
		if err != nil {
			t.Fatal(err)
		}
		// Инвариант: если enabled — то это протестированная модель A с
		// совпадающим hash; включённая B (без теста) невозможна.
		if s.Enabled {
			if s.SelectedModelID == nil || *s.SelectedModelID != "prov/race-a" ||
				s.ModelTestStatus != AITestPassed ||
				s.ModelTestConfigHash == nil || *s.ModelTestConfigHash != "hash-race" {
				t.Fatalf("round %d: enabled with mismatched config: %+v", round, s)
			}
		}
	}
	resetAISettings(t, repo)
}

// seedAIAdminUser — updated_by требует существующего пользователя (FK).
// Паттерн — как в import_memory_integration_test: auth.users bridge +
// role_code из существующей роли.
func seedAIAdminUser(t *testing.T, repo *AISettingsRepo) string {
	t.Helper()
	ctx := context.Background()
	const uid = "7a1f2b3c-4d5e-46f7-a8b9-c0d1e2f3a4b5"
	// Роль создаём сами: fresh-БД без seed не должна валить тест.
	if _, err := repo.pool.Exec(ctx, `
		INSERT INTO public.roles (code, name, color)
		VALUES ('administrator', 'Администратор', '#f00')
		ON CONFLICT (code) DO NOTHING`); err != nil {
		t.Fatalf("seed role: %v", err)
	}
	if _, err := repo.pool.Exec(ctx, `
		INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'ai-admin-test@example.com')
		ON CONFLICT (id) DO NOTHING`, uid); err != nil {
		t.Fatalf("seed auth user: %v", err)
	}
	if _, err := repo.pool.Exec(ctx, `
		INSERT INTO public.users (id, email, full_name, role_code, access_enabled)
		VALUES ($1::uuid, 'ai-admin-test@example.com', 'AI Admin Test', 'administrator', true)
		ON CONFLICT (id) DO NOTHING`, uid); err != nil {
		t.Fatalf("seed admin user: %v", err)
	}
	return uid
}
