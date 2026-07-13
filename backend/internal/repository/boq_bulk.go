package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NOTE: the client-facing BulkCommercialRow DTO and BulkUpdateCommercial writer
// were REMOVED in stage 0.1.2.2. Commercial costs are calculation results and can
// only be persisted by the internal, tender-scoped
// PersistCalculatedCommercialCosts (see commercial_write.go), which is driven
// solely by CommercialRecalcService. The old public endpoint
// (PATCH /api/v1/items/bulk-commercial) is retired and answers 410.

// BulkBoqRepo handles bulk BOQ mutations that need an explicit transaction.
type BulkBoqRepo struct {
	pool *pgxpool.Pool
}

// NewBulkBoqRepo creates a BulkBoqRepo.
func NewBulkBoqRepo(pool *pgxpool.Pool) *BulkBoqRepo {
	return &BulkBoqRepo{pool: pool}
}

// SetQuoteLinkByName sets quote_link for every boq_item of a tender whose
// material_name_id / work_name_id matches. `field` is whitelisted to the two
// allowed columns; the value is always parameterised.
func (r *BulkBoqRepo) SetQuoteLinkByName(
	ctx context.Context,
	tenderID, field, value string,
	quoteLink *string,
	changedBy string,
) (int, error) {
	var col string
	switch field {
	case "material_name_id":
		col = "material_name_id"
	case "work_name_id":
		col = "work_name_id"
	default:
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByName: invalid field %q", field)
	}
	// Транзакция нужна, чтобы set_config('app.user_id', ..., is_local=true)
	// действовал на тот же UPDATE — иначе триггерный аудит запишет автора NULL.
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByName: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := setAuditUser(ctx, tx, changedBy); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByName: %w", err)
	}
	tag, err := tx.Exec(ctx,
		`UPDATE public.boq_items SET quote_link = $3
		 WHERE tender_id = $1::uuid AND `+col+` = $2::uuid`,
		tenderID, value, quoteLink)
	if err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByName: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByName: commit: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// SetQuoteLinkByIDs sets quote_link for the given boq_item ids.
func (r *BulkBoqRepo) SetQuoteLinkByIDs(
	ctx context.Context,
	ids []string,
	quoteLink *string,
	changedBy string,
) (int, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByIDs: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := setAuditUser(ctx, tx, changedBy); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByIDs: %w", err)
	}
	tag, err := tx.Exec(ctx,
		`UPDATE public.boq_items SET quote_link = $2 WHERE id = ANY($1::uuid[])`,
		ids, quoteLink)
	if err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByIDs: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("bulkBoqRepo.SetQuoteLinkByIDs: commit: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
