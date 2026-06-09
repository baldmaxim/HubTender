package repository

import (
	"context"
	"errors"
	"fmt"

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
//
// Атомарный upsert через INSERT ... ON CONFLICT по партиальным уникальным индексам
// construction_cost_volumes_tender_detail_key / _tender_group_key. Это исключает гонку
// двойного INSERT (которая порождала дубли строк и «несохраняющийся» объём) и делает
// повторный вызов идемпотентным.
func (r *ConstructionCostVolumesRepo) UpsertVolume(
	ctx context.Context, tenderID string, detailCostCategoryID, groupKey *string, volume float64, notes *string,
) error {
	hasDetail := detailCostCategoryID != nil && *detailCostCategoryID != ""
	hasGroup := groupKey != nil && *groupKey != ""
	if !hasDetail && !hasGroup {
		return errors.New("ccvRepo.UpsertVolume: detail_cost_category_id or group_key required")
	}

	if hasDetail {
		if _, err := r.pool.Exec(ctx, `
			INSERT INTO public.construction_cost_volumes
			    (tender_id, detail_cost_category_id, volume, notes)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (tender_id, detail_cost_category_id) WHERE detail_cost_category_id IS NOT NULL
			DO UPDATE SET volume = EXCLUDED.volume, notes = EXCLUDED.notes, updated_at = NOW()
		`, tenderID, *detailCostCategoryID, volume, notes); err != nil {
			return fmt.Errorf("ccvRepo.UpsertVolume: detail upsert: %w", err)
		}
		return nil
	}

	if _, err := r.pool.Exec(ctx, `
		INSERT INTO public.construction_cost_volumes
		    (tender_id, group_key, volume, notes)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (tender_id, group_key) WHERE group_key IS NOT NULL
		DO UPDATE SET volume = EXCLUDED.volume, notes = EXCLUDED.notes, updated_at = NOW()
	`, tenderID, *groupKey, volume, notes); err != nil {
		return fmt.Errorf("ccvRepo.UpsertVolume: group upsert: %w", err)
	}
	return nil
}
