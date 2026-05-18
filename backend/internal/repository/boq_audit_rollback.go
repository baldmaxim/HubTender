package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrAuditRollback carries an HTTP status for the handler to dispatch.
type ErrAuditRollback struct {
	HTTPStatus int
	Message    string
}

func (e *ErrAuditRollback) Error() string { return e.Message }

// BoqAuditRollbackRepo restores a DELETE'd boq_item from its audit row.
type BoqAuditRollbackRepo struct {
	pool *pgxpool.Pool
}

// NewBoqAuditRollbackRepo creates a BoqAuditRollbackRepo.
func NewBoqAuditRollbackRepo(pool *pgxpool.Pool) *BoqAuditRollbackRepo {
	return &BoqAuditRollbackRepo{pool: pool}
}

// RollbackDeleted re-inserts the boq_item captured in a DELETE audit row,
// preserving the original id (so parent_work_item_id links survive).
// created_at/updated_at are dropped so fresh defaults apply. The boq_items
// audit trigger logs this INSERT as a new audit row (same as the previous
// client-side supabase.from('boq_items').insert path).
func (r *BoqAuditRollbackRepo) RollbackDeleted(ctx context.Context, auditID string) (string, error) {
	var opType string
	var hasOld bool
	err := r.pool.QueryRow(ctx, `
		SELECT operation_type, (old_data IS NOT NULL)
		FROM public.boq_items_audit
		WHERE id = $1::uuid
	`, auditID).Scan(&opType, &hasOld)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", &ErrAuditRollback{HTTPStatus: 404, Message: "audit record not found"}
		}
		return "", fmt.Errorf("boqAuditRollbackRepo: load audit: %w", err)
	}
	if opType != "DELETE" {
		return "", &ErrAuditRollback{
			HTTPStatus: 400,
			Message:    "rollback re-insert applies only to DELETE audit records",
		}
	}
	if !hasOld {
		return "", &ErrAuditRollback{
			HTTPStatus: 400,
			Message:    "Невозможно восстановить: нет данных предыдущей версии",
		}
	}

	var newID string
	err = r.pool.QueryRow(ctx, `
		INSERT INTO public.boq_items
		SELECT * FROM jsonb_populate_record(
			NULL::public.boq_items,
			(SELECT old_data - 'created_at' - 'updated_at'
			   FROM public.boq_items_audit WHERE id = $1::uuid)
		)
		RETURNING id::text
	`, auditID).Scan(&newID)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			switch pgErr.Code {
			case "23505": // unique_violation
				return "", &ErrAuditRollback{HTTPStatus: 409, Message: "Элемент с таким id уже существует"}
			case "23503": // foreign_key_violation
				return "", &ErrAuditRollback{HTTPStatus: 409, Message: "Не удалось восстановить: позиция или тендер удалены"}
			}
			return "", &ErrAuditRollback{HTTPStatus: 500, Message: pgErr.Message}
		}
		return "", fmt.Errorf("boqAuditRollbackRepo: re-insert: %w", err)
	}
	return newID, nil
}
