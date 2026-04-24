package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// RedistributionRecord is one row persisted into cost_redistribution_results.
type RedistributionRecord struct {
	BoqItemID        string  `json:"boq_item_id" validate:"required,uuid"`
	OriginalWorkCost float64 `json:"original_work_cost"`
	DeductedAmount   float64 `json:"deducted_amount"`
	AddedAmount      float64 `json:"added_amount"`
	FinalWorkCost    float64 `json:"final_work_cost"`
}

// RedistributionRepo owns writes to cost_redistribution_results.
type RedistributionRepo struct {
	pool *pgxpool.Pool
}

// NewRedistributionRepo creates a RedistributionRepo.
func NewRedistributionRepo(pool *pgxpool.Pool) *RedistributionRepo {
	return &RedistributionRepo{pool: pool}
}

// SaveResults atomically replaces the set of cost_redistribution_results rows
// for the given (tender_id, markup_tactic_id). It:
//  1. Deletes rows whose boq_item_id is not present in the new set.
//  2. Upserts every row via ON CONFLICT on
//     uq_cost_redistribution_results_tender_tactic_boq.
//  3. Stores rulesJSON only on the record that sorts first (by boq_item_id) —
//     the loader reads redistribution_rules from a single row, so replicating
//     the JSONB across every record wastes storage and bandwidth.
//
// Returns the number of rows present in the table after the operation.
func (r *RedistributionRepo) SaveResults(
	ctx context.Context,
	tenderID, tacticID string,
	records []RedistributionRecord,
	rulesJSON json.RawMessage,
	createdBy string,
) (int, error) {
	if len(records) == 0 {
		return 0, fmt.Errorf("redistributionRepo.SaveResults: records must not be empty")
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("redistributionRepo.SaveResults: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Pull out the set of new boq_item_ids to drive the cleanup delete.
	boqIDs := make([]string, len(records))
	for i, rec := range records {
		boqIDs[i] = rec.BoqItemID
	}

	// 1. Remove rows no longer present in the new set.
	const deleteQ = `
		DELETE FROM public.cost_redistribution_results
		WHERE tender_id = $1
		  AND markup_tactic_id = $2
		  AND boq_item_id <> ALL($3::uuid[])
	`
	if _, err := tx.Exec(ctx, deleteQ, tenderID, tacticID, boqIDs); err != nil {
		return 0, fmt.Errorf("redistributionRepo.SaveResults: cleanup delete: %w", err)
	}

	// 2. Pick the "holder" record for the JSONB rules — stable choice by
	//    the first boq_item_id in the input. The rest get NULL.
	holderID := records[0].BoqItemID
	for _, rec := range records {
		if rec.BoqItemID < holderID {
			holderID = rec.BoqItemID
		}
	}

	// Clear rules on every existing holder for this (tender, tactic) — the new
	// holder may differ from the old one, so we must strip the JSONB before
	// upserting to guarantee exactly one non-null rules row.
	const clearRulesQ = `
		UPDATE public.cost_redistribution_results
		SET redistribution_rules = NULL
		WHERE tender_id = $1
		  AND markup_tactic_id = $2
	`
	if _, err := tx.Exec(ctx, clearRulesQ, tenderID, tacticID); err != nil {
		return 0, fmt.Errorf("redistributionRepo.SaveResults: clear rules: %w", err)
	}

	// 3. Upsert every record. rulesJSON lives on the holder row only.
	const upsertQ = `
		INSERT INTO public.cost_redistribution_results (
			tender_id,
			markup_tactic_id,
			boq_item_id,
			original_work_cost,
			deducted_amount,
			added_amount,
			final_work_cost,
			redistribution_rules,
			created_by
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (tender_id, markup_tactic_id, boq_item_id) DO UPDATE SET
			original_work_cost   = EXCLUDED.original_work_cost,
			deducted_amount      = EXCLUDED.deducted_amount,
			added_amount         = EXCLUDED.added_amount,
			final_work_cost      = EXCLUDED.final_work_cost,
			redistribution_rules = EXCLUDED.redistribution_rules,
			updated_at           = NOW()
	`

	var createdByArg any
	if createdBy == "" {
		createdByArg = nil
	} else {
		createdByArg = createdBy
	}

	for _, rec := range records {
		var rules any
		if rec.BoqItemID == holderID {
			rules = []byte(rulesJSON)
		} else {
			rules = nil
		}

		if _, err := tx.Exec(
			ctx,
			upsertQ,
			tenderID,
			tacticID,
			rec.BoqItemID,
			rec.OriginalWorkCost,
			rec.DeductedAmount,
			rec.AddedAmount,
			rec.FinalWorkCost,
			rules,
			createdByArg,
		); err != nil {
			return 0, fmt.Errorf("redistributionRepo.SaveResults: upsert: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("redistributionRepo.SaveResults: commit: %w", err)
	}

	return len(records), nil
}
