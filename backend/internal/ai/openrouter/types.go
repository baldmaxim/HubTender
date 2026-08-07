// Package openrouter — этап 2.5: изолированный server-only клиент OpenRouter
// и безопасный adapter для AI-границы этапа 2.2 (NomenclatureReranker).
//
// Жёсткие границы пакета:
//   - API key живёт ТОЛЬКО в server env (OPENROUTER_API_KEY): не в БД, не во
//     frontend, не в логах, не в ответах API;
//   - base URL задаётся только server config (allowlist официальных URL в
//     production); из request/frontend base URL не принимается;
//   - никаких tools, external fetch, streaming, redirects;
//   - raw prompt/response не логируются и не сохраняются;
//   - provider-specific DTO не проникают в domain-слой этапа 2.2 и frontend —
//     наружу выходят только нормализованные структуры этого пакета.
package openrouter

import "encoding/json"

// ── Key status (GET /key) ────────────────────────────────────────────────────

// KeyStatus — нормализованный статус ключа. Сам ключ и management-поля сюда
// НИКОГДА не попадают (§8 задания).
type KeyStatus struct {
	Label          string   `json:"label"`
	Limit          *float64 `json:"limit"`           // USD, null = без лимита
	LimitRemaining *float64 `json:"limit_remaining"` // USD
	LimitReset     *string  `json:"limit_reset"`     // тип сброса лимита
	Usage          float64  `json:"usage"`           // USD всего
	UsageDaily     float64  `json:"usage_daily"`
	UsageWeekly    float64  `json:"usage_weekly"`
	UsageMonthly   float64  `json:"usage_monthly"`
	ByokUsage      float64  `json:"byok_usage"`
	IsFreeTier     bool     `json:"is_free_tier"`
	ExpiresAt      *string  `json:"expires_at"` // ISO 8601 либо null
}

// keyStatusEnvelope — сырой ответ GET /key (официальная схема openapi.json).
type keyStatusEnvelope struct {
	Data struct {
		Label          string   `json:"label"`
		Limit          *float64 `json:"limit"`
		LimitRemaining *float64 `json:"limit_remaining"`
		LimitReset     *string  `json:"limit_reset"`
		Usage          float64  `json:"usage"`
		UsageDaily     float64  `json:"usage_daily"`
		UsageWeekly    float64  `json:"usage_weekly"`
		UsageMonthly   float64  `json:"usage_monthly"`
		ByokUsage      float64  `json:"byok_usage"`
		IsFreeTier     bool     `json:"is_free_tier"`
		ExpiresAt      *string  `json:"expires_at"`
	} `json:"data"`
}

// ── Models catalog (GET /models/user) ────────────────────────────────────────

// rawModel — модель как её отдаёт OpenRouter (подмножество полей официальной
// схемы; цены — СТРОКОВЫЕ decimal, не float).
type rawModel struct {
	ID             string  `json:"id"`
	CanonicalSlug  string  `json:"canonical_slug"`
	Name           string  `json:"name"`
	Description    string  `json:"description"`
	Created        int64   `json:"created"`
	ExpirationDate *string `json:"expiration_date"`
	ContextLength  *int64  `json:"context_length"`
	Architecture   struct {
		Modality         *string  `json:"modality"`
		InputModalities  []string `json:"input_modalities"`
		OutputModalities []string `json:"output_modalities"`
		Tokenizer        *string  `json:"tokenizer"`
	} `json:"architecture"`
	Pricing struct {
		Prompt     string `json:"prompt"`     // USD за токен, строковый decimal
		Completion string `json:"completion"` // USD за токен, строковый decimal
		Request    string `json:"request"`    // USD за запрос, строковый decimal
	} `json:"pricing"`
	TopProvider struct {
		ContextLength       *int64 `json:"context_length"`
		MaxCompletionTokens *int64 `json:"max_completion_tokens"`
		IsModerated         bool   `json:"is_moderated"`
	} `json:"top_provider"`
	SupportedParameters []string `json:"supported_parameters"`
}

// modelsEnvelope — сырой ответ GET /models/user с pagination.
type modelsEnvelope struct {
	Data       []rawModel `json:"data"`
	TotalCount int        `json:"total_count"`
	Links      struct {
		Next *string `json:"next"`
	} `json:"links"`
}

// Model — нормализованная модель HUBTender (§5 задания). Цены сохраняются
// строковыми decimal (authoritative), display-значения /1M считает сервер.
type Model struct {
	ID                  string   `json:"id"`
	CanonicalSlug       string   `json:"canonical_slug"`
	Name                string   `json:"name"`
	Description         string   `json:"description"`
	CreatedAt           string   `json:"created_at"`      // ISO 8601 UTC
	ExpirationDate      *string  `json:"expiration_date"` // null = бессрочно
	ContextLength       *int64   `json:"context_length"`
	MaxCompletionTokens *int64   `json:"max_completion_tokens"`
	InputModalities     []string `json:"input_modalities"`
	OutputModalities    []string `json:"output_modalities"`
	Modality            string   `json:"modality"`
	Tokenizer           string   `json:"tokenizer"`
	// Цены как получены от OpenRouter: строковый decimal USD за токен/запрос.
	PromptPricePerToken     string `json:"prompt_price_per_token"`
	CompletionPricePerToken string `json:"completion_price_per_token"`
	RequestPrice            string `json:"request_price"`
	// Server-calculated display-строки (decimal-safe, БЕЗ binary float).
	PricePer1MInputTokens  string `json:"price_per_1m_input_tokens"`
	PricePer1MOutputTokens string `json:"price_per_1m_output_tokens"`

	SupportedParameters []string `json:"supported_parameters"`
	IsModerated         bool     `json:"is_moderated"`
	// StructuredOutputs — предварительный catalog-сигнал (§6): фактическая
	// поддержка подтверждается только HUBTender model test.
	StructuredOutputs bool `json:"structured_outputs_indicated"`
	// IsFreeVariant — free-вариант: показывается с предупреждением (§6).
	IsFreeVariant bool `json:"is_free_variant"`
	// Provider (организация) — author-сегмент из ID ("anthropic/..." →
	// "anthropic").
	Author string `json:"author"`
}

// ── Chat completions (POST /chat/completions) ────────────────────────────────

// ChatMessage — одно сообщение. Только text-контент (MVP §14).
type ChatMessage struct {
	Role    string `json:"role"` // system | user
	Content string `json:"content"`
}

// ProviderPrefs — routing policy (§10/§14): фиксированная privacy-политика
// этапа 2.5, из request/frontend не принимается.
type ProviderPrefs struct {
	DataCollection    string `json:"data_collection,omitempty"` // "deny"
	ZDR               *bool  `json:"zdr,omitempty"`
	RequireParameters *bool  `json:"require_parameters,omitempty"`
	AllowFallbacks    *bool  `json:"allow_fallbacks,omitempty"`
}

// JSONSchemaSpec — strict-схема structured output.
type JSONSchemaSpec struct {
	Name   string          `json:"name"`
	Strict bool            `json:"strict"`
	Schema json.RawMessage `json:"schema"`
}

// ResponseFormat — response_format c type=json_schema (официальный контракт).
type ResponseFormat struct {
	Type       string         `json:"type"` // "json_schema"
	JSONSchema JSONSchemaSpec `json:"json_schema"`
}

// ChatRequest — минимальный запрос MVP: без tools, без plugins, без stream.
type ChatRequest struct {
	Model          string          `json:"model"`
	Messages       []ChatMessage   `json:"messages"`
	MaxTokens      int             `json:"max_tokens,omitempty"`
	Temperature    *float64        `json:"temperature,omitempty"`
	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`
	Provider       *ProviderPrefs  `json:"provider,omitempty"`

	// IdempotencyKey — стабильный ключ логической задачи. В тело НЕ попадает
	// (json:"-"), уходит заголовком X-Idempotency-Key: без него повтор упавшего
	// вызова уходит upstream новым платным запросом вместо схлопывания с
	// исходным. Вычисляется в Reranker, а не передаётся вызывающим кодом.
	IdempotencyKey string `json:"-"`
}

// Usage — токены/стоимость ответа (для admin model test и usage-ledger
// этапа 2.6; в user-ответы не попадает).
//
// Cost — provider-reported стоимость (официальное поле usage.cost).
// Единица: кредиты OpenRouter; официальная документация GET /key указывает
// usage «in USD» — кредиты деноминированы в USD. json.Number сохраняет
// точное десятичное представление (учёт бюджета без binary float).
type Usage struct {
	PromptTokens     int         `json:"prompt_tokens"`
	CompletionTokens int         `json:"completion_tokens"`
	TotalTokens      int         `json:"total_tokens"`
	Cost             json.Number `json:"cost,omitempty"`
}

// ChatResponse — нормализованный ответ: только то, что нужно adapter'у.
type ChatResponse struct {
	ID      string
	Model   string
	Content string // content первого choice (JSON text при structured output)
	Usage   Usage
	// ProxyRequestID / UpstreamRequestID — id вызова в LLM-прокси и upstream-id
	// OpenRouter (gen-…) для сверки биллинга. Пусты при прямом OpenRouter.
	// Наружу пользователю не отдаются — только логи и usage-ledger.
	ProxyRequestID    string
	UpstreamRequestID string
}

// chatEnvelope — сырой ответ /chat/completions (non-streaming).
type chatEnvelope struct {
	ID      string `json:"id"`
	Model   string `json:"model"`
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Role    string          `json:"role"`
			Content json.RawMessage `json:"content"` // string для text-моделей
		} `json:"message"`
	} `json:"choices"`
	Usage Usage `json:"usage"`
	// error внутри 200-тела (редкий кейс OpenRouter) — тоже обрабатываем.
	Error *apiErrorBody `json:"error,omitempty"`
}

// apiErrorBody — официальный формат ошибки: {"error": {code, message, metadata}}.
type apiErrorBody struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type errorEnvelope struct {
	Error apiErrorBody `json:"error"`
}
