package repository

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/jackc/pgx/v5"
)

// Этап 2.6|0: usage ledger — распределённые квоты, бюджетные резервации с
// exact-decimal учётом и reconciliation, per-row feedback (без raw text).
//
// Атомарность между инстансами: pg_advisory_xact_lock по feature_code
// сериализует «проверить квоты/бюджет → создать reservation» — два
// параллельных запроса не могут оба пройти за последний слот.

// AIQuotaDenial — типизированные исходы квотного гейта.
var (
	ErrAIUserQuotaExhausted = errors.New("user_quota_exhausted")
	ErrAIRowQuotaExhausted  = errors.New("row_quota_exhausted")
	ErrAIBudgetExhausted    = errors.New("budget_exhausted")
	// ErrAITokenBudgetExhausted — исчерпан месячный потолок в токенах. Нужен
	// там, где цена модели неизвестна и денежный бюджет неизмерим.
	ErrAITokenBudgetExhausted = errors.New("token_budget_exhausted")
)

// AIReservationInput — вход атомарной резервации.
type AIReservationInput struct {
	FeatureCode     string
	UserID          string
	ModelID         string
	PromptVersion   string
	ConfigHash      string
	RequestHash     string
	RowsCount       int
	CandidatesCount int
	// Amount — консервативная оценка стоимости, exact decimal строкой.
	Amount string
	// Лимиты пользователя (после overrides) и таймаут — снимок настроек.
	DailyRequestLimit int
	DailyRowLimit     int
	// MonthlyBudget — "" = бюджет не задан (запрещаем в pilot на слое сервиса).
	MonthlyBudget  string
	TimeoutSeconds int
	// MonthlyTokenBudget — измеримый потолок в токенах; 0 = не задан.
	//
	// Нужен там, где цена модели неизвестна (режим proxy_llm: каталога нет,
	// usage.cost прокси обычно не отдаёт). В этом случае денежный бюджет
	// вырождается в счётчик запросов по плоскому резерву, а токены остаются
	// единственной величиной, которую действительно можно измерить.
	MonthlyTokenBudget int64
	// TokenReservation — оценка токенов запроса, та же формула, что и у
	// денежного резерва. Учитывается для запросов «в полёте».
	TokenReservation int64
}

// AIReservation — созданная запись.
type AIReservation struct {
	RequestID string
	ExpiresAt time.Time
}

// ReserveUsage — атомарная резервация квоты и бюджета (§7/§8).
// Все периоды — UTC-день/UTC-месяц.
func (r *AISettingsRepo) ReserveUsage(ctx context.Context, in AIReservationInput) (*AIReservation, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("aiUsage: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Сериализация всех reservation-решений feature (бюджет глобальный).
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('ai_rollout:' || $1))`, in.FeatureCode); err != nil {
		return nil, fmt.Errorf("aiUsage: advisory lock: %w", err)
	}

	// Квоты пользователя за UTC-день: считаются все не-released запросы
	// (reserved+completed+failed); released квоту не потребляют.
	var reqToday, rowsToday int
	if err := tx.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(rows_count), 0)
		FROM public.ai_usage_requests
		WHERE feature_code = $1 AND user_id = $2::uuid
		  AND request_status <> 'released'
		  AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
		in.FeatureCode, in.UserID).Scan(&reqToday, &rowsToday); err != nil {
		return nil, fmt.Errorf("aiUsage: daily counters: %w", err)
	}
	if reqToday >= in.DailyRequestLimit {
		return nil, ErrAIUserQuotaExhausted
	}
	if rowsToday+in.RowsCount > in.DailyRowLimit {
		return nil, ErrAIRowQuotaExhausted
	}

	// Месячный бюджет: completed по фактической цене (actual → estimated →
	// reservation), reserved/failed — по reservation_amount.
	if in.MonthlyBudget != "" {
		var spent string
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(sum(CASE
				WHEN request_status = 'completed'
					THEN COALESCE(actual_provider_cost, estimated_cost, reservation_amount)
				WHEN request_status IN ('reserved', 'failed') THEN reservation_amount
				ELSE 0 END), 0)::text
			FROM public.ai_usage_requests
			WHERE feature_code = $1
			  AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
			in.FeatureCode).Scan(&spent); err != nil {
			return nil, fmt.Errorf("aiUsage: monthly spent: %w", err)
		}
		spentRat, ok1 := new(big.Rat).SetString(spent)
		budgetRat, ok2 := new(big.Rat).SetString(in.MonthlyBudget)
		amountRat, ok3 := new(big.Rat).SetString(in.Amount)
		if !ok1 || !ok2 || !ok3 {
			return nil, fmt.Errorf("aiUsage: non-decimal budget arithmetic input")
		}
		if new(big.Rat).Add(spentRat, amountRat).Cmp(budgetRat) > 0 {
			return nil, ErrAIBudgetExhausted
		}
	}

	// Месячный потолок в токенах: completed — по фактическим total_tokens,
	// reserved/failed — по оценке reserved_tokens (запросы «в полёте» обязаны
	// учитываться, иначе потолок превышается на max_concurrency × размер запроса).
	if in.MonthlyTokenBudget > 0 {
		var spentTokens int64
		if err := tx.QueryRow(ctx, `
			SELECT COALESCE(sum(CASE
				WHEN request_status = 'completed'
					THEN COALESCE(total_tokens, reserved_tokens, 0)
				WHEN request_status IN ('reserved', 'failed') THEN COALESCE(reserved_tokens, 0)
				ELSE 0 END), 0)
			FROM public.ai_usage_requests
			WHERE feature_code = $1
			  AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
			in.FeatureCode).Scan(&spentTokens); err != nil {
			return nil, fmt.Errorf("aiUsage: monthly tokens: %w", err)
		}
		if spentTokens+in.TokenReservation > in.MonthlyTokenBudget {
			return nil, ErrAITokenBudgetExhausted
		}
	}

	res := &AIReservation{}
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.ai_usage_requests
			(feature_code, user_id, model_id, prompt_version, config_hash, request_hash,
			 rows_count, candidates_count, reservation_amount, request_status,
			 reservation_expires_at, reserved_tokens)
		VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9::numeric, 'reserved',
			now() + make_interval(secs => $10), NULLIF($11::bigint, 0))
		RETURNING id::text, reservation_expires_at`,
		in.FeatureCode, in.UserID, in.ModelID, in.PromptVersion, in.ConfigHash, in.RequestHash,
		in.RowsCount, in.CandidatesCount, in.Amount, in.TimeoutSeconds, in.TokenReservation).
		Scan(&res.RequestID, &res.ExpiresAt); err != nil {
		return nil, fmt.Errorf("aiUsage: insert reservation: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("aiUsage: commit: %w", err)
	}
	return res, nil
}

// AIUsageOutcome — reconciliation после provider-ответа (§8).
type AIUsageOutcome struct {
	RequestID        string
	Status           string // completed | released | failed
	ProviderOutcome  string // available | timeout | ... | stale_discarded
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	// ActualProviderCost — provider-reported cost (usage.cost), decimal-строка;
	// "" = провайдер не сообщил.
	ActualProviderCost string
	// EstimatedCost — catalog-оценка по токенам; "" = нет.
	EstimatedCost string
	LatencyMs     int
	// ObservedModel — модель, ФАКТИЧЕСКИ ответившая. В режиме proxy_llm может
	// отличаться от model_id: прокси игнорирует присланный model.
	ObservedModel string
	// UpstreamRequestID — x-openrouter-request-id (gen-…) для сверки биллинга.
	UpstreamRequestID string
}

// ReconcileUsage — завершение reservation: фиксация фактов, освобождение
// излишка (сумма остаётся как actual/estimated), пометка underestimate при
// actual > reserved (превышение не скрывается).
func (r *AISettingsRepo) ReconcileUsage(ctx context.Context, o AIUsageOutcome) error {
	costSource := any(nil)
	actual := any(nil)
	estimated := any(nil)
	if o.ActualProviderCost != "" {
		costSource = "provider_reported"
		actual = o.ActualProviderCost
	} else if o.EstimatedCost != "" {
		costSource = "catalog_estimate"
	} else if o.Status == "completed" {
		// Ни provider-reported стоимости, ни catalog-оценки: цена модели
		// неизвестна (режим proxy_llm — каталога нет, usage.cost прокси обычно
		// не отдаёт). Расход учитывается по плоскому резерву, и выдавать это за
		// catalog_estimate нельзя — отчёты о расходе стали бы враньём.
		costSource = "unpriced_reservation"
	}
	if o.EstimatedCost != "" {
		estimated = o.EstimatedCost
	}
	res, err := r.pool.Exec(ctx, `
		UPDATE public.ai_usage_requests SET
			request_status = $2,
			provider_outcome = $3,
			prompt_tokens = $4,
			completion_tokens = $5,
			total_tokens = $6,
			actual_provider_cost = $7::numeric,
			estimated_cost = $8::numeric,
			cost_source = $9,
			latency_ms = $10,
			observed_model = NULLIF($11, ''),
			upstream_request_id = NULLIF($12, ''),
			reservation_underestimate = ($7::numeric IS NOT NULL AND $7::numeric > reservation_amount),
			completed_at = now()
		WHERE id = $1::uuid AND request_status = 'reserved'`,
		o.RequestID, o.Status, o.ProviderOutcome, o.PromptTokens, o.CompletionTokens,
		o.TotalTokens, actual, estimated, costSource, o.LatencyMs,
		o.ObservedModel, o.UpstreamRequestID)
	if err != nil {
		return fmt.Errorf("aiUsage: reconcile: %w", err)
	}
	if res.RowsAffected() == 0 {
		// Идемпотентность: запрос уже reconciled/released (recovery успел).
		return nil
	}
	return nil
}

// RecoverExpiredReservations — освобождение просроченных reservation после
// crash (§8): multi-instance-safe идемпотентный UPDATE. Возвращает число.
func (r *AISettingsRepo) RecoverExpiredReservations(ctx context.Context, featureCode string) (int64, error) {
	res, err := r.pool.Exec(ctx, `
		UPDATE public.ai_usage_requests SET
			request_status = 'released',
			provider_outcome = COALESCE(provider_outcome, 'reservation_expired'),
			completed_at = now()
		WHERE feature_code = $1 AND request_status = 'reserved'
		  AND reservation_expires_at < now()`, featureCode)
	if err != nil {
		return 0, fmt.Errorf("aiUsage: recover: %w", err)
	}
	return res.RowsAffected(), nil
}

// AIUserQuotaState — остатки текущего пользователя для capability (§17).
type AIUserQuotaState struct {
	RequestsUsedToday int
	RowsUsedToday     int
}

// GetUserQuotaState — счётчики пользователя за UTC-день.
func (r *AISettingsRepo) GetUserQuotaState(ctx context.Context, featureCode, userID string) (*AIUserQuotaState, error) {
	var q AIUserQuotaState
	err := r.pool.QueryRow(ctx, `
		SELECT count(*), COALESCE(sum(rows_count), 0)
		FROM public.ai_usage_requests
		WHERE feature_code = $1 AND user_id = $2::uuid
		  AND request_status <> 'released'
		  AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
		featureCode, userID).Scan(&q.RequestsUsedToday, &q.RowsUsedToday)
	if err != nil {
		return nil, fmt.Errorf("aiUsage: quota state: %w", err)
	}
	return &q, nil
}

// AIUsageSummary — админский агрегат (§18.D).
type AIUsageSummary struct {
	RequestsToday        int    `json:"requests_today"`
	RequestsMonth        int    `json:"requests_month"`
	RowsToday            int    `json:"rows_today"`
	RowsMonth            int    `json:"rows_month"`
	TokensMonth          int64  `json:"tokens_month"`
	ProviderCostMonth    string `json:"provider_cost_month_usd"`
	EstimatedCostMonth   string `json:"estimated_cost_month_usd"`
	ReservedActiveAmount string `json:"reserved_active_amount_usd"`
	ActiveReservations   int    `json:"active_reservations"`
	OldestReservationSec int64  `json:"oldest_reservation_age_seconds"`
	TimeoutsMonth        int    `json:"timeouts_month"`
	RateLimitedMonth     int    `json:"rate_limited_month"`
	InvalidMonth         int    `json:"invalid_month"`
	StaleDiscardedMonth  int    `json:"stale_discarded_month"`
	FeedbackAccepted     int    `json:"feedback_accepted"`
	FeedbackChanged      int    `json:"feedback_changed"`
	FeedbackManual       int    `json:"feedback_manual"`
	FeedbackAbstained    int    `json:"feedback_abstained"`
	FeedbackUnresolved   int    `json:"feedback_unresolved"`
	HighConfChanged      int    `json:"high_confidence_changed"`
	HighConfTotal        int    `json:"high_confidence_total"`
	SuccessfulOutcomes   int    `json:"successful_row_outcomes"`
}

// GetUsageSummary — сводка за UTC-день/месяц + feedback-метрики.
func (r *AISettingsRepo) GetUsageSummary(ctx context.Context, featureCode string) (*AIUsageSummary, error) {
	var s AIUsageSummary
	err := r.pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND request_status <> 'released'),
			count(*) FILTER (WHERE request_status <> 'released'),
			COALESCE(sum(rows_count) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND request_status <> 'released'), 0),
			COALESCE(sum(rows_count) FILTER (WHERE request_status <> 'released'), 0),
			COALESCE(sum(total_tokens), 0),
			COALESCE(sum(actual_provider_cost) FILTER (WHERE request_status = 'completed'), 0)::text,
			COALESCE(sum(COALESCE(estimated_cost, 0)) FILTER (WHERE request_status = 'completed'), 0)::text,
			COALESCE(sum(reservation_amount) FILTER (WHERE request_status = 'reserved'), 0)::text,
			count(*) FILTER (WHERE request_status = 'reserved'),
			COALESCE(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE request_status = 'reserved'))::bigint, 0),
			count(*) FILTER (WHERE provider_outcome = 'timeout'),
			count(*) FILTER (WHERE provider_outcome = 'rate_limited'),
			count(*) FILTER (WHERE provider_outcome = 'invalid_response'),
			count(*) FILTER (WHERE provider_outcome = 'stale_discarded')
		FROM public.ai_usage_requests
		WHERE feature_code = $1
		  AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
		featureCode).Scan(
		&s.RequestsToday, &s.RequestsMonth, &s.RowsToday, &s.RowsMonth, &s.TokensMonth,
		&s.ProviderCostMonth, &s.EstimatedCostMonth, &s.ReservedActiveAmount,
		&s.ActiveReservations, &s.OldestReservationSec,
		&s.TimeoutsMonth, &s.RateLimitedMonth, &s.InvalidMonth, &s.StaleDiscardedMonth)
	if err != nil {
		return nil, fmt.Errorf("aiUsage: summary: %w", err)
	}
	err = r.pool.QueryRow(ctx, `
		SELECT
			count(*) FILTER (WHERE f.outcome = 'accepted'),
			count(*) FILTER (WHERE f.outcome = 'changed'),
			count(*) FILTER (WHERE f.outcome = 'manual'),
			count(*) FILTER (WHERE f.outcome = 'abstained'),
			count(*) FILTER (WHERE f.outcome = 'unresolved'),
			count(*) FILTER (WHERE f.outcome = 'changed' AND f.confidence = 'high'),
			count(*) FILTER (WHERE f.confidence = 'high' AND f.outcome IN ('accepted', 'changed')),
			count(*) FILTER (WHERE f.outcome IN ('accepted', 'changed', 'manual') AND f.imported_successfully)
		FROM public.ai_row_feedback f
		JOIN public.ai_usage_requests q ON q.id = f.request_id
		WHERE q.feature_code = $1`, featureCode).Scan(
		&s.FeedbackAccepted, &s.FeedbackChanged, &s.FeedbackManual,
		&s.FeedbackAbstained, &s.FeedbackUnresolved,
		&s.HighConfChanged, &s.HighConfTotal, &s.SuccessfulOutcomes)
	if err != nil {
		return nil, fmt.Errorf("aiUsage: feedback summary: %w", err)
	}
	return &s, nil
}

// ─── Per-row feedback (§13) ──────────────────────────────────────────────────

// AIFeedbackSkeleton — строка, создаваемая в момент suggest (outcome NULL).
type AIFeedbackSkeleton struct {
	RequestID           string
	UserID              string
	RowContextHash      string
	Confidence          string
	DeterministicTopID  *string
	AISelectedCatalogID *string
}

// InsertFeedbackSkeletons — батч-вставка skeleton-строк. Idempotent по
// (request_id, row_context_hash).
func (r *AISettingsRepo) InsertFeedbackSkeletons(ctx context.Context, rows []AIFeedbackSkeleton) error {
	if len(rows) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, f := range rows {
		batch.Queue(`
			INSERT INTO public.ai_row_feedback
				(request_id, user_id, row_context_hash, confidence,
				 deterministic_top_catalog_id, ai_selected_catalog_id)
			VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6)
			ON CONFLICT (request_id, row_context_hash) DO NOTHING`,
			f.RequestID, f.UserID, f.RowContextHash, f.Confidence,
			f.DeterministicTopID, f.AISelectedCatalogID)
	}
	br := r.pool.SendBatch(ctx, batch)
	defer br.Close() //nolint:errcheck
	for range rows {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("aiUsage: feedback skeleton: %w", err)
		}
	}
	return nil
}

// AIFeedbackSkeletonRow — skeleton для финализации на execute (§13).
type AIFeedbackSkeletonRow struct {
	RowContextHash      string
	AISelectedCatalogID *string
	Outcome             *string
}

// ListFeedbackSkeletons — skeleton-строки запроса текущего пользователя.
func (r *AISettingsRepo) ListFeedbackSkeletons(ctx context.Context, requestID, userID string) ([]AIFeedbackSkeletonRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT row_context_hash, ai_selected_catalog_id, outcome
		FROM public.ai_row_feedback
		WHERE request_id = $1::uuid AND user_id = $2::uuid`, requestID, userID)
	if err != nil {
		return nil, fmt.Errorf("aiUsage: skeletons: %w", err)
	}
	defer rows.Close()
	out := make([]AIFeedbackSkeletonRow, 0, 32)
	for rows.Next() {
		var s AIFeedbackSkeletonRow
		if err := rows.Scan(&s.RowContextHash, &s.AISelectedCatalogID, &s.Outcome); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// AIFeedbackOutcome — финализация строки после успешного импорта (§13).
type AIFeedbackOutcome struct {
	RequestID       string
	RowContextHash  string
	FinalCatalogID  *string
	Outcome         string // accepted | changed | manual | abstained | unresolved
	SelectionSource string
}

// FinalizeFeedbackOutcomes — запись outcome ПОСЛЕ успешного импорта.
// Idempotent: повторная финализация той же строки не меняет первый outcome
// (защита от double-count, §24.62).
func (r *AISettingsRepo) FinalizeFeedbackOutcomes(ctx context.Context, userID string, outcomes []AIFeedbackOutcome) error {
	if len(outcomes) == 0 {
		return nil
	}
	batch := &pgx.Batch{}
	for _, o := range outcomes {
		batch.Queue(`
			UPDATE public.ai_row_feedback SET
				final_selected_catalog_id = $3,
				outcome = $4,
				selection_source = $5,
				imported_successfully = true,
				completed_at = now()
			WHERE request_id = $1::uuid AND row_context_hash = $2
			  AND user_id = $6::uuid
			  AND outcome IS NULL`,
			o.RequestID, o.RowContextHash, o.FinalCatalogID, o.Outcome, o.SelectionSource, userID)
	}
	br := r.pool.SendBatch(ctx, batch)
	defer br.Close() //nolint:errcheck
	for range outcomes {
		if _, err := br.Exec(); err != nil {
			return fmt.Errorf("aiUsage: feedback finalize: %w", err)
		}
	}
	return nil
}

// ─── Retention cleanup (§21) ─────────────────────────────────────────────────

// CleanupExpiredUsage — batch-удаление старых записей ledger/feedback.
// Активные reservations и evaluation summaries не трогаются. Multi-instance
// safe (обычные DELETE по критерию), батчами.
func (r *AISettingsRepo) CleanupExpiredUsage(ctx context.Context, featureCode string, retention time.Duration, batchSize int) (int64, error) {
	if batchSize <= 0 {
		batchSize = 500
	}
	res, err := r.pool.Exec(ctx, `
		DELETE FROM public.ai_usage_requests
		WHERE id IN (
			SELECT id FROM public.ai_usage_requests
			WHERE feature_code = $1
			  AND request_status <> 'reserved'
			  AND created_at < now() - make_interval(secs => $2)
			LIMIT $3
		)`, featureCode, retention.Seconds(), batchSize)
	if err != nil {
		return 0, fmt.Errorf("aiUsage: cleanup: %w", err)
	}
	return res.RowsAffected(), nil
}
