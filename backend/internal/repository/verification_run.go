package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/quality"
)

// verificationAdvisoryLockClass сериализует прогоны каталога по одному тендеру.
// Класс свой: с пересчётом (42001) прогон не конкурирует.
const verificationAdvisoryLockClass = 42002

// Источник прогона — verification_runs.trigger_source.
const (
	// RunTriggerCheckpoint — «Проверка завершена»: всё текущее просмотрено,
	// дальше новыми считаются только находки, появившиеся после этого прогона.
	RunTriggerCheckpoint = "checkpoint"
	// RunTriggerView — открытие страницы, автообновление, «Перепроверить».
	RunTriggerView = "view"
	// RunTriggerAPI — машинный ключ.
	RunTriggerAPI = "api"
)

// RunAndPersist прогоняет каталог правил по тендеру и сохраняет состояние
// находок: что открылось, что открылось заново, что исчезло.
//
// Прогон и сохранение идут под сессионной advisory-блокировкой в одной
// REPEATABLE READ транзакции, начатой уже после захвата блокировки. Иначе два
// одновременных прогона (страница + кнопка) могли бы сохраниться в обратном
// порядке, и прогон по более старым данным закрыл бы свежие находки.
//
// Возвращает (отчёт, ошибку сохранения, ошибку прогона). Ошибка сохранения не
// фатальна: находки уже посчитаны и отдаются без полей истории — так бэкенд,
// выкаченный раньше миграции, не ломает страницу.
func (r *QualityRepo) RunAndPersist(
	ctx context.Context,
	tenderID, trigger string,
	triggeredBy *string,
) (*QualityReport, error, error) {
	if trigger != RunTriggerCheckpoint && trigger != RunTriggerView && trigger != RunTriggerAPI {
		return nil, nil, fmt.Errorf("qualityRepo.RunAndPersist: неизвестный trigger %q", trigger)
	}
	started := time.Now()

	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return nil, nil, fmt.Errorf("qualityRepo.RunAndPersist: acquire: %w", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1, hashtext($2))`,
		verificationAdvisoryLockClass, tenderID); err != nil {
		conn.Release()
		return nil, nil, fmt.Errorf("qualityRepo.RunAndPersist: advisory lock: %w", err)
	}
	defer func() {
		// Снимаем блокировку до возврата соединения в пул; не вышло — закрываем
		// соединение, чтобы сервер освободил её сам.
		if _, uerr := conn.Exec(context.WithoutCancel(ctx),
			`SELECT pg_advisory_unlock($1, hashtext($2))`,
			verificationAdvisoryLockClass, tenderID); uerr != nil {
			_ = conn.Conn().Close(context.WithoutCancel(ctx))
		}
		conn.Release()
	}()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return nil, nil, fmt.Errorf("qualityRepo.RunAndPersist: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	report, okRules, err := runCatalogTx(ctx, tx, tenderID)
	if err != nil {
		return nil, nil, fmt.Errorf("qualityRepo.RunAndPersist: %w", err)
	}

	// Сохранение — в своей точке сохранения: при сбое (нет таблиц) откатываем
	// только его, а находки уже в памяти.
	sp, err := tx.Begin(ctx)
	if err != nil {
		return report, fmt.Errorf("savepoint: %w", err), nil
	}
	if perr := persistRun(ctx, sp, report, okRules, trigger, triggeredBy, started); perr != nil {
		_ = sp.Rollback(ctx)
		clearHistory(report)
		return report, perr, nil
	}
	if err := sp.Commit(ctx); err != nil {
		clearHistory(report)
		return report, fmt.Errorf("release savepoint: %w", err), nil
	}
	if err := tx.Commit(ctx); err != nil {
		clearHistory(report)
		return report, fmt.Errorf("commit: %w", err), nil
	}
	report.HistoryAvailable = true
	return report, nil, nil
}

func clearHistory(report *QualityReport) {
	report.RunID = nil
	report.CheckpointAt = nil
	report.HistoryAvailable = false
	for i := range report.Findings {
		report.Findings[i].FindingID = nil
		report.Findings[i].FirstSeenAt = nil
		report.Findings[i].IsNew = false
	}
}

func findingKey(ruleCode, entityType, entityID string) string {
	return ruleCode + "\x00" + entityType + "\x00" + entityID
}

// persistRun записывает прогон и приводит verification_findings к результату.
func persistRun(
	ctx context.Context,
	tx pgx.Tx,
	report *QualityReport,
	okRules []string,
	trigger string,
	triggeredBy *string,
	started time.Time,
) error {
	tenderID := report.TenderID

	var runID string
	var runStartedAt time.Time
	// started_at = now() транзакции: тем же now() помечаются открытые в этом
	// прогоне находки, поэтому «новее отметки» сравнивается строго и находки,
	// открытые самим прогоном-отметкой, новыми не считаются.
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.verification_runs
			(tender_id, trigger_source, input_revision, catalog_hash, started_at, triggered_by)
		VALUES ($1, $2,
			COALESCE((SELECT financial_input_revision FROM public.tenders WHERE id = $1), 0),
			$3, now(), $4)
		RETURNING id::text, started_at`,
		tenderID, trigger, quality.CatalogHash(), triggeredBy,
	).Scan(&runID, &runStartedAt); err != nil {
		return fmt.Errorf("verification_runs insert: %w", err)
	}

	// Контракт каталога предполагает одну находку на сущность в рамках правила,
	// но ON CONFLICT DO UPDATE падает на дубле внутри одной команды — поэтому
	// дубли отсекаются здесь, а не роняют сохранение.
	seen := make(map[string]struct{}, len(report.Findings))
	order := make([]int, 0, len(report.Findings))
	for i := range report.Findings {
		f := &report.Findings[i]
		k := findingKey(f.RuleCode, f.EntityType, f.EntityID)
		if _, dup := seen[k]; dup {
			continue
		}
		seen[k] = struct{}{}
		order = append(order, i)
	}

	n := len(order)
	batch := newFindingBatch(n)
	for j, i := range order {
		f := report.Findings[i]
		batch.codes[j], batch.types[j], batch.entities[j] = f.RuleCode, f.EntityType, f.EntityID
		batch.prints[j], batch.sevs[j], batch.details[j] = f.Fingerprint, f.Severity, f.Detail
		batch.money[j], batch.posNums[j], batch.itemNos[j] = f.MoneyDelta, f.PositionNumber, f.ItemNo
	}

	opened, reopened, err := upsertFindings(ctx, tx, tenderID, runID, batch, report)
	if err != nil {
		return err
	}

	resolved, err := resolveMissing(ctx, tx, tenderID, runID, okRules)
	if err != nil {
		return err
	}

	var checkpoint *time.Time
	var cp time.Time
	switch err := tx.QueryRow(ctx, `
		SELECT started_at FROM public.verification_runs
		WHERE tender_id = $1 AND trigger_source = 'checkpoint'
		ORDER BY started_at DESC LIMIT 1`, tenderID).Scan(&cp); {
	case err == nil:
		checkpoint = &cp
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return fmt.Errorf("checkpoint lookup: %w", err)
	}

	for i := range report.Findings {
		f := &report.Findings[i]
		if checkpoint != nil && f.FirstSeenAt != nil && f.FirstSeenAt.After(*checkpoint) {
			f.IsNew = true
		}
	}

	ruleErrors, err := json.Marshal(report.Errors)
	if err != nil {
		return fmt.Errorf("rule errors json: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.verification_runs
		SET rules_executed = $2, rule_errors = $3::jsonb, findings_total = $4,
		    opened_count = $5, reopened_count = $6, resolved_count = $7,
		    finished_at = clock_timestamp(), duration_ms = $8
		WHERE id = $1`,
		runID, len(okRules), string(ruleErrors), n, opened, reopened, resolved,
		time.Since(started).Milliseconds(),
	); err != nil {
		return fmt.Errorf("verification_runs update: %w", err)
	}

	report.RunID = &runID
	report.CheckpointAt = checkpoint
	return nil
}
