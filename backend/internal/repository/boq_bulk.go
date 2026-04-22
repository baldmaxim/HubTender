package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// BulkCommercialRow is one element of the PATCH /items/bulk-commercial body.
type BulkCommercialRow struct {
	ID                          string  `json:"id"                           validate:"required,uuid"`
	CommercialMarkup            float64 `json:"commercial_markup"`
	TotalCommercialMaterialCost float64 `json:"total_commercial_material_cost"`
	TotalCommercialWorkCost     float64 `json:"total_commercial_work_cost"`
}

// BulkBoqRepo handles bulk BOQ mutations that need an explicit transaction.
type BulkBoqRepo struct {
	pool *pgxpool.Pool
}

// NewBulkBoqRepo creates a BulkBoqRepo.
func NewBulkBoqRepo(pool *pgxpool.Pool) *BulkBoqRepo {
	return &BulkBoqRepo{pool: pool}
}

// BulkUpdateCommercial updates commercial cost columns for many boq_items in a
// single pgx.Tx and then calls RecalculateTenderGrandTotal for each distinct
// tender touched. It mirrors public.bulk_update_boq_items_commercial_costs
// (lines 326-358 of 00000000000005_baseline_functions.sql).
//
// Returns (updatedCount, affectedTenderIDs, error).
func (r *BulkBoqRepo) BulkUpdateCommercial(
	ctx context.Context,
	rows []BulkCommercialRow,
) (int, []string, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Build unnest arrays.
	ids := make([]string, len(rows))
	markups := make([]float64, len(rows))
	matCosts := make([]float64, len(rows))
	workCosts := make([]float64, len(rows))
	for i, rr := range rows {
		ids[i] = rr.ID
		markups[i] = rr.CommercialMarkup
		matCosts[i] = rr.TotalCommercialMaterialCost
		workCosts[i] = rr.TotalCommercialWorkCost
	}

	const updateQ = `
		UPDATE public.boq_items bi
		SET
		    commercial_markup               = u.markup,
		    total_commercial_material_cost  = u.mat_cost,
		    total_commercial_work_cost      = u.work_cost,
		    updated_at                      = NOW()
		FROM UNNEST(
		    $1::uuid[],
		    $2::numeric[],
		    $3::numeric[],
		    $4::numeric[]
		) AS u(id, markup, mat_cost, work_cost)
		WHERE bi.id = u.id
	`
	tag, err := tx.Exec(ctx, updateQ, ids, markups, matCosts, workCosts)
	if err != nil {
		return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: update: %w", err)
	}
	updatedCount := int(tag.RowsAffected())

	// Collect distinct tender IDs for the touched rows.
	const tenderQ = `
		SELECT DISTINCT tender_id::text
		FROM public.boq_items
		WHERE id = ANY($1::uuid[])
	`
	tRows, err := tx.Query(ctx, tenderQ, ids)
	if err != nil {
		return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: tender query: %w", err)
	}
	var tenderIDs []string
	for tRows.Next() {
		var tid string
		if err := tRows.Scan(&tid); err != nil {
			tRows.Close()
			return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: tender scan: %w", err)
		}
		tenderIDs = append(tenderIDs, tid)
	}
	tRows.Close()
	if err := tRows.Err(); err != nil {
		return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: tender rows: %w", err)
	}

	// Recalculate grand total for each affected tender inside the same tx.
	for _, tid := range tenderIDs {
		if err := RecalculateTenderGrandTotal(ctx, tx, tid); err != nil {
			return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: recalc %s: %w", tid, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, nil, fmt.Errorf("bulkBoqRepo.BulkUpdateCommercial: commit: %w", err)
	}

	return updatedCount, tenderIDs, nil
}
