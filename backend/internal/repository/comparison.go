package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ComparisonNoteRow mirrors the columns the comparison UI reads.
type ComparisonNoteRow struct {
	TenderID1         string  `json:"tender_id_1"`
	TenderID2         string  `json:"tender_id_2"`
	CostCategoryName  string  `json:"cost_category_name"`
	DetailCategoryKey *string `json:"detail_category_key"`
	Note              string  `json:"note"`
}

// CostVolumeRow mirrors public.construction_cost_volumes (read subset).
type CostVolumeRow struct {
	DetailCostCategoryID *string `json:"detail_cost_category_id"`
	Volume               float64 `json:"volume"`
	GroupKey             *string `json:"group_key"`
}

// ComparisonRepo serves comparison_notes + construction_cost_volumes reads.
type ComparisonRepo struct {
	pool *pgxpool.Pool
}

// NewComparisonRepo creates a ComparisonRepo.
func NewComparisonRepo(pool *pgxpool.Pool) *ComparisonRepo {
	return &ComparisonRepo{pool: pool}
}

// ListNotes returns notes for the tender pair in either order (mirrors the
// previous supabase .or(and(...),and(...))).
func (r *ComparisonRepo) ListNotes(ctx context.Context, t1, t2 string) ([]ComparisonNoteRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT tender_id_1::text, tender_id_2::text, cost_category_name,
		       detail_category_key, note
		FROM public.comparison_notes
		WHERE (tender_id_1 = $1::uuid AND tender_id_2 = $2::uuid)
		   OR (tender_id_1 = $2::uuid AND tender_id_2 = $1::uuid)
	`, t1, t2)
	if err != nil {
		return nil, fmt.Errorf("comparisonRepo.ListNotes: %w", err)
	}
	defer rows.Close()

	out := make([]ComparisonNoteRow, 0)
	for rows.Next() {
		var n ComparisonNoteRow
		if err := rows.Scan(&n.TenderID1, &n.TenderID2, &n.CostCategoryName, &n.DetailCategoryKey, &n.Note); err != nil {
			return nil, fmt.Errorf("comparisonRepo.ListNotes scan: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("comparisonRepo.ListNotes rows: %w", err)
	}
	return out, nil
}

// UpsertNotePair upserts the note in both tender orders inside one tx
// (mirrors the previous two-row supabase upsert; same unique constraint
// tender_id_1,tender_id_2,cost_category_name,detail_category_key).
func (r *ComparisonRepo) UpsertNotePair(
	ctx context.Context,
	t1, t2, costCategoryName string,
	detailCategoryKey *string,
	note, createdBy string,
) error {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("comparisonRepo.UpsertNotePair: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	const q = `
		INSERT INTO public.comparison_notes
			(tender_id_1, tender_id_2, cost_category_name, detail_category_key, note, created_by)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		ON CONFLICT (tender_id_1, tender_id_2, cost_category_name, detail_category_key)
		DO UPDATE SET note = EXCLUDED.note, updated_at = NOW()
	`
	if _, err := tx.Exec(ctx, q, t1, t2, costCategoryName, detailCategoryKey, note, createdBy); err != nil {
		return fmt.Errorf("comparisonRepo.UpsertNotePair: upsert(1): %w", err)
	}
	if _, err := tx.Exec(ctx, q, t2, t1, costCategoryName, detailCategoryKey, note, createdBy); err != nil {
		return fmt.Errorf("comparisonRepo.UpsertNotePair: upsert(2): %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("comparisonRepo.UpsertNotePair: commit: %w", err)
	}
	return nil
}

// ListCostVolumes returns construction_cost_volumes for a tender.
func (r *ComparisonRepo) ListCostVolumes(ctx context.Context, tenderID string) ([]CostVolumeRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT detail_cost_category_id::text, COALESCE(volume, 0), group_key
		FROM public.construction_cost_volumes
		WHERE tender_id = $1::uuid
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("comparisonRepo.ListCostVolumes: %w", err)
	}
	defer rows.Close()

	out := make([]CostVolumeRow, 0)
	for rows.Next() {
		var v CostVolumeRow
		if err := rows.Scan(&v.DetailCostCategoryID, &v.Volume, &v.GroupKey); err != nil {
			return nil, fmt.Errorf("comparisonRepo.ListCostVolumes scan: %w", err)
		}
		out = append(out, v)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("comparisonRepo.ListCostVolumes rows: %w", err)
	}
	return out, nil
}
