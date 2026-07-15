package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Этап 2.4 (§2): восстановление зависших финансовых расчётов.
//
// Два класса кандидатов:
//   - stale        — потерянный enqueue (in-memory очередь умерла до/после
//     commit мутации): тендер корректен, но пересчёт никогда не запустится;
//   - calculating  — indicative claim пережил crash процесса: advisory lock
//     давно освобождён сервером, а status висит и блокирует approval.
//
// Гарантии multi-instance: reclaim выполняется ПОД тем же per-tender advisory
// try-lock, которым сериализуются сами расчёты (class 42001) — если lock
// занят, расчёт реально идёт и recovery не вмешивается; CAS по
// status+started_at защищает от гонки двух recovery-сканов.

// RecoveryCandidate — тендер, требующий вмешательства recovery.
type RecoveryCandidate struct {
	TenderID   string
	Status     string  // stale | calculating
	AgeSeconds float64 // возраст stale-статуса не отслеживается — 0; для calculating — с started_at
}

// ListRecalcRecoveryCandidates — keyset-скан (§4.12) тендеров в состоянии
// stale либо calculating старше timeout. Read-only; порядок стабилен по id.
func ListRecalcRecoveryCandidates(
	ctx context.Context, pool *pgxpool.Pool,
	calculatingTimeout time.Duration, afterID string, limit int,
) ([]RecoveryCandidate, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := pool.Query(ctx, `
		SELECT id::text, financial_calculation_status,
		       COALESCE(EXTRACT(EPOCH FROM (NOW() - financial_calculation_started_at)), 0)
		FROM public.tenders
		WHERE (financial_calculation_status = 'stale'
		       OR (financial_calculation_status = 'calculating'
		           AND financial_calculation_started_at IS NOT NULL
		           AND financial_calculation_started_at < NOW() - $1::interval))
		  AND id::text > $2
		ORDER BY id::text
		LIMIT $3`,
		fmt.Sprintf("%f seconds", calculatingTimeout.Seconds()), afterID, limit)
	if err != nil {
		return nil, fmt.Errorf("recalcRecovery: candidates: %w", err)
	}
	defer rows.Close()
	out := make([]RecoveryCandidate, 0, limit)
	for rows.Next() {
		var c RecoveryCandidate
		if err := rows.Scan(&c.TenderID, &c.Status, &c.AgeSeconds); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// ReclaimStuckCalculating переводит подвисший calculating-тендер обратно в
// stale — но ТОЛЬКО если:
//  1. per-tender advisory lock свободен (никакой живой воркер не считает) —
//     проверяется pg_try_advisory_lock на выделенном соединении и
//     УДЕРЖИВАЕТСЯ на время CAS, чтобы живой воркер не стартовал между
//     проверкой и переводом;
//  2. status всё ещё calculating и started_at всё ещё старше timeout (CAS —
//     двойной recovery-скан или уже завершившийся расчёт превращаются в no-op).
//
// Возвращает (true, nil) когда тендер реально переведён в stale.
func ReclaimStuckCalculating(
	ctx context.Context, pool *pgxpool.Pool, tenderID string, calculatingTimeout time.Duration,
) (bool, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return false, fmt.Errorf("recalcRecovery: acquire: %w", err)
	}
	defer conn.Release()

	var got bool
	if err := conn.QueryRow(ctx,
		`SELECT pg_try_advisory_lock($1, hashtext($2))`,
		tenderRecalcAdvisoryLockClass, tenderID).Scan(&got); err != nil {
		return false, fmt.Errorf("recalcRecovery: try lock: %w", err)
	}
	if !got {
		return false, nil // живой воркер держит lock — не вмешиваемся (§2.B)
	}
	defer func() {
		// Как в recalc-контуре: если unlock не удался — уничтожить соединение,
		// чтобы сервер освободил session lock.
		if _, uerr := conn.Exec(context.WithoutCancel(ctx),
			`SELECT pg_advisory_unlock($1, hashtext($2))`,
			tenderRecalcAdvisoryLockClass, tenderID); uerr != nil {
			_ = conn.Conn().Close(context.WithoutCancel(ctx))
		}
	}()

	tag, err := conn.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_status     = 'stale',
		    financial_calculation_started_at = NULL
		WHERE id = $1::uuid
		  AND financial_calculation_status = 'calculating'
		  AND financial_calculation_started_at IS NOT NULL
		  AND financial_calculation_started_at < NOW() - $2::interval`,
		tenderID, fmt.Sprintf("%f seconds", calculatingTimeout.Seconds()))
	if err != nil {
		return false, fmt.Errorf("recalcRecovery: reclaim: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// RecalcHealthSnapshot — безопасные счётчики для health/diagnostics (§3).
type RecalcHealthSnapshot struct {
	StaleCount            int     `json:"stale_count"`
	CalculatingCount      int     `json:"calculating_count"`
	FailedCount           int     `json:"failed_count"`
	OldestStaleAgeSeconds float64 `json:"oldest_stale_age_seconds"` // от updated_at stale-строки
	OldestCalcAgeSeconds  float64 `json:"oldest_calculating_age_seconds"`
}

// ReadRecalcHealthSnapshot — один read-only запрос без финансовых данных.
func ReadRecalcHealthSnapshot(ctx context.Context, pool *pgxpool.Pool) (RecalcHealthSnapshot, error) {
	var s RecalcHealthSnapshot
	err := pool.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE financial_calculation_status = 'stale'),
		  COUNT(*) FILTER (WHERE financial_calculation_status = 'calculating'),
		  COUNT(*) FILTER (WHERE financial_calculation_status = 'failed'),
		  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - updated_at)))
		           FILTER (WHERE financial_calculation_status = 'stale'), 0),
		  COALESCE(MAX(EXTRACT(EPOCH FROM (NOW() - financial_calculation_started_at)))
		           FILTER (WHERE financial_calculation_status = 'calculating'), 0)
		FROM public.tenders`).Scan(
		&s.StaleCount, &s.CalculatingCount, &s.FailedCount,
		&s.OldestStaleAgeSeconds, &s.OldestCalcAgeSeconds)
	if err != nil {
		return s, fmt.Errorf("recalcRecovery: health: %w", err)
	}
	return s, nil
}
