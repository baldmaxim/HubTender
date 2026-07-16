package openrouter

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
)

// Версии контракта (§11 задания): участвуют в config hash. Меняются ТОЛЬКО
// вместе с реальным изменением схемы/политики/adapter-логики.
const (
	// SchemaVersion — версия strict JSON Schema structured output.
	SchemaVersion = "nomenclature-rerank-schema-v1"
	// ProviderPolicyVersion — версия privacy/routing-политики (§10).
	ProviderPolicyVersion = "openrouter-policy-v1"
	// AdapterVersion — версия OpenRouterReranker.
	AdapterVersion = "openrouter-reranker-v1"
)

// RerankSettings — effective-настройки adapter'а. Приходят ТОЛЬКО из backend
// (сохранённый draft/настройки, §15): frontend не может передать provider,
// model, endpoint, temperature, routing policy или prompt.
type RerankSettings struct {
	ModelID           string
	Temperature       float64
	MaxOutputTokens   int
	RequireZDR        bool
	DataCollection    string // "deny" (§10; UI в 2.5 не ослабляет)
	RequireParameters bool
	AllowFallbacks    bool
}

// rerankResponseSchema — strict JSON Schema (§14): additionalProperties=false,
// все поля required (nullable — через union-тип). Форма 1:1 с domain-выходом
// этапа 2.2 (ainom.RowResult).
const rerankResponseSchema = `{
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "results": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "row_reference": { "type": "string" },
          "selected_candidate_id": { "type": ["string", "null"] },
          "ranked_candidate_ids": {
            "type": "array", "items": { "type": "string" }, "maxItems": 3
          },
          "confidence": {
            "type": "string", "enum": ["high", "medium", "low", "abstain"]
          },
          "explanation": { "type": "string", "maxLength": 300 },
          "matched_features": { "type": "array", "items": { "type": "string" } },
          "conflicting_features": { "type": "array", "items": { "type": "string" } },
          "abstain_reason": { "type": ["string", "null"] }
        },
        "required": [
          "row_reference", "selected_candidate_id", "ranked_candidate_ids",
          "confidence", "explanation", "matched_features",
          "conflicting_features", "abstain_reason"
        ]
      }
    }
  },
  "required": ["results"]
}`

// Reranker — OpenRouter-реализация ainom.NomenclatureReranker (§15).
// Никаких tools, external fetch, streaming; financial-поля и идентификаторы
// тендера в запрос не попадают по построению (типы этапа 2.2).
type Reranker struct {
	client   *Client
	settings RerankSettings
}

// NewReranker — adapter поверх клиента с effective-настройками backend.
func NewReranker(client *Client, s RerankSettings) *Reranker {
	return &Reranker{client: client, settings: s}
}

// Rerank implements ainom.NomenclatureReranker.
func (r *Reranker) Rerank(ctx context.Context, req ainom.RerankBatchRequest) (ainom.RerankBatchResponse, error) {
	resp, _, err := r.RerankWithUsage(ctx, req)
	return resp, err
}

// RerankWithUsage — то же + usage (нужно ТОЛЬКО admin model test'у; в
// user-ответы usage не попадает).
func (r *Reranker) RerankWithUsage(ctx context.Context, req ainom.RerankBatchRequest) (ainom.RerankBatchResponse, Usage, error) {
	payload, err := ainom.MarshalProviderRequest(req)
	if err != nil {
		return ainom.RerankBatchResponse{Status: ainom.ProviderInvalidResponse}, Usage{}, err
	}

	temp := r.settings.Temperature
	zdr := r.settings.RequireZDR
	reqParams := r.settings.RequireParameters
	fallbacks := r.settings.AllowFallbacks
	chatReq := ChatRequest{
		Model: r.settings.ModelID,
		Messages: []ChatMessage{
			{Role: "system", Content: ainom.SystemInstruction},
			{Role: "user", Content: "Данные для сопоставления (JSON):\n" + string(payload)},
		},
		MaxTokens:   r.settings.MaxOutputTokens,
		Temperature: &temp,
		ResponseFormat: &ResponseFormat{
			Type: "json_schema",
			JSONSchema: JSONSchemaSpec{
				Name:   "nomenclature_rerank",
				Strict: true,
				Schema: json.RawMessage(rerankResponseSchema),
			},
		},
		Provider: &ProviderPrefs{
			DataCollection:    r.settings.DataCollection,
			ZDR:               &zdr,
			RequireParameters: &reqParams,
			AllowFallbacks:    &fallbacks,
		},
	}

	chatResp, err := r.client.CreateChatCompletion(ctx, chatReq)
	if err != nil {
		return ainom.RerankBatchResponse{Status: providerStatusFromErr(err)}, Usage{}, err
	}

	// Локальная повторная валидация (§14/§15.12): OpenRouter schema
	// enforcement — не единственная линия защиты.
	var parsed struct {
		Results []ainom.RowResult `json:"results"`
	}
	if err := json.Unmarshal([]byte(chatResp.Content), &parsed); err != nil {
		return ainom.RerankBatchResponse{Status: ainom.ProviderInvalidResponse}, chatResp.Usage,
			fmt.Errorf("openrouter reranker: malformed structured output: %w", ErrInvalidResponse)
	}

	// Пропускаем наружу только результаты для строк ИЗ запроса и только со
	// ссылками на разрешённые candidate ID. Невалидная строка отбрасывается —
	// deterministic candidates у неё сохраняются (§11 этапа 2.2).
	allowedByRef := make(map[string]map[string]bool, len(req.Rows))
	for _, row := range req.Rows {
		set := make(map[string]bool, len(row.Candidates))
		for _, c := range row.Candidates {
			set[c.ID] = true
		}
		allowedByRef[row.Row.RowReference] = set
	}
	out := make([]ainom.RowResult, 0, len(parsed.Results))
	for _, rr := range parsed.Results {
		allowed, known := allowedByRef[rr.RowReference]
		if !known {
			continue // неизвестный row reference — отбрасываем
		}
		validated, invalid := ainom.ValidateRowResult(rr, rr.RowReference, allowed)
		if invalid != "" {
			continue // неизвестный/повторный ID и т.п. — строка отбрасывается
		}
		out = append(out, validated)
	}

	return ainom.RerankBatchResponse{
		Status:  ainom.ProviderAvailable,
		Model:   chatResp.Model,
		Results: out,
	}, chatResp.Usage, nil
}

// providerStatusFromErr — typed OpenRouter errors → canonical provider status
// этапа 2.2 (§15.14). Raw provider body сюда не попадает.
func providerStatusFromErr(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return ainom.ProviderTimeout
	case errors.Is(err, ErrRateLimited):
		return ainom.ProviderRateLimited
	case errors.Is(err, ErrInvalidResponse):
		return ainom.ProviderInvalidResponse
	case errors.Is(err, ErrNotConfigured):
		return ainom.ProviderDisabled
	default:
		return ainom.ProviderUnavailable
	}
}
