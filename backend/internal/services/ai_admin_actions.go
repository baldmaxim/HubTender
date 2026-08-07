package services

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Действия admin-flow (§12 задания): draft → test → activate → deactivate.

// resolveDraftModel — единственная точка, где model ID превращается в модель.
//
// Прямой режим: только server-returned каталог (§9). Режим proxy_llm: каталог
// синтетический, поэтому слаг, введённый вручную (вариант B/C), проходит
// проверку формата в ProxyCustomModel. Существование модели не подтверждает
// ни та, ни другая ветка в proxy-режиме — это делает только model test.
func (s *AIAdminService) resolveDraftModel(modelID string) (openrouter.Model, bool) {
	if model, ok := s.catalog.FindModel(modelID); ok {
		return model, true
	}
	if s.isProxyTransport() {
		return openrouter.ProxyCustomModel(modelID)
	}
	return openrouter.Model{}, false
}

// SaveDraft — §12.A: сохранить выбранную модель как draft. Model ID приходит
// ТОЛЬКО из server-returned каталога (§9); исключение — proxy_llm, где каталога
// нет и слаг вводится вручную (см. resolveDraftModel). Router/expired ID
// отклоняется. Активации здесь нет; смена config hash сбрасывает тест.
func (s *AIAdminService) SaveDraft(ctx context.Context, modelID, updatedBy string) (*AISettingsView, error) {
	if !s.client.Configured() {
		return nil, ErrAIProviderNotConfigured
	}
	snap := s.catalog.Get(ctx, false)
	if snap.Status == openrouter.CatalogUnavailable {
		return nil, ErrAICatalogUnavailable
	}
	model, ok := s.resolveDraftModel(modelID)
	if !ok {
		// Каталог по построению не содержит router/alias и истёкшие модели
		// (FilterCatalog §6) — всё вне каталога отклоняется одинаково.
		return nil, ErrAIModelNotAvailable
	}

	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	oldHash := ""
	if row.SelectedModelID != nil {
		oldHash = s.configHashFor(row, *row.SelectedModelID)
	}
	newHash := s.configHashFor(row, model.ID)
	resetTest := oldHash != newHash // presentation-обновление той же модели тест не сбрасывает (§11)

	row, err = s.settings.SaveDraftModel(ctx, repository.AIFeatureNomenclatureRerank, repository.AIDraftModel{
		ID:                  model.ID,
		Name:                model.Name,
		ContextLength:       model.ContextLength,
		MaxCompletionTokens: model.MaxCompletionTokens,
		PromptPrice:         model.PromptPricePerToken,
		CompletionPrice:     model.CompletionPricePerToken,
		ExpirationDate:      model.ExpirationDate,
		SupportedParameters: model.SupportedParameters,
	}, resetTest, updatedBy)
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("operation", "ai_settings_save_draft").
		Str("provider", "openrouter").
		Str("model", model.ID).
		Str("config_hash_prefix", openrouter.HashPrefix(newHash)).
		Bool("test_reset", resetTest).
		Msg("ai draft model saved")
	return s.buildView(row, s.modelAvailability(ctx, row, false)), nil
}

// TestModel — §12.B/§13: синтетический HUBTender model test. Использует
// ТОЛЬКО synthetic fixtures; модель — из сохранённого draft (frontend не
// передаёт ни модель, ни prompt). Результат сохраняется; модель НЕ
// включается автоматически.
func (s *AIAdminService) TestModel(ctx context.Context, updatedBy string) (*openrouter.ModelTestReport, *AISettingsView, error) {
	if !s.client.Configured() {
		return nil, nil, ErrAIProviderNotConfigured
	}
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, nil, err
	}
	if row.SelectedModelID == nil {
		return nil, nil, ErrAIModelNotSelected
	}
	modelID := *row.SelectedModelID
	if expiredSnapshot(row) {
		return nil, nil, ErrAIModelExpired
	}

	configHash := s.configHashFor(row, modelID)
	reranker := openrouter.NewReranker(s.client, s.rerankSettingsFor(row, modelID))

	testCtx, cancel := context.WithTimeout(ctx, time.Duration(row.RequestTimeoutSeconds)*time.Second)
	defer cancel()

	pricing := openrouter.ModelPricing{}
	if row.SelectedModelPromptPrice != nil {
		pricing.PromptPricePerToken = *row.SelectedModelPromptPrice
	}
	if row.SelectedModelCompletionPrice != nil {
		pricing.CompletionPricePerToken = *row.SelectedModelCompletionPrice
	}

	report := openrouter.RunModelTest(testCtx, reranker, pricing, configHash)

	outcome := repository.AITestOutcome{
		Status:        repository.AITestFailed,
		ConfigHash:    configHash,
		TestedModelID: modelID,
		LatencyMs:     int(report.LatencyMs),
		InputTokens:   report.InputTokens,
		OutputTokens:  report.OutputTokens,
	}
	if report.Status == "passed" {
		outcome.Status = repository.AITestPassed
	}
	if report.EstimatedCostUSD != "" {
		cost := report.EstimatedCostUSD
		outcome.EstimatedCost = &cost
	}
	if report.ErrorCode != "" {
		code := report.ErrorCode
		outcome.ErrorCode = &code
	}

	row, err = s.settings.SaveTestResult(ctx, repository.AIFeatureNomenclatureRerank, outcome)
	if err != nil {
		if errors.Is(err, repository.ErrAISettingsConflict) {
			// Draft изменился, пока тест шёл: результат отброшен (§29).
			return nil, nil, ErrAIModelConfigChanged
		}
		return nil, nil, err
	}

	passedScenarios := 0
	for _, sc := range report.Scenarios {
		if sc.Status == "passed" {
			passedScenarios++
		}
	}
	log.Info().
		Str("operation", "ai_model_test").
		Str("provider", "openrouter").
		Str("model", modelID).
		Str("prompt_version", report.PromptVersion).
		Str("config_hash_prefix", openrouter.HashPrefix(configHash)).
		Str("outcome", report.Status).
		Str("error_code", report.ErrorCode).
		Int64("latency_ms", report.LatencyMs).
		Int("input_tokens", report.InputTokens).
		Int("output_tokens", report.OutputTokens).
		Str("estimated_cost_usd", report.EstimatedCostUSD).
		Int("scenarios_total", len(report.Scenarios)).
		Int("scenarios_passed", passedScenarios).
		Msg("ai synthetic model test finished")

	return &report, s.buildView(row, s.modelAvailability(ctx, row, false)), nil
}

// Activate — §12.C: включить конфигурацию. Разрешено ТОЛЬКО при
// одновременном выполнении всех гейтов; body model ID не принимается —
// активируется сохранённый протестированный draft. Rollout для
// пользовательского трафика при этом остаётся off (этап 2.6).
func (s *AIAdminService) Activate(ctx context.Context, updatedBy string) (*AISettingsView, error) {
	if !s.client.Configured() {
		return nil, ErrAIProviderNotConfigured
	}
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	if row.SelectedModelID == nil {
		return nil, ErrAIModelNotSelected
	}
	modelID := *row.SelectedModelID

	// Живая проверка подключения (§12.C: connection test успешен).
	conn := s.TestConnection(ctx)
	if conn.Connection != "connected" {
		return nil, ErrAIProviderNotConfigured
	}

	// Модель существует в свежем/допустимом каталоге и не истекла.
	switch s.modelAvailability(ctx, row, true) {
	case "available":
	case "expired":
		return nil, ErrAIModelExpired
	case "catalog_unavailable":
		return nil, ErrAICatalogUnavailable
	default:
		return nil, ErrAIModelNotAvailable
	}

	// Тест пройден, hash совпадает, тест относится к выбранной модели.
	currentHash := s.configHashFor(row, modelID)
	switch row.ModelTestStatus {
	case repository.AITestPassed:
		if row.ModelTestConfigHash == nil || *row.ModelTestConfigHash != currentHash ||
			row.ModelTestedModelID == nil || *row.ModelTestedModelID != modelID {
			return nil, ErrAIModelConfigChanged
		}
	case repository.AITestFailed:
		return nil, ErrAIModelTestFailed
	default:
		return nil, ErrAIModelTestRequired
	}

	row, err = s.settings.Activate(ctx, repository.AIFeatureNomenclatureRerank, modelID, currentHash, updatedBy)
	if err != nil {
		if errors.Is(err, repository.ErrAISettingsConflict) {
			return nil, ErrAIModelConfigChanged
		}
		return nil, err
	}

	log.Info().
		Str("operation", "ai_settings_activate").
		Str("provider", "openrouter").
		Str("model", modelID).
		Str("config_hash_prefix", openrouter.HashPrefix(currentHash)).
		Str("rollout_status", AIRolloutStatus).
		Msg("ai configuration activated (user rollout stays off until stage 2.6)")
	return s.buildView(row, "available"), nil
}

// Deactivate — §12.D: enabled=false; effective provider для пользователей —
// DisabledProvider; deterministic/manual Smart Import продолжает работать.
func (s *AIAdminService) Deactivate(ctx context.Context, updatedBy string) (*AISettingsView, error) {
	row, err := s.settings.Deactivate(ctx, repository.AIFeatureNomenclatureRerank, updatedBy)
	if err != nil {
		return nil, err
	}
	log.Info().
		Str("operation", "ai_settings_deactivate").
		Str("provider", "openrouter").
		Msg("ai configuration deactivated")
	return s.buildView(row, s.modelAvailability(ctx, row, false)), nil
}

// ConfigurationState — вычисление готовности конфигурации (этап 2.5;
// используется admin-view и PilotCapability-производными).
func configurationState(configured, modelSelected, testPassed bool) string {
	switch {
	case !configured:
		return "not_configured"
	case !modelSelected:
		return "model_not_selected"
	case !testPassed:
		return "test_required"
	default:
		return "ready"
	}
}
