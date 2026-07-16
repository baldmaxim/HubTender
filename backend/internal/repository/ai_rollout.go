package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Этап 2.6|0: rollout-переходы, пилотная группа, circuit breaker и
// evaluation summaries. Все mode/gate-решения принимает сервис; репозиторий
// даёт атомарные CAS-примитивы, безопасные для нескольких инстансов.

// ErrAIRolloutConflict — CAS-переход не применился (mode изменился параллельно).
var ErrAIRolloutConflict = errors.New("ai rollout: concurrent mode change")

// ErrAIPilotUserNotFound — пользователь не найден/неактивен для pilot-операции.
var ErrAIPilotUserNotFound = errors.New("ai rollout: pilot user not found")

// ─── Rollout mode / settings ─────────────────────────────────────────────────

// TransitionRolloutMode — CAS-переход expectedFrom → target. Каждый переход
// поднимает rollout_config_version (инвалидация in-flight запросов, §20).
func (r *AISettingsRepo) TransitionRolloutMode(ctx context.Context, featureCode, expectedFrom, target, updatedBy string) (*AIFeatureSettings, error) {
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings SET
			rollout_mode = $3,
			rollout_config_version = rollout_config_version + 1,
			pilot_started_at = CASE
				WHEN $3 = 'pilot_individual' AND rollout_mode = 'evaluation' THEN now()
				ELSE pilot_started_at END,
			pilot_ended_at = CASE WHEN $3 = 'off' THEN now() ELSE pilot_ended_at END,
			updated_by = $4::uuid
		WHERE feature_code = $1 AND rollout_mode = $2
		RETURNING `+aiSettingsColumns,
		featureCode, expectedFrom, target, updatedBy))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAIRolloutConflict
		}
		return nil, fmt.Errorf("aiSettingsRepo: transition: %w", err)
	}
	return s, nil
}

// EmergencyOff — kill switch (§11): безусловно и атомарно rollout_mode=off,
// версия конфигурации поднимается (in-flight ответы становятся stale).
// Возвращает предыдущий режим для audit-лога.
func (r *AISettingsRepo) EmergencyOff(ctx context.Context, featureCode, updatedBy string) (prevMode string, s *AIFeatureSettings, err error) {
	row := r.pool.QueryRow(ctx, `
		WITH prev AS (
			SELECT rollout_mode FROM public.ai_feature_settings WHERE feature_code = $1
		)
		UPDATE public.ai_feature_settings f SET
			rollout_mode = 'off',
			rollout_config_version = rollout_config_version + 1,
			pilot_ended_at = CASE WHEN f.rollout_mode <> 'off' THEN now() ELSE f.pilot_ended_at END,
			updated_by = $2::uuid
		FROM prev
		WHERE f.feature_code = $1
		RETURNING prev.rollout_mode, `+aiSettingsColumnsQualified("f"),
		featureCode, updatedBy)
	s, err = scanAISettingsWithPrefix(row, &prevMode)
	if err != nil {
		return "", nil, fmt.Errorf("aiSettingsRepo: emergency off: %w", err)
	}
	return prevMode, s, nil
}

// AIRolloutSettingsPatch — редактируемые операционные параметры пилота.
type AIRolloutSettingsPatch struct {
	DailyRequestLimit         *int
	DailyRowLimit             *int
	MonthlyBudgetUSD          *string // exact decimal строкой; "" → NULL
	RequestMaxReservedCost    *string
	CircuitFailureThreshold   *int
	CircuitCooldownSeconds    *int
	ReservationTimeoutSeconds *int
}

// UpdateRolloutSettings — обновление лимитов/бюджета. Поднимает
// rollout_config_version (§20: бюджетные переходы тоже инвалидируют in-flight).
func (r *AISettingsRepo) UpdateRolloutSettings(ctx context.Context, featureCode string, p AIRolloutSettingsPatch, updatedBy string) (*AIFeatureSettings, error) {
	var budget any
	if p.MonthlyBudgetUSD != nil {
		if *p.MonthlyBudgetUSD == "" {
			budget = nil
		} else {
			budget = *p.MonthlyBudgetUSD
		}
	}
	s, err := scanAISettings(r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings SET
			daily_request_limit = COALESCE($2, daily_request_limit),
			daily_row_limit = COALESCE($3, daily_row_limit),
			monthly_budget_usd = CASE WHEN $4::boolean THEN $5::numeric ELSE monthly_budget_usd END,
			request_max_reserved_cost = COALESCE($6::numeric, request_max_reserved_cost),
			circuit_failure_threshold = COALESCE($7, circuit_failure_threshold),
			circuit_cooldown_seconds = COALESCE($8, circuit_cooldown_seconds),
			reservation_timeout_seconds = COALESCE($9, reservation_timeout_seconds),
			rollout_config_version = rollout_config_version + 1,
			updated_by = $10::uuid
		WHERE feature_code = $1
		RETURNING `+aiSettingsColumns,
		featureCode, p.DailyRequestLimit, p.DailyRowLimit,
		p.MonthlyBudgetUSD != nil, budget, p.RequestMaxReservedCost,
		p.CircuitFailureThreshold, p.CircuitCooldownSeconds, p.ReservationTimeoutSeconds,
		updatedBy))
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: rollout settings: %w", err)
	}
	return s, nil
}

// SetLastLiveEvaluation — привязка последнего live-eval summary к настройкам.
func (r *AISettingsRepo) SetLastLiveEvaluation(ctx context.Context, featureCode, evalID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.ai_feature_settings SET last_live_evaluation_id = $2::uuid
		WHERE feature_code = $1`, featureCode, evalID)
	if err != nil {
		return fmt.Errorf("aiSettingsRepo: set last eval: %w", err)
	}
	return nil
}

// ─── Pilot users (§6) ────────────────────────────────────────────────────────

// AIPilotUser — запись allowlist.
type AIPilotUser struct {
	FeatureCode               string     `json:"feature_code"`
	UserID                    string     `json:"user_id"`
	FullName                  string     `json:"full_name"`
	Email                     string     `json:"email"`
	IsActive                  bool       `json:"is_active"`
	DailyRequestLimitOverride *int       `json:"daily_request_limit_override"`
	DailyRowLimitOverride     *int       `json:"daily_row_limit_override"`
	BulkConfirmationAllowed   bool       `json:"bulk_confirmation_allowed"`
	ExpiresAt                 *time.Time `json:"expires_at"`
	AddedBy                   *string    `json:"added_by"`
	CreatedAt                 time.Time  `json:"created_at"`
	UpdatedAt                 time.Time  `json:"updated_at"`
}

const aiPilotColumns = `
	p.feature_code, p.user_id::text, u.full_name, u.email, p.is_active,
	p.daily_request_limit_override, p.daily_row_limit_override,
	p.bulk_confirmation_allowed, p.expires_at, p.added_by::text,
	p.created_at, p.updated_at`

func scanPilot(row pgx.Row) (*AIPilotUser, error) {
	var p AIPilotUser
	if err := row.Scan(&p.FeatureCode, &p.UserID, &p.FullName, &p.Email, &p.IsActive,
		&p.DailyRequestLimitOverride, &p.DailyRowLimitOverride,
		&p.BulkConfirmationAllowed, &p.ExpiresAt, &p.AddedBy,
		&p.CreatedAt, &p.UpdatedAt); err != nil {
		return nil, err
	}
	return &p, nil
}

// ListPilotUsers — полный allowlist (admin-only на уровне handler).
func (r *AISettingsRepo) ListPilotUsers(ctx context.Context, featureCode string) ([]AIPilotUser, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+aiPilotColumns+`
		FROM public.ai_pilot_users p
		JOIN public.users u ON u.id = p.user_id
		WHERE p.feature_code = $1
		ORDER BY u.full_name`, featureCode)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: pilot list: %w", err)
	}
	defer rows.Close()
	out := make([]AIPilotUser, 0, 16)
	for rows.Next() {
		p, err := scanPilot(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// UpsertPilotUser — добавление/реактивация. Существование и активность
// пользователя проверяются JOIN'ом (несуществующий/удалённый → not found).
func (r *AISettingsRepo) UpsertPilotUser(ctx context.Context, featureCode, userID string, bulkAllowed bool, expiresAt *time.Time, addedBy string) (*AIPilotUser, error) {
	res, err := r.pool.Exec(ctx, `
		INSERT INTO public.ai_pilot_users (feature_code, user_id, is_active, bulk_confirmation_allowed, expires_at, added_by)
		SELECT $1, u.id, true, $3, $4, $5::uuid
		FROM public.users u
		WHERE u.id = $2::uuid AND u.access_enabled AND u.access_status = 'approved'
		ON CONFLICT (feature_code, user_id) DO UPDATE SET
			is_active = true,
			bulk_confirmation_allowed = EXCLUDED.bulk_confirmation_allowed,
			expires_at = EXCLUDED.expires_at,
			added_by = EXCLUDED.added_by`,
		featureCode, userID, bulkAllowed, expiresAt, addedBy)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: pilot upsert: %w", err)
	}
	if res.RowsAffected() == 0 {
		return nil, ErrAIPilotUserNotFound
	}
	return r.getPilot(ctx, featureCode, userID)
}

// AIPilotPatch — изменяемые поля membership.
type AIPilotPatch struct {
	IsActive                  *bool
	DailyRequestLimitOverride *int // указатель на 0 → сброс в NULL
	DailyRowLimitOverride     *int
	BulkConfirmationAllowed   *bool
	ExpiresAt                 *time.Time
	ClearExpiresAt            bool
}

// PatchPilotUser — обновление membership.
func (r *AISettingsRepo) PatchPilotUser(ctx context.Context, featureCode, userID string, p AIPilotPatch) (*AIPilotUser, error) {
	res, err := r.pool.Exec(ctx, `
		UPDATE public.ai_pilot_users SET
			is_active = COALESCE($3, is_active),
			daily_request_limit_override = CASE WHEN $4::int IS NULL THEN daily_request_limit_override
				WHEN $4::int = 0 THEN NULL ELSE $4::int END,
			daily_row_limit_override = CASE WHEN $5::int IS NULL THEN daily_row_limit_override
				WHEN $5::int = 0 THEN NULL ELSE $5::int END,
			bulk_confirmation_allowed = COALESCE($6, bulk_confirmation_allowed),
			expires_at = CASE WHEN $8 THEN NULL WHEN $7::timestamptz IS NOT NULL THEN $7::timestamptz ELSE expires_at END
		WHERE feature_code = $1 AND user_id = $2::uuid`,
		featureCode, userID, p.IsActive, p.DailyRequestLimitOverride, p.DailyRowLimitOverride,
		p.BulkConfirmationAllowed, p.ExpiresAt, p.ClearExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: pilot patch: %w", err)
	}
	if res.RowsAffected() == 0 {
		return nil, ErrAIPilotUserNotFound
	}
	return r.getPilot(ctx, featureCode, userID)
}

// RemovePilotUser — немедленное удаление из пилота (§6.10).
func (r *AISettingsRepo) RemovePilotUser(ctx context.Context, featureCode, userID string) error {
	res, err := r.pool.Exec(ctx, `
		DELETE FROM public.ai_pilot_users WHERE feature_code = $1 AND user_id = $2::uuid`,
		featureCode, userID)
	if err != nil {
		return fmt.Errorf("aiSettingsRepo: pilot remove: %w", err)
	}
	if res.RowsAffected() == 0 {
		return ErrAIPilotUserNotFound
	}
	return nil
}

func (r *AISettingsRepo) getPilot(ctx context.Context, featureCode, userID string) (*AIPilotUser, error) {
	p, err := scanPilot(r.pool.QueryRow(ctx, `
		SELECT `+aiPilotColumns+`
		FROM public.ai_pilot_users p
		JOIN public.users u ON u.id = p.user_id
		WHERE p.feature_code = $1 AND p.user_id = $2::uuid`, featureCode, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAIPilotUserNotFound
		}
		return nil, err
	}
	return p, nil
}

// GetActivePilotMembership — server-side membership текущего пользователя:
// активная, не истёкшая. nil (без ошибки) = не в пилоте.
func (r *AISettingsRepo) GetActivePilotMembership(ctx context.Context, featureCode, userID string) (*AIPilotUser, error) {
	p, err := scanPilot(r.pool.QueryRow(ctx, `
		SELECT `+aiPilotColumns+`
		FROM public.ai_pilot_users p
		JOIN public.users u ON u.id = p.user_id
		WHERE p.feature_code = $1 AND p.user_id = $2::uuid
		  AND p.is_active
		  AND (p.expires_at IS NULL OR p.expires_at > now())
		  AND u.access_enabled AND u.access_status = 'approved'`,
		featureCode, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("aiSettingsRepo: pilot membership: %w", err)
	}
	return p, nil
}

// CountActivePilotUsers — для transition-гейта «allowlist не пуст».
func (r *AISettingsRepo) CountActivePilotUsers(ctx context.Context, featureCode string) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM public.ai_pilot_users p
		JOIN public.users u ON u.id = p.user_id
		WHERE p.feature_code = $1 AND p.is_active
		  AND (p.expires_at IS NULL OR p.expires_at > now())
		  AND u.access_enabled AND u.access_status = 'approved'`, featureCode).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("aiSettingsRepo: pilot count: %w", err)
	}
	return n, nil
}

// ─── Circuit breaker (§10) — состояние в БД, атомарные переходы ─────────────

// AICircuitState — снимок circuit-строки.
type AICircuitState struct {
	FeatureCode         string     `json:"feature_code"`
	State               string     `json:"state"` // closed | open | half_open
	ConsecutiveFailures int        `json:"consecutive_failures"`
	OpenUntil           *time.Time `json:"open_until"`
	LastFailureCode     *string    `json:"last_failure_code"`
	LastSuccessAt       *time.Time `json:"last_success_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

func (r *AISettingsRepo) ensureCircuitRow(ctx context.Context, featureCode string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.ai_circuit_state (feature_code) VALUES ($1)
		ON CONFLICT (feature_code) DO NOTHING`, featureCode)
	return err
}

// GetCircuit — текущее состояние (self-healing строка).
func (r *AISettingsRepo) GetCircuit(ctx context.Context, featureCode string) (*AICircuitState, error) {
	if err := r.ensureCircuitRow(ctx, featureCode); err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: circuit ensure: %w", err)
	}
	var c AICircuitState
	err := r.pool.QueryRow(ctx, `
		SELECT feature_code, circuit_state, consecutive_failures, open_until,
		       last_failure_code, last_success_at, updated_at
		FROM public.ai_circuit_state WHERE feature_code = $1`, featureCode).
		Scan(&c.FeatureCode, &c.State, &c.ConsecutiveFailures, &c.OpenUntil,
			&c.LastFailureCode, &c.LastSuccessAt, &c.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: circuit get: %w", err)
	}
	return &c, nil
}

// CircuitAllowProbe — если open и cooldown истёк, атомарно переводит в
// half_open; true возвращается РОВНО одному инстансу (он делает probe).
func (r *AISettingsRepo) CircuitAllowProbe(ctx context.Context, featureCode string) (bool, error) {
	res, err := r.pool.Exec(ctx, `
		UPDATE public.ai_circuit_state SET circuit_state = 'half_open'
		WHERE feature_code = $1 AND circuit_state = 'open' AND open_until <= now()`,
		featureCode)
	if err != nil {
		return false, fmt.Errorf("aiSettingsRepo: circuit probe: %w", err)
	}
	return res.RowsAffected() == 1, nil
}

// CircuitRecordSuccess — успех закрывает circuit и сбрасывает счётчик.
func (r *AISettingsRepo) CircuitRecordSuccess(ctx context.Context, featureCode string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.ai_circuit_state SET
			circuit_state = 'closed', consecutive_failures = 0,
			open_until = NULL, last_success_at = now()
		WHERE feature_code = $1`, featureCode)
	if err != nil {
		return fmt.Errorf("aiSettingsRepo: circuit success: %w", err)
	}
	return nil
}

// CircuitRecordFailure — инкремент отказов; порог/половинная проба →
// open с cooldown. Возвращает новое состояние.
func (r *AISettingsRepo) CircuitRecordFailure(ctx context.Context, featureCode, failureCode string, threshold, cooldownSeconds int) (*AICircuitState, error) {
	if err := r.ensureCircuitRow(ctx, featureCode); err != nil {
		return nil, err
	}
	var c AICircuitState
	err := r.pool.QueryRow(ctx, `
		UPDATE public.ai_circuit_state SET
			consecutive_failures = consecutive_failures + 1,
			last_failure_code = $2,
			circuit_state = CASE
				WHEN circuit_state = 'half_open' THEN 'open'
				WHEN consecutive_failures + 1 >= $3 THEN 'open'
				ELSE circuit_state END,
			open_until = CASE
				WHEN circuit_state = 'half_open' OR consecutive_failures + 1 >= $3
					THEN now() + make_interval(secs => $4)
				ELSE open_until END
		WHERE feature_code = $1
		RETURNING feature_code, circuit_state, consecutive_failures, open_until,
		          last_failure_code, last_success_at, updated_at`,
		featureCode, failureCode, threshold, cooldownSeconds).
		Scan(&c.FeatureCode, &c.State, &c.ConsecutiveFailures, &c.OpenUntil,
			&c.LastFailureCode, &c.LastSuccessAt, &c.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: circuit failure: %w", err)
	}
	return &c, nil
}

// CircuitReset — админский сброс в closed (§10). Emergency off сильнее.
func (r *AISettingsRepo) CircuitReset(ctx context.Context, featureCode string) (*AICircuitState, error) {
	if err := r.ensureCircuitRow(ctx, featureCode); err != nil {
		return nil, err
	}
	if _, err := r.pool.Exec(ctx, `
		UPDATE public.ai_circuit_state SET
			circuit_state = 'closed', consecutive_failures = 0, open_until = NULL
		WHERE feature_code = $1`, featureCode); err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: circuit reset: %w", err)
	}
	return r.GetCircuit(ctx, featureCode)
}

// ─── Evaluation summaries (§14-16) ───────────────────────────────────────────

// AIEvaluationSummary — безопасный агрегат live/mock/deterministic-прогона.
type AIEvaluationSummary struct {
	ID            string          `json:"id"`
	FeatureCode   string          `json:"feature_code"`
	EvalMode      string          `json:"eval_mode"`
	DatasetKind   string          `json:"dataset_kind"`
	DatasetHash   string          `json:"dataset_hash"`
	DatasetSize   int             `json:"dataset_size"`
	ModelID       string          `json:"model_id"`
	PromptVersion string          `json:"prompt_version"`
	ConfigHash    string          `json:"config_hash"`
	Metrics       json.RawMessage `json:"metrics"`
	GatesPassed   bool            `json:"gates_passed"`
	GateDetails   json.RawMessage `json:"gate_details"`
	ExecutedBy    *string         `json:"executed_by"`
	ExecutedAt    time.Time       `json:"executed_at"`
}

// InsertEvaluationSummary — сохранение безопасного summary (без raw dataset).
func (r *AISettingsRepo) InsertEvaluationSummary(ctx context.Context, s *AIEvaluationSummary) (string, error) {
	var executedBy any
	if s.ExecutedBy != nil && *s.ExecutedBy != "" {
		executedBy = *s.ExecutedBy
	}
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.ai_evaluation_summaries
			(feature_code, eval_mode, dataset_kind, dataset_hash, dataset_size,
			 model_id, prompt_version, config_hash, metrics, gates_passed, gate_details, executed_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::uuid)
		RETURNING id::text`,
		s.FeatureCode, s.EvalMode, s.DatasetKind, s.DatasetHash, s.DatasetSize,
		s.ModelID, s.PromptVersion, s.ConfigHash, string(s.Metrics), s.GatesPassed,
		string(s.GateDetails), executedBy).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("aiSettingsRepo: eval insert: %w", err)
	}
	return id, nil
}

// ListEvaluationSummaries — история последних прогонов.
func (r *AISettingsRepo) ListEvaluationSummaries(ctx context.Context, featureCode string, limit int) ([]AIEvaluationSummary, error) {
	if limit <= 0 || limit > 50 {
		limit = 10
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, feature_code, eval_mode, dataset_kind, dataset_hash, dataset_size,
		       model_id, prompt_version, config_hash, metrics, gates_passed, gate_details,
		       executed_by::text, executed_at
		FROM public.ai_evaluation_summaries
		WHERE feature_code = $1
		ORDER BY executed_at DESC
		LIMIT $2`, featureCode, limit)
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo: eval list: %w", err)
	}
	defer rows.Close()
	out := make([]AIEvaluationSummary, 0, limit)
	for rows.Next() {
		var s AIEvaluationSummary
		if err := rows.Scan(&s.ID, &s.FeatureCode, &s.EvalMode, &s.DatasetKind, &s.DatasetHash,
			&s.DatasetSize, &s.ModelID, &s.PromptVersion, &s.ConfigHash, &s.Metrics,
			&s.GatesPassed, &s.GateDetails, &s.ExecutedBy, &s.ExecutedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// GetEvaluationSummary — по ID (для gate-проверок переходов).
func (r *AISettingsRepo) GetEvaluationSummary(ctx context.Context, id string) (*AIEvaluationSummary, error) {
	var s AIEvaluationSummary
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, feature_code, eval_mode, dataset_kind, dataset_hash, dataset_size,
		       model_id, prompt_version, config_hash, metrics, gates_passed, gate_details,
		       executed_by::text, executed_at
		FROM public.ai_evaluation_summaries WHERE id = $1::uuid`, id).
		Scan(&s.ID, &s.FeatureCode, &s.EvalMode, &s.DatasetKind, &s.DatasetHash,
			&s.DatasetSize, &s.ModelID, &s.PromptVersion, &s.ConfigHash, &s.Metrics,
			&s.GatesPassed, &s.GateDetails, &s.ExecutedBy, &s.ExecutedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("aiSettingsRepo: eval get: %w", err)
	}
	return &s, nil
}

// ─── helpers для EmergencyOff (RETURNING prev.mode + все колонки) ────────────

// aiSettingsColumnsQualified — aiSettingsColumns с префиксом таблицы
// (список колонок без скобок, поэтому достаточно split по запятой).
func aiSettingsColumnsQualified(alias string) string {
	parts := strings.Split(aiSettingsColumns, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, alias+"."+trimmed)
		}
	}
	return strings.Join(out, ", ")
}

// scanAISettingsWithPrefix — Scan prev-колонки + стандартного набора.
func scanAISettingsWithPrefix(row pgx.Row, prefix *string) (*AIFeatureSettings, error) {
	var s AIFeatureSettings
	var supported []byte
	if err := row.Scan(
		prefix,
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
