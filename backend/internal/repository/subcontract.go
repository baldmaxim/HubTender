package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SubcontractRepo handles subcontract_growth_exclusions mutations.
type SubcontractRepo struct {
	pool *pgxpool.Pool
}

// NewSubcontractRepo creates a SubcontractRepo.
func NewSubcontractRepo(pool *pgxpool.Pool) *SubcontractRepo {
	return &SubcontractRepo{pool: pool}
}

// ToggleExclusion ports public.toggle_subcontract_growth_exclusion
// (lines 1561-1589 of 00000000000005_baseline_functions.sql).
//
// Returns the new state: true if the exclusion was added, false if removed.
// Runs inside a single transaction so the check-then-act is atomic.
func (r *SubcontractRepo) ToggleExclusion(
	ctx context.Context,
	tenderID, detailCategoryID, exclusionType string,
) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("subcontractRepo.ToggleExclusion: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var exists bool
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (
		    SELECT 1
		    FROM public.subcontract_growth_exclusions
		    WHERE tender_id = $1
		      AND detail_cost_category_id = $2
		      AND exclusion_type = $3
		)
	`, tenderID, detailCategoryID, exclusionType).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("subcontractRepo.ToggleExclusion: exists: %w", err)
	}

	if exists {
		_, err = tx.Exec(ctx, `
			DELETE FROM public.subcontract_growth_exclusions
			WHERE tender_id = $1
			  AND detail_cost_category_id = $2
			  AND exclusion_type = $3
		`, tenderID, detailCategoryID, exclusionType)
	} else {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.subcontract_growth_exclusions (
			    tender_id, detail_cost_category_id, exclusion_type
			) VALUES ($1, $2, $3)
		`, tenderID, detailCategoryID, exclusionType)
	}
	if err != nil {
		return false, fmt.Errorf("subcontractRepo.ToggleExclusion: mutate: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("subcontractRepo.ToggleExclusion: commit: %w", err)
	}

	return !exists, nil
}
