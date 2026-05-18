package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// LibraryRepo owns works_library / materials_library / templates /
// library_folders CRUD consumed by src/pages/Library/. This file currently
// covers the WorksTab; sibling tabs are added incrementally.
type LibraryRepo struct {
	pool *pgxpool.Pool
}

// NewLibraryRepo creates a LibraryRepo.
func NewLibraryRepo(pool *pgxpool.Pool) *LibraryRepo {
	return &LibraryRepo{pool: pool}
}

// ─── works_library ──────────────────────────────────────────────────────────

// WorkNameEmbed mirrors the work_names(id,name,unit) PostgREST embed.
type WorkNameEmbed struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

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

// ─── materials_library ──────────────────────────────────────────────────────

// MaterialLibraryRow mirrors a materials_library row + material_names embed.
type MaterialLibraryRow struct {
	ID                     string         `json:"id"`
	MaterialNameID         *string        `json:"material_name_id"`
	MaterialType           string         `json:"material_type"`
	ItemType               string         `json:"item_type"`
	ConsumptionCoefficient *float64       `json:"consumption_coefficient"`
	UnitRate               float64        `json:"unit_rate"`
	CurrencyType           string         `json:"currency_type"`
	DeliveryPriceType      string         `json:"delivery_price_type"`
	DeliveryAmount         *float64       `json:"delivery_amount"`
	FolderID               *string        `json:"folder_id"`
	CreatedAt              *string        `json:"created_at"`
	UpdatedAt              *string        `json:"updated_at"`
	MaterialNames          *WorkNameEmbed `json:"material_names"`
}

// MaterialLibraryInput is the create/update payload.
type MaterialLibraryInput struct {
	MaterialNameID         string  `json:"material_name_id"`
	MaterialType           string  `json:"material_type"`
	ItemType               string  `json:"item_type"`
	ConsumptionCoefficient float64 `json:"consumption_coefficient"`
	UnitRate               float64 `json:"unit_rate"`
	CurrencyType           string  `json:"currency_type"`
	DeliveryPriceType      string  `json:"delivery_price_type"`
	DeliveryAmount         float64 `json:"delivery_amount"`
}

// ListMaterials returns materials_library with material_names embed, newest first.
func (r *LibraryRepo) ListMaterials(ctx context.Context) ([]MaterialLibraryRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT ml.id::text, ml.material_name_id::text, ml.material_type::text,
		       ml.item_type::text, ml.consumption_coefficient, ml.unit_rate,
		       ml.currency_type::text, ml.delivery_price_type::text,
		       ml.delivery_amount, ml.folder_id::text,
		       to_char(ml.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(ml.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       mn.id::text, mn.name, mn.unit
		FROM public.materials_library ml
		LEFT JOIN public.material_names mn ON mn.id = ml.material_name_id
		ORDER BY ml.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("libraryRepo.ListMaterials: %w", err)
	}
	defer rows.Close()
	out := make([]MaterialLibraryRow, 0)
	for rows.Next() {
		var m MaterialLibraryRow
		var mnID, mnName, mnUnit *string
		if err := rows.Scan(
			&m.ID, &m.MaterialNameID, &m.MaterialType, &m.ItemType,
			&m.ConsumptionCoefficient, &m.UnitRate, &m.CurrencyType,
			&m.DeliveryPriceType, &m.DeliveryAmount, &m.FolderID,
			&m.CreatedAt, &m.UpdatedAt,
			&mnID, &mnName, &mnUnit,
		); err != nil {
			return nil, fmt.Errorf("libraryRepo.ListMaterials scan: %w", err)
		}
		if mnID != nil {
			m.MaterialNames = &WorkNameEmbed{
				ID:   *mnID,
				Name: derefStr(mnName),
				Unit: derefStr(mnUnit),
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// CreateMaterial inserts a materials_library row.
func (r *LibraryRepo) CreateMaterial(ctx context.Context, in MaterialLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.materials_library (
			material_name_id, material_type, item_type, consumption_coefficient,
			unit_rate, currency_type, delivery_price_type, delivery_amount
		) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
	`, in.MaterialNameID, in.MaterialType, in.ItemType, in.ConsumptionCoefficient,
		in.UnitRate, in.CurrencyType, in.DeliveryPriceType, in.DeliveryAmount)
	if err != nil {
		return fmt.Errorf("libraryRepo.CreateMaterial: %w", err)
	}
	return nil
}

// UpdateMaterial patches a materials_library row.
func (r *LibraryRepo) UpdateMaterial(ctx context.Context, id string, in MaterialLibraryInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.materials_library
		SET material_name_id        = $1::uuid,
		    material_type           = $2,
		    item_type               = $3,
		    consumption_coefficient = $4,
		    unit_rate               = $5,
		    currency_type           = $6,
		    delivery_price_type     = $7,
		    delivery_amount         = $8,
		    updated_at              = NOW()
		WHERE id = $9
	`, in.MaterialNameID, in.MaterialType, in.ItemType, in.ConsumptionCoefficient,
		in.UnitRate, in.CurrencyType, in.DeliveryPriceType, in.DeliveryAmount, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.UpdateMaterial: %w", err)
	}
	return nil
}

// DeleteMaterial removes a materials_library row.
func (r *LibraryRepo) DeleteMaterial(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.materials_library WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("libraryRepo.DeleteMaterial: %w", err)
	}
	return nil
}
