package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CostsRepo handles cost_categories + detail_cost_categories + locations +
// units write paths consumed by Admin/ConstructionCost.
type CostsRepo struct {
	pool *pgxpool.Pool
}

// NewCostsRepo creates a CostsRepo.
func NewCostsRepo(pool *pgxpool.Pool) *CostsRepo {
	return &CostsRepo{pool: pool}
}

// CostCategoryRecord mirrors public.cost_categories.
type CostCategoryRecord struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Unit      *string `json:"unit,omitempty"`
	CreatedAt *string `json:"created_at,omitempty"`
	UpdatedAt *string `json:"updated_at,omitempty"`
}

// DetailCostCategoryRecord mirrors public.detail_cost_categories.
type DetailCostCategoryRecord struct {
	ID             string  `json:"id"`
	CostCategoryID string  `json:"cost_category_id"`
	Name           string  `json:"name"`
	Unit           string  `json:"unit"`
	Location       *string `json:"location,omitempty"`
	OrderNum       *int    `json:"order_num,omitempty"`
	CreatedAt      *string `json:"created_at,omitempty"`
	UpdatedAt      *string `json:"updated_at,omitempty"`
}

// UnitFull mirrors the rows admin Nomenclatures consumes from public.units.
type UnitFull struct {
	Code      string  `json:"code"`
	Name      string  `json:"name"`
	Category  *string `json:"category,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
	IsActive  bool    `json:"is_active"`
	CreatedAt *string `json:"created_at,omitempty"`
	UpdatedAt *string `json:"updated_at,omitempty"`
}

// ─── cost_categories ────────────────────────────────────────────────────────

func (r *CostsRepo) ListCostCategories(ctx context.Context) ([]CostCategoryRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, unit,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.cost_categories
		ORDER BY name
	`)
	if err != nil {
		return nil, fmt.Errorf("costsRepo.ListCostCategories: %w", err)
	}
	defer rows.Close()
	out := make([]CostCategoryRecord, 0)
	for rows.Next() {
		var rec CostCategoryRecord
		if err := rows.Scan(&rec.ID, &rec.Name, &rec.Unit, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, fmt.Errorf("costsRepo.ListCostCategories scan: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (r *CostsRepo) ListCostCategoriesByIDs(ctx context.Context, ids []string) ([]CostCategoryRecord, error) {
	if len(ids) == 0 {
		return []CostCategoryRecord{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name, unit,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.cost_categories
		WHERE id = ANY($1::uuid[])
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("costsRepo.ListCostCategoriesByIDs: %w", err)
	}
	defer rows.Close()
	out := make([]CostCategoryRecord, 0)
	for rows.Next() {
		var rec CostCategoryRecord
		if err := rows.Scan(&rec.ID, &rec.Name, &rec.Unit, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, fmt.Errorf("costsRepo.ListCostCategoriesByIDs scan: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (r *CostsRepo) FindCostCategoryByNameAndUnit(ctx context.Context, name, unit string) (*CostCategoryRecord, error) {
	var rec CostCategoryRecord
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, name, unit,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.cost_categories
		WHERE name = $1 AND unit = $2
		LIMIT 1
	`, name, unit).Scan(&rec.ID, &rec.Name, &rec.Unit, &rec.CreatedAt, &rec.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("costsRepo.FindCostCategoryByNameAndUnit: %w", err)
	}
	return &rec, nil
}

type CostCategoryInput struct {
	Name string  `json:"name"`
	Unit *string `json:"unit"`
}

func (r *CostsRepo) CreateCostCategory(ctx context.Context, in CostCategoryInput) (*CostCategoryRecord, error) {
	var rec CostCategoryRecord
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.cost_categories (name, unit)
		VALUES ($1, $2)
		RETURNING id::text, name, unit,
		          to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		          to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	`, in.Name, in.Unit).Scan(&rec.ID, &rec.Name, &rec.Unit, &rec.CreatedAt, &rec.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("costsRepo.CreateCostCategory: %w", err)
	}
	return &rec, nil
}

func (r *CostsRepo) UpdateCostCategory(ctx context.Context, id string, in CostCategoryInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.cost_categories
		SET name = $1, unit = $2, updated_at = NOW()
		WHERE id = $3
	`, in.Name, in.Unit, id)
	if err != nil {
		return fmt.Errorf("costsRepo.UpdateCostCategory: %w", err)
	}
	return nil
}

func (r *CostsRepo) DeleteCostCategory(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.cost_categories WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("costsRepo.DeleteCostCategory: %w", err)
	}
	return nil
}

func (r *CostsRepo) DeleteAllCostCategories(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.cost_categories`)
	if err != nil {
		return fmt.Errorf("costsRepo.DeleteAllCostCategories: %w", err)
	}
	return nil
}

// ─── detail_cost_categories ─────────────────────────────────────────────────

func (r *CostsRepo) ListDetailCostCategoriesByOrder(ctx context.Context) ([]DetailCostCategoryRecord, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, cost_category_id::text, name, unit, location, order_num,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.detail_cost_categories
		ORDER BY order_num ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("costsRepo.ListDetailCostCategoriesByOrder: %w", err)
	}
	defer rows.Close()
	out := make([]DetailCostCategoryRecord, 0)
	for rows.Next() {
		var rec DetailCostCategoryRecord
		if err := rows.Scan(&rec.ID, &rec.CostCategoryID, &rec.Name, &rec.Unit,
			&rec.Location, &rec.OrderNum, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, fmt.Errorf("costsRepo.ListDetailCostCategoriesByOrder scan: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (r *CostsRepo) NextDetailOrderNum(ctx context.Context) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(order_num), 0) FROM public.detail_cost_categories
	`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("costsRepo.NextDetailOrderNum: %w", err)
	}
	return n, nil
}

type DetailCostCategoryInput struct {
	CostCategoryID *string `json:"cost_category_id"`
	Name           *string `json:"name"`
	Unit           *string `json:"unit"`
	Location       *string `json:"location"`
	OrderNum       *int    `json:"order_num"`
}

func (r *CostsRepo) CreateDetailCostCategory(ctx context.Context, in DetailCostCategoryInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.detail_cost_categories (cost_category_id, name, unit, location, order_num)
		VALUES ($1::uuid, $2, $3, $4, $5)
	`, in.CostCategoryID, in.Name, in.Unit, in.Location, in.OrderNum)
	if err != nil {
		return fmt.Errorf("costsRepo.CreateDetailCostCategory: %w", err)
	}
	return nil
}

type DetailCostCategoryPatch struct {
	Name     *string `json:"name"`
	Unit     *string `json:"unit"`
	Location *string `json:"location"`
}

func (r *CostsRepo) UpdateDetailCostCategory(ctx context.Context, id string, p DetailCostCategoryPatch) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.detail_cost_categories
		SET name     = COALESCE($1, name),
		    unit     = COALESCE($2, unit),
		    location = COALESCE($3, location),
		    updated_at = NOW()
		WHERE id = $4
	`, p.Name, p.Unit, p.Location, id)
	if err != nil {
		return fmt.Errorf("costsRepo.UpdateDetailCostCategory: %w", err)
	}
	return nil
}

func (r *CostsRepo) DeleteDetailCostCategory(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.detail_cost_categories WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("costsRepo.DeleteDetailCostCategory: %w", err)
	}
	return nil
}

func (r *CostsRepo) DeleteAllDetailCostCategories(ctx context.Context) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.detail_cost_categories`)
	if err != nil {
		return fmt.Errorf("costsRepo.DeleteAllDetailCostCategories: %w", err)
	}
	return nil
}

// ─── locations (read by id) ─────────────────────────────────────────────────

type LocationRecord struct {
	ID   string  `json:"id"`
	Name *string `json:"name,omitempty"`
}

func (r *CostsRepo) ListLocationsByIDs(ctx context.Context, ids []string) ([]LocationRecord, error) {
	if len(ids) == 0 {
		return []LocationRecord{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, name FROM public.locations WHERE id = ANY($1::uuid[])
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("costsRepo.ListLocationsByIDs: %w", err)
	}
	defer rows.Close()
	out := make([]LocationRecord, 0)
	for rows.Next() {
		var rec LocationRecord
		if err := rows.Scan(&rec.ID, &rec.Name); err != nil {
			return nil, fmt.Errorf("costsRepo.ListLocationsByIDs scan: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// ─── units (full row + import) ─────────────────────────────────────────────

func (r *CostsRepo) ListActiveUnitsFull(ctx context.Context) ([]UnitFull, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT code, name, category, sort_order, is_active,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.units
		WHERE is_active = true
		ORDER BY sort_order
	`)
	if err != nil {
		return nil, fmt.Errorf("costsRepo.ListActiveUnitsFull: %w", err)
	}
	defer rows.Close()
	out := make([]UnitFull, 0)
	for rows.Next() {
		var rec UnitFull
		if err := rows.Scan(&rec.Code, &rec.Name, &rec.Category, &rec.SortOrder,
			&rec.IsActive, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
			return nil, fmt.Errorf("costsRepo.ListActiveUnitsFull scan: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

type ImportedUnitRow struct {
	Code      string `json:"code"`
	Name      string `json:"name"`
	NameShort string `json:"name_short"`
	Category  string `json:"category"`
	SortOrder int    `json:"sort_order"`
	IsActive  bool   `json:"is_active"`
}

func (r *CostsRepo) UpsertImportedUnits(ctx context.Context, units []ImportedUnitRow) error {
	if len(units) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("costsRepo.UpsertImportedUnits: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	for _, u := range units {
		_, err := tx.Exec(ctx, `
			INSERT INTO public.units (code, name, name_short, category, sort_order, is_active)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (code) DO UPDATE SET
				name       = EXCLUDED.name,
				name_short = EXCLUDED.name_short,
				category   = EXCLUDED.category,
				sort_order = EXCLUDED.sort_order,
				is_active  = EXCLUDED.is_active,
				updated_at = NOW()
		`, u.Code, u.Name, u.NameShort, u.Category, u.SortOrder, u.IsActive)
		if err != nil {
			return fmt.Errorf("costsRepo.UpsertImportedUnits exec: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("costsRepo.UpsertImportedUnits commit: %w", err)
	}
	return nil
}
