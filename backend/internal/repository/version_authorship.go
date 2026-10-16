package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Перенос авторства в новую версию тендера (docs/mcp/AUTHORSHIP.md): строки ВОР
// и ГП копии получают автора исходной строки/позиции, а не того, кто выполняет
// перенос. SQL-функции — в db/yandex/incremental/2026_10_mcp_row_authorship.sql.

// resumeBoqAuditTrigger снимает флаг skipBoqAuditTrigger до конца транзакции.
func resumeBoqAuditTrigger(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `SELECT set_config('app.skip_boq_audit', '', true)`); err != nil {
		return fmt.Errorf("resumeBoqAuditTrigger: %w", err)
	}
	return nil
}

// copyBoqItemAuthorshipTx пишет в boq_items_audit автора исходной строки для
// каждой строки копии. Триггерный аудит при этом должен быть выключен
// (skipBoqAuditTrigger), иначе рядом появится «Системная операция».
func copyBoqItemAuthorshipTx(ctx context.Context, tx pgx.Tx, oldToNew map[string]string) (int, error) {
	if len(oldToNew) == 0 {
		return 0, nil
	}
	oldIDs, newIDs := splitIDPairs(oldToNew)
	var n int
	if err := tx.QueryRow(ctx, `SELECT public.copy_boq_item_authorship($1::uuid[], $2::uuid[])`,
		oldIDs, newIDs).Scan(&n); err != nil {
		return 0, fmt.Errorf("copyBoqItemAuthorshipTx: %w", err)
	}
	return n, nil
}

// copyPositionGPAuthorshipTx переносит последнего автора количества и
// примечания ГП из исходных позиций в новые.
func copyPositionGPAuthorshipTx(ctx context.Context, tx pgx.Tx, oldToNew map[string]string) (int, error) {
	if len(oldToNew) == 0 {
		return 0, nil
	}
	oldIDs, newIDs := splitIDPairs(oldToNew)
	var n int
	if err := tx.QueryRow(ctx, `SELECT public.copy_position_gp_authorship($1::uuid[], $2::uuid[])`,
		oldIDs, newIDs).Scan(&n); err != nil {
		return 0, fmt.Errorf("copyPositionGPAuthorshipTx: %w", err)
	}
	return n, nil
}

func splitIDPairs(oldToNew map[string]string) (oldIDs, newIDs []string) {
	oldIDs = make([]string, 0, len(oldToNew))
	newIDs = make([]string, 0, len(oldToNew))
	for oldID, newID := range oldToNew {
		oldIDs = append(oldIDs, oldID)
		newIDs = append(newIDs, newID)
	}
	return oldIDs, newIDs
}
