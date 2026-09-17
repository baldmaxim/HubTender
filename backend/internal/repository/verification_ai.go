package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VerificationAIRepo — ИИ-разбор находок: настройки, расход, оценки.
type VerificationAIRepo struct {
	pool *pgxpool.Pool
}

func NewVerificationAIRepo(pool *pgxpool.Pool) *VerificationAIRepo {
	return &VerificationAIRepo{pool: pool}
}

// ErrAISettingsInvalid — настройки нарушают ограничения (в т.ч. включение без
// успешной проверки выбранной модели).
var ErrAISettingsInvalid = errors.New("verification ai: некорректные настройки")

// VerificationAISettings — настройки ИИ-разбора.
type VerificationAISettings struct {
	Enabled               bool       `json:"enabled"`
	ModelID               *string    `json:"model_id"`
	AllowedTenderIDs      []string   `json:"allowed_tender_ids"`
	MaxFindingsPerRun     int        `json:"max_findings_per_run"`
	BatchSize             int        `json:"batch_size"`
	MaxOutputTokens       int        `json:"max_output_tokens"`
	RequestTimeoutSeconds int        `json:"request_timeout_seconds"`
	MonthlyTokenBudget    int64      `json:"monthly_token_budget"`
	DailyRequestLimit     int        `json:"daily_request_limit"`
	LastTestAt            *time.Time `json:"last_test_at"`
	LastTestModelID       *string    `json:"last_test_model_id"`
	LastTestStatus        *string    `json:"last_test_status"`
	LastTestError         *string    `json:"last_test_error"`
	LastTestLatencyMs     *int       `json:"last_test_latency_ms"`
	UpdatedAt             time.Time  `json:"updated_at"`
}

// AllowsTender — пустой список = все тендеры.
func (s *VerificationAISettings) AllowsTender(tenderID string) bool {
	if len(s.AllowedTenderIDs) == 0 {
		return true
	}
	for _, id := range s.AllowedTenderIDs {
		if id == tenderID {
			return true
		}
	}
	return false
}

// ensureRow — строка настроек заводится миграцией, но на базе, собранной из полной
// схемы, её нет: создаём по первому обращению.
func (r *VerificationAIRepo) ensureRow(ctx context.Context) error {
	if _, err := r.pool.Exec(ctx,
		`INSERT INTO public.verification_ai_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`); err != nil {
		return fmt.Errorf("verificationAI.ensureRow: %w", err)
	}
	return nil
}

func (r *VerificationAIRepo) GetSettings(ctx context.Context) (*VerificationAISettings, error) {
	if err := r.ensureRow(ctx); err != nil {
		return nil, err
	}
	s := &VerificationAISettings{}
	err := r.pool.QueryRow(ctx, `
		SELECT enabled, model_id, allowed_tender_ids::text[], max_findings_per_run, batch_size,
		       max_output_tokens, request_timeout_seconds, monthly_token_budget, daily_request_limit,
		       last_test_at, last_test_model_id, last_test_status, last_test_error, last_test_latency_ms,
		       updated_at
		FROM public.verification_ai_settings WHERE id = 1`).
		Scan(&s.Enabled, &s.ModelID, &s.AllowedTenderIDs, &s.MaxFindingsPerRun, &s.BatchSize,
			&s.MaxOutputTokens, &s.RequestTimeoutSeconds, &s.MonthlyTokenBudget, &s.DailyRequestLimit,
			&s.LastTestAt, &s.LastTestModelID, &s.LastTestStatus, &s.LastTestError, &s.LastTestLatencyMs,
			&s.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.GetSettings: %w", err)
	}
	return s, nil
}

// SaveSettings сохраняет изменяемые поля. Результат проверки модели не трогает.
func (r *VerificationAIRepo) SaveSettings(ctx context.Context, s VerificationAISettings, actor *string) error {
	if err := r.ensureRow(ctx); err != nil {
		return err
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE public.verification_ai_settings
		SET enabled = $1, model_id = $2, allowed_tender_ids = $3::uuid[], max_findings_per_run = $4,
		    batch_size = $5, max_output_tokens = $6, request_timeout_seconds = $7,
		    monthly_token_budget = $8, daily_request_limit = $9, updated_by = $10::uuid, updated_at = now()
		WHERE id = 1`,
		s.Enabled, s.ModelID, s.AllowedTenderIDs, s.MaxFindingsPerRun, s.BatchSize, s.MaxOutputTokens,
		s.RequestTimeoutSeconds, s.MonthlyTokenBudget, s.DailyRequestLimit, actor)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && (pgErr.Code == "23514" || pgErr.Code == "22P02") {
			return ErrAISettingsInvalid
		}
		return fmt.Errorf("verificationAI.SaveSettings: %w", err)
	}
	return nil
}

// RecordTest пишет результат проверки модели. Неуспешная проверка выключает разбор:
// включённым он может быть только на проверенной модели.
func (r *VerificationAIRepo) RecordTest(ctx context.Context, modelID string, passed bool, errText *string, latencyMs int) error {
	if err := r.ensureRow(ctx); err != nil {
		return err
	}
	status := "failed"
	if passed {
		status = "passed"
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE public.verification_ai_settings
		SET last_test_at = now(), last_test_model_id = $1, last_test_status = $2,
		    last_test_error = $3, last_test_latency_ms = $4,
		    enabled = enabled AND $2 = 'passed' AND model_id = $1
		WHERE id = 1`, modelID, status, errText, latencyMs)
	if err != nil {
		return fmt.Errorf("verificationAI.RecordTest: %w", err)
	}
	return nil
}

// AIUsage — расход: токены за месяц, запросы за сутки, стоимость за месяц.
type AIUsage struct {
	MonthTokens   int64      `json:"month_tokens"`
	MonthCost     float64    `json:"month_cost"`
	MonthRequests int        `json:"month_requests"`
	TodayRequests int        `json:"today_requests"`
	MonthFailed   int        `json:"month_failed"`
	LastRequestAt *time.Time `json:"last_request_at"`
}

func (r *VerificationAIRepo) Usage(ctx context.Context) (*AIUsage, error) {
	u := &AIUsage{}
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(sum(total_tokens), 0),
		       COALESCE(sum(cost), 0)::float8,
		       count(*),
		       count(*) FILTER (WHERE created_at >= date_trunc('day', now())),
		       count(*) FILTER (WHERE status <> 'completed'),
		       max(created_at)
		FROM public.verification_ai_requests
		WHERE created_at >= date_trunc('month', now())`).
		Scan(&u.MonthTokens, &u.MonthCost, &u.MonthRequests, &u.TodayRequests, &u.MonthFailed, &u.LastRequestAt)
	if err != nil {
		return nil, fmt.Errorf("verificationAI.Usage: %w", err)
	}
	return u, nil
}

// AIRequestRecord — строка журнала запросов.
type AIRequestRecord struct {
	TenderID         *string
	Trigger          string
	Status           string
	ModelID          string
	PromptVersion    string
	FindingsCount    int
	AssessedCount    int
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
	Cost             *string
	LatencyMs        int
	ErrorCode        *string
	CreatedBy        *string
}

func (r *VerificationAIRepo) SaveRequest(ctx context.Context, rec AIRequestRecord) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.verification_ai_requests
			(tender_id, trigger_source, status, model_id, prompt_version, findings_count, assessed_count,
			 prompt_tokens, completion_tokens, total_tokens, cost, latency_ms, error_code, created_by)
		VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::numeric, $12, $13, $14::uuid)
		RETURNING id::text`,
		rec.TenderID, rec.Trigger, rec.Status, rec.ModelID, rec.PromptVersion, rec.FindingsCount,
		rec.AssessedCount, rec.PromptTokens, rec.CompletionTokens, rec.TotalTokens, rec.Cost,
		rec.LatencyMs, rec.ErrorCode, rec.CreatedBy).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("verificationAI.SaveRequest: %w", err)
	}
	return id, nil
}
