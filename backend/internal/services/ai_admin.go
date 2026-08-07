package services

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/keycrypt"
	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// aiSettingsStore — контракт хранилища настроек (реализация —
// repository.AISettingsRepo; unit-тесты используют in-memory fake с теми же
// race-гарантиями WHERE-гейтов).
type aiSettingsStore interface {
	GetFeatureSettings(ctx context.Context, featureCode string) (*repository.AIFeatureSettings, error)
	SaveDraftModel(ctx context.Context, featureCode string, m repository.AIDraftModel, resetTest bool, updatedBy string) (*repository.AIFeatureSettings, error)
	SaveTestResult(ctx context.Context, featureCode string, o repository.AITestOutcome) (*repository.AIFeatureSettings, error)
	Activate(ctx context.Context, featureCode, modelID, configHash, updatedBy string) (*repository.AIFeatureSettings, error)
	Deactivate(ctx context.Context, featureCode, updatedBy string) (*repository.AIFeatureSettings, error)
	SetNeedsReview(ctx context.Context, featureCode, reason string) (*repository.AIFeatureSettings, error)
}

// AIAdminService — этап 2.5: администрирование OpenRouter для AI-подбора
// номенклатуры. Границы:
//   - API key живёт только в server env; сервис отдаёт лишь api_key_configured;
//   - normal user traffic остаётся выключенным (rollout off): единственный
//     разрешённый live-вызов — админский synthetic model test;
//   - модель выбирается ТОЛЬКО из user-filtered каталога OpenRouter;
//   - активация возможна только после PASS model test с совпадающим config hash.
//
// aiAdminStore — полный контракт хранилища: настройки этапа 2.5 + rollout
// этапа 2.6 (реализация — repository.AISettingsRepo).
type aiAdminStore interface {
	aiSettingsStore
	aiRolloutStore
}

type AIAdminService struct {
	client   *openrouter.Client
	catalog  *openrouter.CatalogCache
	settings aiSettingsStore
	rollout  aiRolloutStore

	// liveTestEnabled — env OPENROUTER_LIVE_TEST=true (этап 2.6 §15):
	// без него live evaluation не выполняется.
	liveTestEnabled bool

	// key status cache: «Проверить подключение» всегда делает fresh request,
	// GET status может отдавать недавний результат.
	keyMu        sync.Mutex
	keyStatus    *openrouter.KeyStatus
	keyErrCode   string
	keyCheckedAt time.Time
	// proxyObservedModel — модель, фактически ответившая на последний реальный
	// вызов через LLM-прокси (вариант A: присланный model игнорируется).
	proxyObservedModel string

	// feature/ai-key-ui: UI-управление ключом (WithKeyManagement).
	keys             aiKeyStore
	keyCipher        *keycrypt.Cipher
	keyResolver      *AIKeyResolver
	envKeyConfigured bool
	keyTTL           time.Duration
}

// AIRolloutStatus — этап 2.5: пользовательские AI-вызовы выключены до
// контролируемого запуска (этап 2.6). Константа — обойти нельзя.
const AIRolloutStatus = "off"

// NewAIAdminService wires the admin AI service.
func NewAIAdminService(client *openrouter.Client, catalog *openrouter.CatalogCache, store aiAdminStore) *AIAdminService {
	return &AIAdminService{client: client, catalog: catalog, settings: store, rollout: store, keyTTL: 5 * time.Minute}
}

// ── Typed domain errors (§20 задания) ────────────────────────────────────────

var (
	ErrAIProviderNotConfigured = errors.New("AI_PROVIDER_NOT_CONFIGURED")
	ErrAICatalogUnavailable    = errors.New("AI_CATALOG_UNAVAILABLE")
	ErrAIModelNotAvailable     = errors.New("AI_MODEL_NOT_AVAILABLE")
	ErrAIModelNotSelected      = errors.New("AI_MODEL_NOT_SELECTED")
	ErrAIModelExpired          = errors.New("AI_MODEL_EXPIRED")
	ErrAIModelTestRequired     = errors.New("AI_MODEL_TEST_REQUIRED")
	ErrAIModelTestFailed       = errors.New("AI_MODEL_TEST_FAILED")
	ErrAIModelConfigChanged    = errors.New("AI_MODEL_CONFIG_CHANGED")
	ErrAIActivationNotAllowed  = errors.New("AI_MODEL_ACTIVATION_NOT_ALLOWED")
)

// ── Views (admin API) ────────────────────────────────────────────────────────

// AIConnectionView — статус подключения OpenRouter. Ключа здесь нет и быть
// не может — только api_key_configured (§3/§8).
type AIConnectionView struct {
	APIKeyConfigured bool                  `json:"api_key_configured"`
	Connection       string                `json:"connection"` // connected|not_configured|unauthorized|payment_required|rate_limited|unavailable
	Key              *openrouter.KeyStatus `json:"key,omitempty"`
	CheckedAt        *time.Time            `json:"checked_at,omitempty"`
	BaseHost         string                `json:"base_host"`
	// feature/ai-key-ui: источник действующего ключа и безопасные метаданные
	// UI-ключа. Самого ключа во view нет и быть не может.
	KeySource   string     `json:"key_source"` // ui | env | none
	KeySuffix   string     `json:"key_suffix,omitempty"`
	KeySetAt    *time.Time `json:"key_set_at,omitempty"`
	EnvFallback bool       `json:"env_key_available"` // задан ли env-ключ (как fallback)

	// ProviderMode — действующий транспорт: openrouter | proxy_llm.
	ProviderMode string `json:"provider_mode"`
	// Proxy — заполнен ТОЛЬКО в режиме proxy_llm. Key при этом всегда nil:
	// лимитов и расхода ключа прокси не отдаёт, и выдумывать их нельзя.
	Proxy *AIProxyStatus `json:"proxy,omitempty"`
}

// AIProxyStatus — то, что можно узнать о LLM-прокси без GET /key.
type AIProxyStatus struct {
	// Health — результат GET <origin>/healthz: ok | unreachable.
	//
	// ВАЖНО, чего он НЕ доказывает: /healthz публичный и лежит вне location
	// /api/, на котором висит IP-allowlist прокси. Успешный healthz не значит
	// ни что наш egress-IP разрешён, ни что токен принят — это подтверждает
	// только реальный вызов (model test).
	Health          string     `json:"health"`
	HealthCheckedAt *time.Time `json:"health_checked_at,omitempty"`
	// ObservedModel — модель, фактически ответившая на последний реальный
	// вызов. В варианте A присланный model игнорируется прокси, поэтому это
	// единственный способ узнать, что именно отработало.
	ObservedModel string `json:"observed_model,omitempty"`
	// LimitsKnown всегда false: бюджетом ключа владеет оператор прокси.
	LimitsKnown bool `json:"limits_known"`
}

// AICatalogView — каталог для admin UI.
type AICatalogView struct {
	openrouter.CatalogSnapshot
	TotalCount int `json:"total_count"`
}

// AITestView — safe-результат последнего model test.
type AITestView struct {
	Status        string     `json:"status"` // required | passed | failed
	ConfigHash    *string    `json:"config_hash,omitempty"`
	TestedModelID *string    `json:"tested_model_id,omitempty"`
	TestedAt      *time.Time `json:"tested_at,omitempty"`
	LatencyMs     *int       `json:"latency_ms,omitempty"`
	InputTokens   *int       `json:"input_tokens,omitempty"`
	OutputTokens  *int       `json:"output_tokens,omitempty"`
	EstimatedCost *string    `json:"estimated_cost_usd,omitempty"`
	ErrorCode     *string    `json:"error_code,omitempty"`
}

// AISelectedModelView — snapshot выбранной модели (остаётся видимым даже при
// недоступном каталоге, §7.B).
type AISelectedModelView struct {
	ID                  string   `json:"id"`
	Name                string   `json:"name"`
	ContextLength       *int64   `json:"context_length"`
	MaxCompletionTokens *int64   `json:"max_completion_tokens"`
	PromptPrice         *string  `json:"prompt_price_per_token"`
	CompletionPrice     *string  `json:"completion_price_per_token"`
	PricePer1MInput     string   `json:"price_per_1m_input_tokens"`
	PricePer1MOutput    string   `json:"price_per_1m_output_tokens"`
	ExpirationDate      *string  `json:"expiration_date"`
	SupportedParameters []string `json:"supported_parameters"`
}

// AISettingsView — полное admin-представление настроек.
type AISettingsView struct {
	FeatureCode      string               `json:"feature_code"`
	Provider         string               `json:"provider"`
	APIKeyConfigured bool                 `json:"api_key_configured"`
	SelectedModel    *AISelectedModelView `json:"selected_model"`

	PromptVersion         string `json:"prompt_version"`
	SchemaVersion         string `json:"schema_version"`
	ProviderPolicyVersion string `json:"provider_policy_version"`
	AdapterVersion        string `json:"adapter_version"`
	RequireZDR            bool   `json:"require_zdr"`
	// ProviderPolicyEnforced — применяются ли require_zdr /
	// data_collection_policy / require_parameters на стороне провайдера.
	// В режиме proxy_llm — false: прокси вырезает объект provider, и эти
	// поля остаются намерением, а не гарантией.
	ProviderPolicyEnforced bool   `json:"provider_policy_enforced"`
	ProviderMode           string `json:"provider_mode"`
	DataCollectionPolicy   string `json:"data_collection_policy"`
	RequireParameters      bool   `json:"require_parameters"`
	AllowFallbacks         bool   `json:"allow_provider_fallbacks"`

	RequestTimeoutSeconds int      `json:"request_timeout_seconds"`
	MaxOutputTokens       int      `json:"max_output_tokens"`
	Temperature           float64  `json:"temperature"`
	CandidateLimit        int      `json:"candidate_limit"`
	MaxRowsPerRequest     int      `json:"max_rows_per_request"`
	MaxConcurrency        int      `json:"max_concurrency"`
	MonthlyBudgetUSD      *float64 `json:"monthly_budget_usd"`
	LimitsEditable        bool     `json:"limits_editable"` // false в 2.5

	CurrentConfigHash string     `json:"current_config_hash"`
	Test              AITestView `json:"model_test"`
	Enabled           bool       `json:"enabled"`
	NeedsReviewReason *string    `json:"needs_review_reason,omitempty"`

	// ModelAvailability: not_selected|available|missing|expired|catalog_unavailable.
	ModelAvailability  string   `json:"model_availability"`
	CanActivate        bool     `json:"can_activate"`
	ActivationBlockers []string `json:"activation_blockers"`

	RolloutStatus string    `json:"rollout_status"` // off (2.5)
	UpdatedAt     time.Time `json:"updated_at"`
}

// AICapabilityView (этап 2.5) заменён расширенной AIPilotCapabilityView
// (этап 2.6, ai_rollout_ops.go): состояние ТЕКУЩЕГО пользователя, включая
// pilot-membership, квоты и статусы деградации.

// ── Connection status ────────────────────────────────────────────────────────

// Status — GET-статус: недавний кэш допустим (checked_at показывает время).
func (s *AIAdminService) Status(ctx context.Context) AIConnectionView {
	return s.keyStatusView(ctx, false)
}

// TestConnection — «Проверить подключение»: ВСЕГДА новый server request (§8).
func (s *AIAdminService) TestConnection(ctx context.Context) AIConnectionView {
	return s.keyStatusView(ctx, true)
}

func (s *AIAdminService) keyStatusView(ctx context.Context, force bool) AIConnectionView {
	view := AIConnectionView{
		APIKeyConfigured: s.client.Configured(),
		BaseHost:         s.client.BaseHost(),
		ProviderMode:     openrouter.String(s.client.Transport()),
	}
	s.decorateKeySource(ctx, &view)
	if !view.APIKeyConfigured {
		view.Connection = "not_configured"
		return view
	}
	if s.client.Transport() == openrouter.TransportProxyLLM {
		return s.proxyStatusView(ctx, view, force)
	}

	s.keyMu.Lock()
	cachedFresh := !s.keyCheckedAt.IsZero() && time.Since(s.keyCheckedAt) < s.keyTTL
	if !force && cachedFresh {
		defer s.keyMu.Unlock()
		checked := s.keyCheckedAt
		view.CheckedAt = &checked
		view.Key = s.keyStatus
		view.Connection = connectionFromCode(s.keyErrCode)
		return view
	}
	s.keyMu.Unlock()

	ks, err := s.client.GetKeyStatus(ctx)
	now := time.Now()

	s.keyMu.Lock()
	s.keyCheckedAt = now
	if err != nil {
		s.keyStatus = nil
		s.keyErrCode = openrouter.StatusCode(err)
	} else {
		s.keyStatus = &ks
		s.keyErrCode = ""
	}
	view.Key = s.keyStatus
	view.Connection = connectionFromCode(s.keyErrCode)
	view.CheckedAt = &now
	s.keyMu.Unlock()

	log.Info().
		Str("operation", "ai_openrouter_key_status").
		Str("provider", "openrouter").
		Str("key_status", view.Connection).
		Bool("forced", force).
		Msg("openrouter key status checked")
	return view
}

// proxyStatusView — статус в режиме proxy_llm. GET /key у прокси нет, поэтому
// вместо лимитов и расхода ключа доступна только liveness-проба и фактическая
// модель последнего вызова. Key остаётся nil — выдумывать лимиты нельзя.
//
// Переиспользует тот же кэш и тот же TTL, что и OpenRouter-ветка: гейты
// rollout'а проверяют свежесть CheckedAt и не должны знать про режим.
func (s *AIAdminService) proxyStatusView(ctx context.Context, view AIConnectionView, force bool) AIConnectionView {
	s.keyMu.Lock()
	cachedFresh := !s.keyCheckedAt.IsZero() && time.Since(s.keyCheckedAt) < s.keyTTL
	if !force && cachedFresh {
		checked := s.keyCheckedAt
		code, observed := s.keyErrCode, s.proxyObservedModel
		s.keyMu.Unlock()
		view.CheckedAt = &checked
		view.Connection = connectionFromCode(code)
		view.Proxy = &AIProxyStatus{
			Health: proxyHealthLabel(code), HealthCheckedAt: &checked, ObservedModel: observed,
		}
		return view
	}
	s.keyMu.Unlock()

	err := s.client.ProxyHealth(ctx)
	now := time.Now()

	s.keyMu.Lock()
	s.keyCheckedAt = now
	s.keyStatus = nil // лимиты ключа в этом режиме неизвестны by design
	s.keyErrCode = openrouter.StatusCode(err)
	code, observed := s.keyErrCode, s.proxyObservedModel
	s.keyMu.Unlock()

	view.CheckedAt = &now
	view.Connection = connectionFromCode(code)
	view.Proxy = &AIProxyStatus{
		Health: proxyHealthLabel(code), HealthCheckedAt: &now, ObservedModel: observed,
	}
	log.Info().
		Str("operation", "ai_proxy_health").
		Str("provider_mode", openrouter.String(openrouter.TransportProxyLLM)).
		Str("health", view.Proxy.Health).
		Bool("forced", force).
		Msg("llm proxy health checked")
	return view
}

func proxyHealthLabel(code string) string {
	if code == "" {
		return "ok"
	}
	return "unreachable"
}

// SetProxyObservedModel фиксирует модель, фактически ответившую на реальный
// вызов. В варианте A прокси игнорирует присланный model, поэтому расхождение
// с протестированной моделью — единственный сигнал о её подмене оператором.
func (s *AIAdminService) SetProxyObservedModel(model string) {
	if strings.TrimSpace(model) == "" {
		return
	}
	s.keyMu.Lock()
	s.proxyObservedModel = model
	s.keyMu.Unlock()
}

func connectionFromCode(code string) string {
	switch code {
	case "":
		return "connected"
	case "not_configured", "unauthorized", "payment_required", "rate_limited":
		return code
	default:
		return "unavailable"
	}
}

// ── Models catalog ───────────────────────────────────────────────────────────

// Models — каталог из кэша (TTL 15 мин); forceRefresh — ручное обновление.
func (s *AIAdminService) Models(ctx context.Context, forceRefresh bool) AICatalogView {
	snap := s.catalog.Get(ctx, forceRefresh)
	log.Info().
		Str("operation", "ai_openrouter_models_catalog").
		Str("provider", "openrouter").
		Str("catalog_status", snap.Status).
		Int("models_count", len(snap.Models)).
		Bool("forced", forceRefresh).
		Str("error_code", snap.LastErrorCode).
		Msg("openrouter models catalog served")
	return AICatalogView{CatalogSnapshot: snap, TotalCount: len(snap.Models)}
}

// ── Settings ─────────────────────────────────────────────────────────────────

// rerankSettingsFor — effective adapter-настройки из строки БД (§15: только
// backend; frontend не влияет на provider/model/policy/prompt).
// effectivePolicyVersion — действующая версия privacy/routing-политики.
//
// В режиме proxy_llm она ОТЛИЧАЕТСЯ от записанной в БД, потому что прокси
// вырезает объект provider и политика из настроек фактически не применяется.
// Значение входит в ComputeConfigHash, поэтому смена транспорта автоматически
// расходится с сохранённым model_test_config_hash: активация снимается,
// rollout выключается, и оператор обязан перезапустить model test, уже видя
// новую версию политики. Fail-closed без единой новой проверки.
//
// Считается от транспорта, а не хранится в колонке: иначе откат env оставил бы
// в БД лгущее значение.
func (s *AIAdminService) effectivePolicyVersion(row *repository.AIFeatureSettings) string {
	if s.client != nil && s.client.Transport() == openrouter.TransportProxyLLM {
		return openrouter.ProviderPolicyVersionProxy
	}
	return row.ProviderPolicyVersion
}

// ProviderPolicyEnforced — применяется ли записанная в настройках
// privacy-политика на стороне провайдера.
func (s *AIAdminService) ProviderPolicyEnforced() bool {
	return s.client == nil || s.client.Transport() != openrouter.TransportProxyLLM
}

func (s *AIAdminService) rerankSettingsFor(row *repository.AIFeatureSettings, modelID string) openrouter.RerankSettings {
	st := rerankSettingsFor(row, modelID)
	st.ProviderPolicyVersion = s.effectivePolicyVersion(row)
	return st
}

func (s *AIAdminService) configHashFor(row *repository.AIFeatureSettings, modelID string) string {
	return configHashWithPolicy(row, modelID, s.effectivePolicyVersion(row))
}

func rerankSettingsFor(row *repository.AIFeatureSettings, modelID string) openrouter.RerankSettings {
	return openrouter.RerankSettings{
		ModelID:               modelID,
		Temperature:           row.Temperature,
		MaxOutputTokens:       row.MaxOutputTokens,
		RequireZDR:            row.RequireZDR,
		DataCollection:        row.DataCollectionPolicy,
		RequireParameters:     row.RequireParameters,
		AllowFallbacks:        row.AllowProviderFallbacks,
		PromptVersion:         row.PromptVersion,
		ProviderPolicyVersion: row.ProviderPolicyVersion,
	}
}

// configHashFor — текущий config hash (§11) для произвольного model ID.
func configHashWithPolicy(row *repository.AIFeatureSettings, modelID, policyVersion string) string {
	return openrouter.ComputeConfigHash(openrouter.ConfigHashInput{
		ModelID:                modelID,
		PromptVersion:          row.PromptVersion,
		SchemaVersion:          openrouter.SchemaVersion,
		ProviderPolicyVersion:  policyVersion,
		RequireZDR:             row.RequireZDR,
		DataCollectionPolicy:   row.DataCollectionPolicy,
		RequireParameters:      row.RequireParameters,
		AllowProviderFallbacks: row.AllowProviderFallbacks,
		Temperature:            row.Temperature,
		MaxOutputTokens:        row.MaxOutputTokens,
		AdapterVersion:         openrouter.AdapterVersion,
	})
}

func currentModelID(row *repository.AIFeatureSettings) string {
	if row.SelectedModelID == nil {
		return ""
	}
	return *row.SelectedModelID
}

// GetSettings — admin-представление. Если enabled-модель исчезла из СВЕЖЕГО
// каталога или истекла — автоматически выключаем и помечаем needs_review
// (§19); автоперехода на другую модель нет.
func (s *AIAdminService) GetSettings(ctx context.Context) (*AISettingsView, error) {
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	availability := s.modelAvailability(ctx, row, false)
	if row.Enabled && (availability == "missing" || availability == "expired") {
		reason := "Выбранная модель недоступна в каталоге OpenRouter"
		if availability == "expired" {
			reason = "Срок действия выбранной модели истёк"
		}
		if row, err = s.settings.SetNeedsReview(ctx, repository.AIFeatureNomenclatureRerank, reason); err != nil {
			return nil, err
		}
		log.Warn().
			Str("operation", "ai_settings_needs_review").
			Str("provider", "openrouter").
			Str("model", currentModelID(row)).
			Str("availability", availability).
			Msg("selected model no longer available; configuration disabled")
	}
	return s.buildView(row, availability), nil
}

// modelAvailability — состояние выбранной модели против каталога.
// refreshIfMissing=true — активация: пробуем ручное обновление каталога.
func (s *AIAdminService) modelAvailability(ctx context.Context, row *repository.AIFeatureSettings, refreshIfMissing bool) string {
	modelID := currentModelID(row)
	if modelID == "" {
		return "not_selected"
	}
	if expiredSnapshot(row) {
		return "expired"
	}
	snap := s.catalog.Get(ctx, false)
	if snap.Status == openrouter.CatalogUnavailable {
		return "catalog_unavailable"
	}
	if _, ok := s.catalog.FindModel(modelID); ok {
		return "available"
	}
	if refreshIfMissing {
		snap = s.catalog.Get(ctx, true)
		if snap.Status == openrouter.CatalogUnavailable {
			return "catalog_unavailable"
		}
		if _, ok := s.catalog.FindModel(modelID); ok {
			return "available"
		}
	}
	return "missing"
}

// expiredSnapshot — snapshot expiration_date в прошлом (UTC-день).
func expiredSnapshot(row *repository.AIFeatureSettings) bool {
	if row.SelectedModelExpirationDate == nil {
		return false
	}
	raw := strings.TrimSpace(*row.SelectedModelExpirationDate)
	if raw == "" {
		return false
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return !t.After(time.Now())
		}
	}
	return false
}

func (s *AIAdminService) buildView(row *repository.AIFeatureSettings, availability string) *AISettingsView {
	view := &AISettingsView{
		FeatureCode:      row.FeatureCode,
		Provider:         row.Provider,
		APIKeyConfigured: s.client.Configured(),

		PromptVersion:          row.PromptVersion,
		SchemaVersion:          openrouter.SchemaVersion,
		ProviderPolicyVersion:  s.effectivePolicyVersion(row),
		ProviderPolicyEnforced: s.ProviderPolicyEnforced(),
		ProviderMode:           openrouter.String(s.client.Transport()),
		AdapterVersion:         openrouter.AdapterVersion,
		RequireZDR:             row.RequireZDR,
		DataCollectionPolicy:   row.DataCollectionPolicy,
		RequireParameters:      row.RequireParameters,
		AllowFallbacks:         row.AllowProviderFallbacks,

		RequestTimeoutSeconds: row.RequestTimeoutSeconds,
		MaxOutputTokens:       row.MaxOutputTokens,
		Temperature:           row.Temperature,
		CandidateLimit:        row.CandidateLimit,
		MaxRowsPerRequest:     row.MaxRowsPerRequest,
		MaxConcurrency:        row.MaxConcurrency,
		MonthlyBudgetUSD:      row.MonthlyBudgetUSD,
		LimitsEditable:        false, // пилотные лимиты — этап 2.6

		Test: AITestView{
			Status:        row.ModelTestStatus,
			ConfigHash:    row.ModelTestConfigHash,
			TestedModelID: row.ModelTestedModelID,
			TestedAt:      row.ModelTestedAt,
			LatencyMs:     row.ModelTestLatencyMs,
			InputTokens:   row.ModelTestInputTokens,
			OutputTokens:  row.ModelTestOutputTokens,
			EstimatedCost: row.ModelTestEstimatedCost,
			ErrorCode:     row.ModelTestErrorCode,
		},
		Enabled:           row.Enabled,
		NeedsReviewReason: row.NeedsReviewReason,
		ModelAvailability: availability,
		RolloutStatus:     AIRolloutStatus,
		UpdatedAt:         row.UpdatedAt,
	}
	if row.SelectedModelID != nil {
		view.SelectedModel = &AISelectedModelView{
			ID:                  *row.SelectedModelID,
			ContextLength:       row.SelectedModelContextLength,
			MaxCompletionTokens: row.SelectedModelMaxCompletionTokens,
			PromptPrice:         row.SelectedModelPromptPrice,
			CompletionPrice:     row.SelectedModelCompletionPrice,
			ExpirationDate:      row.SelectedModelExpirationDate,
			SupportedParameters: row.SelectedModelSupportedParameters,
		}
		if row.SelectedModelName != nil {
			view.SelectedModel.Name = *row.SelectedModelName
		}
		if row.SelectedModelPromptPrice != nil {
			view.SelectedModel.PricePer1MInput = openrouter.PricePer1M(*row.SelectedModelPromptPrice)
		}
		if row.SelectedModelCompletionPrice != nil {
			view.SelectedModel.PricePer1MOutput = openrouter.PricePer1M(*row.SelectedModelCompletionPrice)
		}
		view.CurrentConfigHash = s.configHashFor(row, *row.SelectedModelID)
	}
	view.ActivationBlockers = activationBlockers(row, view, availability)
	view.CanActivate = len(view.ActivationBlockers) == 0 && !row.Enabled
	return view
}

// activationBlockers — все причины, по которым активация невозможна (§12.C).
func activationBlockers(row *repository.AIFeatureSettings, view *AISettingsView, availability string) []string {
	var blockers []string
	if !view.APIKeyConfigured {
		blockers = append(blockers, "api_key_not_configured")
	}
	if row.SelectedModelID == nil {
		blockers = append(blockers, "model_not_selected")
		return blockers
	}
	switch availability {
	case "missing":
		blockers = append(blockers, "model_missing_in_catalog")
	case "expired":
		blockers = append(blockers, "model_expired")
	case "catalog_unavailable":
		blockers = append(blockers, "catalog_unavailable")
	}
	switch row.ModelTestStatus {
	case repository.AITestPassed:
		if row.ModelTestConfigHash == nil || *row.ModelTestConfigHash != view.CurrentConfigHash {
			blockers = append(blockers, "config_hash_mismatch")
		}
		if row.ModelTestedModelID == nil || *row.ModelTestedModelID != *row.SelectedModelID {
			blockers = append(blockers, "test_model_mismatch")
		}
	case repository.AITestFailed:
		blockers = append(blockers, "model_test_failed")
	default:
		blockers = append(blockers, "model_test_required")
	}
	return blockers
}
