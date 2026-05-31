package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ConstructionCostVolumesRepo handles per-tender cost volume rows (both
// per-detail and per-group_key rows in the same table).
type ConstructionCostVolumesRepo struct {
	pool *pgxpool.Pool
}

func NewConstructionCostVolumesRepo(pool *pgxpool.Pool) *ConstructionCostVolumesRepo {
	return &ConstructionCostVolumesRepo{pool: pool}
}

type ConstructionCostVolumeRow struct {
	ID                   string   `json:"id"`
	TenderID             string   `json:"tender_id"`
	DetailCostCategoryID *string  `json:"detail_cost_category_id"`
	GroupKey             *string  `json:"group_key"`
	Volume               *float64 `json:"volume"`
	Notes                *string  `json:"notes"`
}

// ListByTender returns every construction_cost_volumes row for the tender.
func (r *ConstructionCostVolumesRepo) ListByTender(ctx context.Context, tenderID string) ([]ConstructionCostVolumeRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, tender_id::text, detail_cost_category_id::text, group_key, volume, notes
		FROM public.construction_cost_volumes
		WHERE tender_id = $1
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("ccvRepo.ListByTender: %w", err)
	}
	defer rows.Close()

	out := make([]ConstructionCostVolumeRow, 0)
	for rows.Next() {
		var v ConstructionCostVolumeRow
		if err := rows.Scan(&v.ID, &v.TenderID, &v.DetailCostCategoryID, &v.GroupKey, &v.Volume, &v.Notes); err != nil {
			return nil, fmt.Errorf("ccvRepo.ListByTender scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

// UpsertVolume sets the volume and notes for the (tender_id, detail_cost_category_id|group_key)
// pair. Exactly one of detailCostCategoryID and groupKey must be non-empty.
func (r *ConstructionCostVolumesRepo) UpsertVolume(
	ctx context.Context, tenderID string, detailCostCategoryID, groupKey *string, volume float64, notes *string,
) error {
	if (detailCostCategoryID == nil || *detailCostCategoryID == "") && (groupKey == nil || *groupKey == "") {
		return errors.New("ccvRepo.UpsertVolume: detail_cost_category_id or group_key required")
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("ccvRepo.UpsertVolume: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var existingID string
	var lookupErr error
	if detailCostCategoryID != nil && *detailCostCategoryID != "" {
		lookupErr = tx.QueryRow(ctx, `
			SELECT id::text FROM public.construction_cost_volumes
			WHERE tender_id = $1 AND detail_cost_category_id = $2
		`, tenderID, *detailCostCategoryID).Scan(&existingID)
	} else {
		lookupErr = tx.QueryRow(ctx, `
			SELECT id::text FROM public.construction_cost_volumes
			WHERE tender_id = $1 AND group_key = $2
		`, tenderID, *groupKey).Scan(&existingID)
	}

	if lookupErr != nil && !errors.Is(lookupErr, pgx.ErrNoRows) {
		return fmt.Errorf("ccvRepo.UpsertVolume: lookup: %w", lookupErr)
	}

	if existingID != "" {
		if _, err := tx.Exec(ctx, `
			UPDATE public.construction_cost_volumes
			   SET volume = $1, notes = $2, updated_at = NOW()
			 WHERE id = $3
		`, volume, notes, existingID); err != nil {
			return fmt.Errorf("ccvRepo.UpsertVolume: update: %w", err)
		}
	} else {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.construction_cost_volumes
			    (tender_id, detail_cost_category_id, group_key, volume, notes)
			VALUES ($1, $2, $3, $4, $5)
		`, tenderID, detailCostCategoryID, groupKey, volume, notes); err != nil {
			return fmt.Errorf("ccvRepo.UpsertVolume: insert: %w", err)
		}
	}

	return tx.Commit(ctx)
}
