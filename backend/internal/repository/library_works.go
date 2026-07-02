package repository

import (
	"context"
	"fmt"
)

// ─── works_library ──────────────────────────────────────────────────────────

// WorkLibraryRow mirrors a works_library row + work_names embed.
type WorkLibraryRow struct {
	ID           string         `json:"id"`
	WorkNameID   *string        `json:"work_name_id"`
	ItemType     string         `json:"item_type"`
	UnitRate     float64        `json:"unit_rate"`
	CurrencyType string         `json:"currency_type"`
	FolderID     *string        `json:"folder_id"`
	CreatedAt    *string        `json:"created_at"`
	UpdatedAt    *string        `json:"updated_at"`
	WorkNames    *WorkNameEmbed `json:"work_names"`
}

// WorkLibraryInput is the create/update payload.
type WorkLibraryInput struct {
	WorkNameID   string  `json:"work_name_id"`
	ItemType     string  `json:"item_type"`
	UnitRate     float64 `json:"unit_rate"`
	CurrencyType string  `json:"currency_type"`
}

// ListWorks returns works_library with work_names embed, newest first.
func (r *LibraryRepo) ListWorks(ctx context.Context) ([]WorkLibraryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT wl.id::text, wl.work_name_id::text, wl.item_type::text,
		       wl.unit_rate, wl.currency_type::text, wl.folder_id::text,
		       to_char(wl.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(wl.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       wn.id::text, wn.name, wn.unit
		FROM public.works_library wl
		LEFT JOIN public.work_names wn ON wn.id = wl.work_name_id
		ORDER BY wl.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListWorks: %w", err)
	}
	defer rows.Close()
	out := make([]WorkLibraryRow, 0)
	for rows.Next() {
		var w WorkLibraryRow
		var wnID, wnName, wnUnit *string
		if err := rows.Scan(
			&w.ID, &w.WorkNameID, &w.ItemType, &w.UnitRate,
			&w.CurrencyType, &w.FolderID, &w.CreatedAt, &w.UpdatedAt,
			&wnID, &wnName, &wnUnit,
		); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListWorks scan: %w", err)
		}
		if wnID != nil {
			w.WorkNames = &WorkNameEmbed{
				ID:   *wnID,
				Name: derefStr(wnName),
				Unit: derefStr(wnUnit),
			}
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// CreateWork inserts a works_library row.
func (r *LibraryRepo) CreateWork(ctx context.Context, in WorkLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.works_library (work_name_id, item_type, unit_rate, currency_type)
		VALUES ($1::uuid, $2, $3, $4)
	`, in.WorkNameID, in.ItemType, in.UnitRate, in.CurrencyType)
	if err != nil {
		return fmt.Errorf("libraryRepo.CreateWork: %w", err)
	}
	return nil
}

// UpdateWork patches a works_library row.
func (r *LibraryRepo) UpdateWork(ctx context.Context, id string, in WorkLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.works_library
		SET work_name_id  = $1::uuid,
		    item_type     = $2,
		    unit_rate     = $3,
		    currency_type = $4,
		    updated_at    = NOW()
		WHERE id = $5
	`, in.WorkNameID, in.ItemType, in.UnitRate, in.CurrencyType, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.UpdateWork: %w", err)
	}
	return nil
}

// DeleteWork removes a works_library row.
func (r *LibraryRepo) DeleteWork(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.works_library WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteWork: %w", err)
	}
	return nil
}
