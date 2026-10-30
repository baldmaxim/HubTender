package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Revert отменяет решение: удаляет строки, созданные им и всё ещё принадлежащие
// чёрновому прогону (аудит DELETE), ставит status=reverted и пишет событие
// analog_revert в карточку проверки. Повтор отмены возвращает текущее состояние.
func (r *AnalogRepo) Revert(ctx context.Context, applicationID, userID string) (*AnalogRevertResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("analog.revert: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Позиция нужна для advisory-лока: сначала читаем без блокировки, затем под
	// локом перечитываем решение (его могли заменить новым применением).
	var positionID string
	if err := tx.QueryRow(ctx,
		`SELECT client_position_id::text FROM public.analog_applications WHERE id = $1::uuid`,
		applicationID).Scan(&positionID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, analogErr(AnalogCodeApplicationAbsent, "Решение не найдено.", nil)
		}
		return nil, fmt.Errorf("analog.revert: load: %w", err)
	}
	if err := lockAnalogPosition(ctx, tx, positionID); err != nil {
		return nil, err
	}

	var (
		status, runID, tenderID string
		newIDs                  []string
	)
	if err := tx.QueryRow(ctx, `
		SELECT status, import_session_id::text, tender_id::text, new_item_ids::text[]
		FROM public.analog_applications WHERE id = $1::uuid FOR UPDATE`,
		applicationID).Scan(&status, &runID, &tenderID, &newIDs); err != nil {
		return nil, fmt.Errorf("analog.revert: lock: %w", err)
	}
	switch status {
	case AnalogStatusReverted:
		app, err := getAnalogApplication(ctx, tx, applicationID)
		if err != nil {
			return nil, err
		}
		return &AnalogRevertResult{Application: *app}, nil
	case AnalogStatusSuperseded:
		return nil, analogErr(AnalogCodeNotActive,
			"Решение уже заменено новым применением по этой позиции: отменять нужно последнее.", nil)
	}

	locked, err := analogPositionLocked(ctx, tx, positionID)
	if err != nil {
		return nil, err
	}
	if locked {
		return nil, errAnalogLocked()
	}

	// Сессию берём под FOR UPDATE: параллельная запись в прогон дождётся коммита.
	var cancelled bool
	if err := tx.QueryRow(ctx, `
		SELECT cancelled_at IS NOT NULL FROM public.import_sessions
		WHERE id = $1::uuid FOR UPDATE`, runID).Scan(&cancelled); err != nil {
		return nil, fmt.Errorf("analog.revert: run: %w", err)
	}
	if err := setAuditUser(ctx, tx, userID); err != nil {
		return nil, err
	}
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("analog.revert: %w", err)
	}

	deleted := 0
	if !cancelled {
		deleted, err = deleteRunItemsTx(ctx, tx, runID, userID, positionID, newIDs)
		if err != nil {
			return nil, mapAnalogDeleteError(err)
		}
	}
	if deleted > 0 {
		if _, err := tx.Exec(ctx, `
			UPDATE public.import_sessions SET items_count = GREATEST(items_count - $2, 0)
			WHERE id = $1::uuid`, runID, deleted); err != nil {
			return nil, fmt.Errorf("analog.revert: items_count: %w", err)
		}
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.analog_applications
		SET status = $2, reverted_by = $3::uuid, reverted_at = now()
		WHERE id = $1::uuid`, applicationID, AnalogStatusReverted, userID); err != nil {
		return nil, fmt.Errorf("analog.revert: status: %w", err)
	}

	app, err := getAnalogApplication(ctx, tx, applicationID)
	if err != nil {
		return nil, err
	}
	comment := fmt.Sprintf("Решение по аналогу отменено: №%s v%d, поз. «%s»; удалено строк: %d",
		derefOrEmpty(app.SourceTenderNumber), derefInt(app.SourceTenderVersion, 1), app.SourceWorkName, deleted)
	if !cancelled {
		if _, err := upsertAnalogReviewTx(ctx, tx, runID, tenderID, positionID, userID, "analog_revert", comment, false); err != nil {
			return nil, err
		}
	}

	if deleted > 0 {
		// Как в пакетной записи: ревизия входов, итоги позиции и общий итог
		// тендера; коммерцию пересчитывает очередь после коммита (сервис).
		if _, err := MarkTenderFinancialInputsChangedTx(ctx, tx, tenderID, "analog_revert"); err != nil {
			return nil, fmt.Errorf("analog.revert: %w", err)
		}
		if err := recomputePositionTotalsByIDsTx(ctx, tx, []string{positionID}); err != nil {
			return nil, fmt.Errorf("analog.revert: %w", err)
		}
		if _, err := RecalculateTenderGrandTotalTx(ctx, tx, tenderID); err != nil {
			return nil, fmt.Errorf("analog.revert: grand total: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("analog.revert: commit: %w", err)
	}
	return &AnalogRevertResult{Application: *app, Changed: true}, nil
}

func derefInt(v *int, def int) int {
	if v == nil {
		return def
	}
	return *v
}
