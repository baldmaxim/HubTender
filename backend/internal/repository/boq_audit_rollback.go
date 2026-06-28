package repository

import (
	"context"
	"encoding/json"
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
func (r *BoqAuditRollbackRepo) RollbackDeleted(ctx context.Context, auditID, changedBy string) (string, error) {
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

	// Транзакция нужна, чтобы set_config('app.user_id', ..., is_local=true)
	// действовал на тот же INSERT — триггер аудита проставит автора восстановления.
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("boqAuditRollbackRepo: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := setAuditUser(ctx, tx, changedBy); err != nil {
		return "", fmt.Errorf("boqAuditRollbackRepo: %w", err)
	}

	var newID string
	err = tx.QueryRow(ctx, `
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
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("boqAuditRollbackRepo: commit: %w", err)
	}
	return newID, nil
}

// ─── audit list (useAuditHistory) ───────────────────────────────────────────

// AuditUserEmbed mirrors the user:changed_by(id,full_name,email) embed.
type AuditUserEmbed struct {
	ID       string  `json:"id"`
	FullName *string `json:"full_name"`
	Email    *string `json:"email"`
}

// BoqAuditRow is one boq_items_audit row + user embed.
type BoqAuditRow struct {
	ID            string          `json:"id"`
	BoqItemID     string          `json:"boq_item_id"`
	OperationType string          `json:"operation_type"`
	ChangedAt     string          `json:"changed_at"`
	ChangedBy     *string         `json:"changed_by"`
	ChangedFields []string        `json:"changed_fields"`
	OldData       json.RawMessage `json:"old_data"`
	NewData       json.RawMessage `json:"new_data"`
	User          *AuditUserEmbed `json:"user"`
}

// BoqAuditListFilter holds the optional query params for ListByPosition.
type BoqAuditListFilter struct {
	PositionID    string
	DateFrom      *string
	DateTo        *string
	UserID        *string
	OperationType *string
}

// ListByPosition returns boq_items_audit rows where the audited row's
// client_position_id (in new_data or old_data JSONB) matches positionID.
func (r *BoqAuditRollbackRepo) ListByPosition(ctx context.Context, f BoqAuditListFilter) ([]BoqAuditRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT bia.id::text, bia.boq_item_id::text, bia.operation_type,
		       to_char(bia.changed_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
		       bia.changed_by::text, bia.changed_fields,
		       bia.old_data, bia.new_data,
		       u.id::text, u.full_name, u.email
		FROM public.boq_items_audit bia
		LEFT JOIN public.users u ON u.id = bia.changed_by
		WHERE (
		    (bia.new_data->>'client_position_id') = $1
		    OR (bia.old_data->>'client_position_id') = $1
		)
		  AND ($2::timestamptz IS NULL OR bia.changed_at >= $2::timestamptz)
		  AND ($3::timestamptz IS NULL OR bia.changed_at <= $3::timestamptz)
		  AND ($4::uuid        IS NULL OR bia.changed_by      = $4::uuid)
		  AND ($5::text        IS NULL OR bia.operation_type  = $5)
		  -- Hide commercial-cost recalculation noise: an UPDATE whose changed
		  -- fields are entirely commercial columns (or timestamps, or empty) is a
		  -- markup-driven recompute, not a user edit. INSERT/DELETE always kept.
		  -- Historical rows already in the table are filtered here; new ones are
		  -- no longer written (see log_boq_items_changes()).
		  AND (
		    bia.operation_type <> 'UPDATE'
		    OR NOT (COALESCE(bia.changed_fields, '{}') <@ ARRAY[
		        'commercial_markup',
		        'total_commercial_material_cost',
		        'total_commercial_work_cost',
		        'updated_at', 'created_at']::text[])
		  )
		ORDER BY bia.changed_at DESC
	`, f.PositionID, f.DateFrom, f.DateTo, f.UserID, f.OperationType)
	if err != nil {
		return nil, fmt.Errorf("boqAuditRollbackRepo.ListByPosition: %w", err)
	}
	defer rows.Close()
	out := make([]BoqAuditRow, 0)
	for rows.Next() {
		var a BoqAuditRow
		var uID, uName, uEmail *string
		var oldData, newData []byte
		if err := rows.Scan(&a.ID, &a.BoqItemID, &a.OperationType,
			&a.ChangedAt, &a.ChangedBy, &a.ChangedFields,
			&oldData, &newData,
			&uID, &uName, &uEmail); err != nil {
			return nil, fmt.Errorf("boqAuditRollbackRepo.ListByPosition scan: %w", err)
		}
		if len(oldData) > 0 {
			a.OldData = json.RawMessage(oldData)
		}
		if len(newData) > 0 {
			a.NewData = json.RawMessage(newData)
		}
		if uID != nil {
			a.User = &AuditUserEmbed{ID: *uID, FullName: uName, Email: uEmail}
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
