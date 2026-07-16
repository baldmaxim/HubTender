package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AISettingsRepo — этап 2.5: одна строка настроек на feature_code
// (ai_feature_settings). API key OpenRouter в БД НЕ хранится; в таблице нет
// raw prompt/response, каталога моделей и финансовых данных тендеров.
type AISettingsRepo struct {
	pool *pgxpool.Pool
}

// NewAISettingsRepo creates an AISettingsRepo.
func NewAISettingsRepo(pool *pgxpool.Pool) *AISettingsRepo {
	return &AISettingsRepo{pool: pool}
}

// AIFeatureNomenclatureRerank — единственная feature-строка MVP.
const AIFeatureNomenclatureRerank = "nomenclature_rerank"

// Статусы model test (§12 этапа 2.5).
const (
	AITestRequired = "required"
	AITestPassed   = "passed"
	AITestFailed   = "failed"
)

// ErrAISettingsConflict — конкурентное изменение конфигурации: draft/тест/
// активация разошлись (stale тест не активирует изменённую конфигурацию).
var ErrAISettingsConflict = errors.New("ai settings: concurrent configuration change")

// AIFeatureSettings — строка настроек. Указатели = NULLable-поля.
type AIFeatureSettings struct {
	FeatureCode string
	Provider    string

	SelectedModelID                  *string
	SelectedModelName                *string
	SelectedModelContextLength       *int64
	SelectedModelMaxCompletionTokens *int64
	SelectedModelPromptPrice         *string
	SelectedModelCompletionPrice     *string
	SelectedModelExpirationDate      *string
	SelectedModelSupportedParameters []string

	PromptVersion          string
	ProviderPolicyVersion  string
	RequireZDR             bool
	DataCollectionPolicy   string
	RequireParameters      bool
	AllowProviderFallbacks bool

	RequestTimeoutSeconds int
	MaxOutputTokens       int
	Temperature           float64
	CandidateLimit        int
	MaxRowsPerRequest     int
	MaxConcurrency        int
	MonthlyBudgetUSD      *float64
	// MonthlyBudgetText — тот же бюджет как numeric::text (exact decimal для
	// учёта; *float64 остаётся только для отображения в admin UI).
	MonthlyBudgetText *string

	ModelTestStatus        string
	ModelTestConfigHash    *string
	ModelTestedModelID     *string
	ModelTestedAt          *time.Time
	ModelTestLatencyMs     *int
	ModelTestInputTokens   *int
	ModelTestOutputTokens  *int
	ModelTestEstimatedCost *string
	ModelTestErrorCode     *string

	Enabled           bool
	NeedsReviewReason *string

	// Этап 2.6: controlled rollout. RolloutMode: off | evaluation |
	// pilot_individual | pilot_bulk (general availability НЕ существует).
	RolloutMode               string
	RolloutConfigVersion      int
	DailyRequestLimit         int
	DailyRowLimit             int
	RequestMaxReservedCost    string // exact decimal (numeric::text)
	CircuitFailureThreshold   int
	CircuitCooldownSeconds    int
	ReservationTimeoutSeconds int
	PilotStartedAt            *time.Time
	PilotEndedAt              *time.Time
	LastLiveEvaluationID      *string

	UpdatedBy *string
	UpdatedAt time.Time
}

// Rollout modes (§3 этапа 2.6).
const (
	AIRolloutOff             = "off"
	AIRolloutEvaluation      = "evaluation"
	AIRolloutPilotIndividual = "pilot_individual"
	AIRolloutPilotBulk       = "pilot_bulk"
)

const aiSettingsColumns = `
	feature_code, provider,
	selected_model_id, selected_model_name,
	selected_model_context_length, selected_model_max_completion_tokens,
	selected_model_prompt_price, selected_model_completion_price,
	selected_model_expiration_date, selected_model_supported_parameters,
	prompt_version, provider_policy_version,
	require_zdr, data_collection_policy, require_parameters, allow_provider_fallbacks,
	request_timeout_seconds, max_output_tokens, temperature::float8,
	candidate_limit, max_rows_per_request, max_concurrency, monthly_budget_usd::float8, monthly_budget_usd::text,
	model_test_status, model_test_config_hash, model_tested_model_id, model_tested_at,
	model_test_latency_ms, model_test_input_tokens, model_test_output_tokens,
	model_test_estimated_cost, model_test_error_code,
	enabled, needs_review_reason,
	rollout_mode, rollout_config_version, daily_request_limit, daily_row_limit,
	request_max_reserved_cost::text, circuit_failure_threshold, circuit_cooldown_seconds,
	reservation_timeout_seconds, pilot_started_at, pilot_ended_at, last_live_evaluation_id::text,
	updated_by::text, updated_at`

func scanAISettings(row pgx.Row) (*AIFeatureSettings, error) {
	var s AIFeatureSettings
	var supported []byte
	if err := row.Scan(
		&s.FeatureCode, &s.Provider,
		&s.SelectedModelID, &s.SelectedModelName,
		&s.SelectedModelContextLength, &s.SelectedModelMaxCompletionTokens,
		&s.SelectedModelPromptPrice, &s.SelectedModelCompletionPrice,
		&s.SelectedModelExpirationDate, &supported,
		&s.PromptVersion, &s.ProviderPolicyVersion,
		&s.RequireZDR, &s.DataCollectionPolicy, &s.RequireParameters, &s.AllowProviderFallbacks,
		&s.RequestTimeoutSeconds, &s.MaxOutputTokens, &s.Temperature,
		&s.CandidateLimit, &s.MaxRowsPerRequest, &s.MaxConcurrency, &s.MonthlyBudgetUSD, &s.MonthlyBudgetText,
		&s.ModelTestStatus, &s.ModelTestConfigHash, &s.ModelTestedModelID, &s.ModelTestedAt,
		&s.ModelTestLatencyMs, &s.ModelTestInputTokens, &s.ModelTestOutputTokens,
		&s.ModelTestEstimatedCost, &s.ModelTestErrorCode,
		&s.Enabled, &s.NeedsReviewReason,
		&s.RolloutMode, &s.RolloutConfigVersion, &s.DailyRequestLimit, &s.DailyRowLimit,
		&s.RequestMaxReservedCost, &s.CircuitFailureThreshold, &s.CircuitCooldownSeconds,
		&s.ReservationTimeoutSeconds, &s.PilotStartedAt, &s.PilotEndedAt, &s.LastLiveEvaluationID,
		&s.UpdatedBy, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(supported) > 0 {
		_ = json.Unmarshal(supported, &s.SelectedModelSupportedParameters)
	}
	return &s, nil
}

// GetFeatureSettings — строка настроек; отсутствующая строка создаётся с
// безопасными default'ами (enabled=false, policy locked) — self-healing для
// сред без seed.
func (r *AISettingsRepo) GetFeatureSettings(ctx context.Context, featureCode string) (*AIFeatureSettings, error) {
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO public.ai_feature_settings (feature_code)
		VALUES ($1) ON CONFLICT (feature_code) DO NOTHING`, featureCode); err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: ensure row: %w", err)
	}
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		SELECT `+aiSettingsColumns+`
		FROM public.ai_feature_settings WHERE feature_code = $1`, featureCode))
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: get: %w", err)
	}
	return s, nil
}

// AIDraftModel — snapshot выбранной модели из user-filtered каталога
// OpenRouter (§9): model ID приходит ТОЛЬКО из server-returned каталога.
type AIDraftModel struct {
	ID                  string
	Name                string
	ContextLength       *int64
	MaxCompletionTokens *int64
	PromptPrice         string
	CompletionPrice     string
	ExpirationDate      *string
	SupportedParameters []string
}

// SaveDraftModel — сохранение draft-модели (§12.A). resetTest=true (config
// hash изменился) сбрасывает тест и выключает конфигурацию. Активация здесь
// НЕВОЗМОЖНА по построению (enabled всегда false).
func (r *AISettingsRepo) SaveDraftModel(ctx context.Context, featureCode string, m AIDraftModel, resetTest bool, updatedBy string) (*AIFeatureSettings, error) {
	supported, err := json.Marshal(m.SupportedParameters)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: marshal supported: %w", err)
	}
	query := `
		UPDATE public.ai_feature_settings SET
			selected_model_id = $2,
			selected_model_name = $3,
			selected_model_context_length = $4,
			selected_model_max_completion_tokens = $5,
			selected_model_prompt_price = $6,
			selected_model_completion_price = $7,
			selected_model_expiration_date = $8,
			selected_model_supported_parameters = $9::jsonb,
			needs_review_reason = NULL,
			enabled = false,
			updated_by = $10::uuid`
	if resetTest {
		// Этап 2.6 (§4): значимое изменение конфигурации автоматически
		// переводит rollout в off и инвалидирует live evaluation —
		// pilot-гейты придётся проходить заново.
		query += `,
			model_test_status = 'required',
			model_test_config_hash = NULL,
			model_tested_model_id = NULL,
			model_tested_at = NULL,
			model_test_latency_ms = NULL,
			model_test_input_tokens = NULL,
			model_test_output_tokens = NULL,
			model_test_estimated_cost = NULL,
			model_test_error_code = NULL,
			rollout_mode = 'off',
			rollout_config_version = rollout_config_version + 1,
			last_live_evaluation_id = NULL,
			pilot_ended_at = CASE WHEN rollout_mode <> 'off' THEN now() ELSE pilot_ended_at END`
	}
	query += `
		WHERE feature_code = $1
		RETURNING ` + aiSettingsColumns
	s, err := scanAISettings(r.pool.QueryRow(ctx, query,
		featureCode, m.ID, m.Name, m.ContextLength, m.MaxCompletionTokens,
		m.PromptPrice, m.CompletionPrice, m.ExpirationDate, string(supported), updatedBy))
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: save draft: %w", err)
	}
	return s, nil
}

// AITestOutcome — результат synthetic model test (§13): только safe-поля.
type AITestOutcome struct {
	Status        string // passed | failed
	ConfigHash    string
	TestedModelID string
	LatencyMs     int
	InputTokens   int
	OutputTokens  int
	EstimatedCost *string
	ErrorCode     *string
}

// SaveTestResult — фиксация результата теста. Race-safe: если draft-модель
// изменилась, пока тест шёл, результат НЕ применяется (ErrAISettingsConflict) —
// stale тест не может валидировать новую конфигурацию (§29). Активации нет:
// enabled не трогаем (тест никогда не включает модель автоматически, §12.B).
func (r *AISettingsRepo) SaveTestResult(ctx context.Context, featureCode string, o AITestOutcome) (*AIFeatureSettings, error) {
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings SET
			model_test_status = $2,
			model_test_config_hash = $3,
			model_tested_model_id = $4,
			model_tested_at = now(),
			model_test_latency_ms = $5,
			model_test_input_tokens = $6,
			model_test_output_tokens = $7,
			model_test_estimated_cost = $8,
			model_test_error_code = $9
		WHERE feature_code = $1 AND selected_model_id = $4
		RETURNING `+aiSettingsColumns,
		featureCode, o.Status, o.ConfigHash, o.TestedModelID,
		o.LatencyMs, o.InputTokens, o.OutputTokens, o.EstimatedCost, o.ErrorCode))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAISettingsConflict
		}
		return nil, fmt.Errorf("aiSettingsRepo: save test result: %w", err)
	}
	return s, nil
}

// Activate — включение конфигурации (§12.C). Все гейты проверяет service;
// здесь — атомарная страховка от гонки «activation vs config change»: WHERE
// требует совпадения model ID, PASSED-статуса и config hash. 0 строк →
// конфигурация изменилась → ErrAISettingsConflict.
func (r *AISettingsRepo) Activate(ctx context.Context, featureCode, modelID, configHash, updatedBy string) (*AIFeatureSettings, error) {
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings SET
			enabled = true,
			needs_review_reason = NULL,
			updated_by = $4::uuid
		WHERE feature_code = $1
		  AND selected_model_id = $2
		  AND model_test_status = 'passed'
		  AND model_test_config_hash = $3
		  AND model_tested_model_id = $2
		RETURNING `+aiSettingsColumns,
		featureCode, modelID, configHash, updatedBy))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAISettingsConflict
		}
		return nil, fmt.Errorf("aiSettingsRepo: activate: %w", err)
	}
	return s, nil
}

// Deactivate — выключение (§12.D): effective provider снова DisabledProvider.
func (r *AISettingsRepo) Deactivate(ctx context.Context, featureCode, updatedBy string) (*AIFeatureSettings, error) {
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings SET
			enabled = false,
			updated_by = $2::uuid
		WHERE feature_code = $1
		RETURNING `+aiSettingsColumns, featureCode, updatedBy))
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: deactivate: %w", err)
	}
	return s, nil
}

// SetNeedsReview — модель исчезла из каталога/истекла/потеряла required
// parameters (§19): выключаем и фиксируем причину; автоматического перехода
// на другую модель НЕТ.
func (r *AISettingsRepo) SetNeedsReview(ctx context.Context, featureCode, reason string) (*AIFeatureSettings, error) {
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings SET
			enabled = false,
			needs_review_reason = $2
		WHERE feature_code = $1
		RETURNING `+aiSettingsColumns, featureCode, reason))
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: needs review: %w", err)
	}
	return s, nil
}
