package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Row types — each mirrors the columns returned by its query.
// ---------------------------------------------------------------------------

// RoleRow represents a row from the public.roles table.
type RoleRow struct {
	Code         string   `json:"code"`
	Name         string   `json:"name"`
	Color        string   `json:"color"`
	AllowedPages []string `json:"allowed_pages"`
}

// UnitRow represents a distinct unit entry from material_names / work_names.
type UnitRow struct {
	ID   string `json:"id"`
	Unit string `json:"unit"`
}

// MaterialNameRow represents a row from the public.material_names table.
type MaterialNameRow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// WorkNameRow represents a row from the public.work_names table.
type WorkNameRow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// CostCategoryRow represents a row from public.cost_categories.
type CostCategoryRow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Code string `json:"code"`
}

// DetailCostCategoryRow represents a row from public.detail_cost_categories.
type DetailCostCategoryRow struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Code           string `json:"code"`
	CostCategoryID string `json:"cost_category_id"`
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// ReferenceRepo handles database access for read-only reference tables.
type ReferenceRepo struct {
	pool *pgxpool.Pool
}

// NewReferenceRepo creates a ReferenceRepo backed by the given pool.
func NewReferenceRepo(pool *pgxpool.Pool) *ReferenceRepo {
	return &ReferenceRepo{pool: pool}
}

// GetRoles returns all rows from public.roles ordered by name.
func (r *ReferenceRepo) GetRoles(ctx context.Context) ([]RoleRow, error) {
	const q = `
		SELECT code, COALESCE(name,''), COALESCE(color,''),
		       COALESCE(allowed_pages::text, '[]')
		FROM public.roles
		ORDER BY name
	`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("referenceRepo.GetRoles: query: %w", err)
	}
	defer rows.Close()

	var result []RoleRow
	for rows.Next() {
		var (
			row      RoleRow
			pagesRaw string
		)
		if err := rows.Scan(&row.Code, &row.Name, &row.Color, &pagesRaw); err != nil {
			return nil, fmt.Errorf("referenceRepo.GetRoles: scan: %w", err)
		}
		row.AllowedPages = parseJSONStringArray(pagesRaw)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("referenceRepo.GetRoles: rows: %w", err)
	}
	return result, nil
}

// GetUnits returns distinct units referenced across material_names and
// work_names. Used to populate unit selector dropdowns in the UI.
func (r *ReferenceRepo) GetUnits(ctx context.Context) ([]UnitRow, error) {
	const q = `
		SELECT DISTINCT id::text, unit::text
		FROM (
		    SELECT id, unit FROM public.material_names
		    UNION
		    SELECT id, unit FROM public.work_names
		) combined
		ORDER BY unit
	`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("referenceRepo.GetUnits: query: %w", err)
	}
	defer rows.Close()

	var result []UnitRow
	for rows.Next() {
		var row UnitRow
		if err := rows.Scan(&row.ID, &row.Unit); err != nil {
			return nil, fmt.Errorf("referenceRepo.GetUnits: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("referenceRepo.GetUnits: rows: %w", err)
	}
	return result, nil
}

// GetMaterialNames returns all rows from public.material_names ordered by name.
func (r *ReferenceRepo) GetMaterialNames(ctx context.Context) ([]MaterialNameRow, error) {
	const q = `
		SELECT id::text, COALESCE(name,''), unit::text
		FROM public.material_names
		ORDER BY name
	`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("referenceRepo.GetMaterialNames: query: %w", err)
	}
	defer rows.Close()

	var result []MaterialNameRow
	for rows.Next() {
		var row MaterialNameRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Unit); err != nil {
			return nil, fmt.Errorf("referenceRepo.GetMaterialNames: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("referenceRepo.GetMaterialNames: rows: %w", err)
	}
	return result, nil
}

// GetWorkNames returns all rows from public.work_names ordered by name.
func (r *ReferenceRepo) GetWorkNames(ctx context.Context) ([]WorkNameRow, error) {
	const q = `
		SELECT id::text, COALESCE(name,''), unit::text
		FROM public.work_names
		ORDER BY name
	`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("referenceRepo.GetWorkNames: query: %w", err)
	}
	defer rows.Close()

	var result []WorkNameRow
	for rows.Next() {
		var row WorkNameRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Unit); err != nil {
			return nil, fmt.Errorf("referenceRepo.GetWorkNames: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("referenceRepo.GetWorkNames: rows: %w", err)
	}
	return result, nil
}

// GetCostCategories returns all rows from public.cost_categories ordered by name.
func (r *ReferenceRepo) GetCostCategories(ctx context.Context) ([]CostCategoryRow, error) {
	const q = `
		SELECT id::text, COALESCE(name,''), COALESCE(code,'')
		FROM public.cost_categories
		ORDER BY name
	`

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("referenceRepo.GetCostCategories: query: %w", err)
	}
	defer rows.Close()

	var result []CostCategoryRow
	for rows.Next() {
		var row CostCategoryRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Code); err != nil {
			return nil, fmt.Errorf("referenceRepo.GetCostCategories: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("referenceRepo.GetCostCategories: rows: %w", err)
	}
	return result, nil
}

// GetDetailCostCategories returns rows from public.detail_cost_categories.
// If costCategoryID is non-empty, results are filtered to that parent category.
func (r *ReferenceRepo) GetDetailCostCategories(
	ctx context.Context,
	costCategoryID string,
) ([]DetailCostCategoryRow, error) {
	var (
		q    string
		args []any
	)

	if costCategoryID != "" {
		q = `
			SELECT id::text, COALESCE(name,''), COALESCE(code,''), cost_category_id::text
			FROM public.detail_cost_categories
			WHERE cost_category_id = $1
			ORDER BY name
		`
		args = []any{costCategoryID}
	} else {
		q = `
			SELECT id::text, COALESCE(name,''), COALESCE(code,''), cost_category_id::text
			FROM public.detail_cost_categories
			ORDER BY name
		`
	}

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("referenceRepo.GetDetailCostCategories: query: %w", err)
	}
	defer rows.Close()

	var result []DetailCostCategoryRow
	for rows.Next() {
		var row DetailCostCategoryRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Code, &row.CostCategoryID); err != nil {
			return nil, fmt.Errorf("referenceRepo.GetDetailCostCategories: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("referenceRepo.GetDetailCostCategories: rows: %w", err)
	}
	return result, nil
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// parseJSONStringArray deserialises a JSON array string (e.g. '["a","b"]')
// into a Go string slice. Returns nil on any parse error so callers can treat
// nil and empty slice equivalently.
func parseJSONStringArray(raw string) []string {
	if raw == "" || raw == "null" {
		return nil
	}
	var out []string
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}
