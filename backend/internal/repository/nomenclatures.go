package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NomenclaturesRepo handles units / material_names / work_names CRUD plus
// remap operations consumed by Admin/Nomenclatures and Admin/ConstructionCost.
type NomenclaturesRepo struct {
	pool *pgxpool.Pool
}

// NewNomenclaturesRepo creates a NomenclaturesRepo.
func NewNomenclaturesRepo(pool *pgxpool.Pool) *NomenclaturesRepo {
	return &NomenclaturesRepo{pool: pool}
}

// ─── Units ──────────────────────────────────────────────────────────────────

func (r *NomenclaturesRepo) ListUnits(ctx context.Context) ([]UnitFull, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT code, name, category, sort_order, is_active,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.units
		ORDER BY sort_order
	`)
	if err != nil {
		return nil, fmt.Errorf("nomenclaturesRepo.ListUnits: %w", err)
	}
	defer rows.Close()
	out := make([]UnitFull, 0)
	for rows.Next() {
		var u UnitFull
		if err := rows.Scan(&u.Code, &u.Name, &u.Category, &u.SortOrder,
			&u.IsActive, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, fmt.Errorf("nomenclaturesRepo.ListUnits scan: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

type ActiveUnitShort struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

func (r *NomenclaturesRepo) ListActiveUnitsShort(ctx context.Context) ([]ActiveUnitShort, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT code, name FROM public.units
		WHERE is_active = true
		ORDER BY sort_order
	`)
	if err != nil {
		return nil, fmt.Errorf("nomenclaturesRepo.ListActiveUnitsShort: %w", err)
	}
	defer rows.Close()
	out := make([]ActiveUnitShort, 0)
	for rows.Next() {
		var u ActiveUnitShort
		if err := rows.Scan(&u.Code, &u.Name); err != nil {
			return nil, fmt.Errorf("nomenclaturesRepo.ListActiveUnitsShort scan: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *NomenclaturesRepo) UnitExists(ctx context.Context, code string) (bool, error) {
	var exists bool
	err := r.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.units WHERE code = $1)
	`, code).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("nomenclaturesRepo.UnitExists: %w", err)
	}
	return exists, nil
}

type UnitInput struct {
	Code        *string `json:"code"`
	Name        string  `json:"name"`
	Category    *string `json:"category"`
	Description *string `json:"description"`
	SortOrder   *int    `json:"sort_order"`
	IsActive    *bool   `json:"is_active"`
}

func (r *NomenclaturesRepo) CreateUnit(ctx context.Context, in UnitInput) error {
	if in.Code == nil {
		return errors.New("nomenclaturesRepo.CreateUnit: code required")
	}
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.units (code, name, category, description, sort_order, is_active)
		VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6, true))
	`, in.Code, in.Name, in.Category, in.Description, in.SortOrder, in.IsActive)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.CreateUnit: %w", err)
	}
	return nil
}

func (r *NomenclaturesRepo) UpdateUnit(ctx context.Context, code string, in UnitInput) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.units
		SET name = $1,
		    category = $2,
		    description = COALESCE($3, description),
		    sort_order = COALESCE($4, sort_order),
		    is_active = COALESCE($5, is_active),
		    updated_at = NOW()
		WHERE code = $6
	`, in.Name, in.Category, in.Description, in.SortOrder, in.IsActive, code)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.UpdateUnit: %w", err)
	}
	return nil
}

func (r *NomenclaturesRepo) DeleteUnit(ctx context.Context, code string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.units WHERE code = $1`, code)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.DeleteUnit: %w", err)
	}
	return nil
}

// ─── material_names + work_names ────────────────────────────────────────────

type NamedRow struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Unit      string  `json:"unit"`
	CreatedAt *string `json:"created_at,omitempty"`
	UpdatedAt *string `json:"updated_at,omitempty"`
}

const (
	tableMaterials = "public.material_names"
	tableWorks     = "public.work_names"
	tableLibMat    = "public.materials_library"
	tableLibWork   = "public.works_library"
	colMatNameID  = "material_name_id"
	colWorkNameID = "work_name_id"
)

func (r *NomenclaturesRepo) listAllNames(ctx context.Context, table string) ([]NamedRow, error) {
	const pageSize = 1000
	out := make([]NamedRow, 0)
	from := 0
	for {
		rows, err := r.pool.Query(ctx, fmt.Sprintf(`
			SELECT id::text, name, unit::text,
			       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
			       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
			FROM %s
			ORDER BY name
			LIMIT $1 OFFSET $2
		`, table), pageSize, from)
		if err != nil {
			return nil, fmt.Errorf("nomenclaturesRepo.listAllNames %s: %w", table, err)
		}

		batch := make([]NamedRow, 0, pageSize)
		for rows.Next() {
			var rec NamedRow
			if err := rows.Scan(&rec.ID, &rec.Name, &rec.Unit, &rec.CreatedAt, &rec.UpdatedAt); err != nil {
				rows.Close()
				return nil, fmt.Errorf("nomenclaturesRepo.listAllNames %s scan: %w", table, err)
			}
			batch = append(batch, rec)
		}
		rows.Close()
		out = append(out, batch...)
		if len(batch) < pageSize {
			break
		}
		from += pageSize
	}
	return out, nil
}

func (r *NomenclaturesRepo) ListMaterialNames(ctx context.Context) ([]NamedRow, error) {
	return r.listAllNames(ctx, tableMaterials)
}

func (r *NomenclaturesRepo) ListWorkNames(ctx context.Context) ([]NamedRow, error) {
	return r.listAllNames(ctx, tableWorks)
}

type NameUnitPair struct {
	Name string `json:"name"`
	Unit string `json:"unit"`
}

func (r *NomenclaturesRepo) listNamesByUnit(ctx context.Context, table, unit string) ([]NameUnitPair, error) {
	rows, err := r.pool.Query(ctx, fmt.Sprintf(`
		SELECT name, unit::text FROM %s WHERE unit = $1
	`, table), unit)
	if err != nil {
		return nil, fmt.Errorf("nomenclaturesRepo.listNamesByUnit %s: %w", table, err)
	}
	defer rows.Close()
	out := make([]NameUnitPair, 0)
	for rows.Next() {
		var p NameUnitPair
		if err := rows.Scan(&p.Name, &p.Unit); err != nil {
			return nil, fmt.Errorf("nomenclaturesRepo.listNamesByUnit %s scan: %w", table, err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *NomenclaturesRepo) ListMaterialNamesByUnit(ctx context.Context, unit string) ([]NameUnitPair, error) {
	return r.listNamesByUnit(ctx, tableMaterials, unit)
}

func (r *NomenclaturesRepo) ListWorkNamesByUnit(ctx context.Context, unit string) ([]NameUnitPair, error) {
	return r.listNamesByUnit(ctx, tableWorks, unit)
}

type NameInput struct {
	Name string `json:"name"`
	Unit string `json:"unit"`
}

func (r *NomenclaturesRepo) createName(ctx context.Context, table string, in NameInput) error {
	_, err := r.pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %s (name, unit) VALUES ($1, $2::unit_type)
	`, table), in.Name, in.Unit)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.createName %s: %w", table, err)
	}
	return nil
}

func (r *NomenclaturesRepo) updateName(ctx context.Context, table, id string, in NameInput) error {
	_, err := r.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET name = $1, unit = $2::unit_type, updated_at = NOW() WHERE id = $3
	`, table), in.Name, in.Unit, id)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.updateName %s: %w", table, err)
	}
	return nil
}

func (r *NomenclaturesRepo) deleteName(ctx context.Context, table, id string) error {
	_, err := r.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE id = $1`, table), id)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.deleteName %s: %w", table, err)
	}
	return nil
}

func (r *NomenclaturesRepo) deleteNamesIn(ctx context.Context, table string, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.pool.Exec(ctx, fmt.Sprintf(`
		DELETE FROM %s WHERE id = ANY($1::uuid[])
	`, table), ids)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.deleteNamesIn %s: %w", table, err)
	}
	return nil
}

func (r *NomenclaturesRepo) CreateMaterialName(ctx context.Context, in NameInput) error {
	return r.createName(ctx, tableMaterials, in)
}
func (r *NomenclaturesRepo) UpdateMaterialName(ctx context.Context, id string, in NameInput) error {
	return r.updateName(ctx, tableMaterials, id, in)
}
func (r *NomenclaturesRepo) DeleteMaterialName(ctx context.Context, id string) error {
	return r.deleteName(ctx, tableMaterials, id)
}
func (r *NomenclaturesRepo) DeleteMaterialNamesIn(ctx context.Context, ids []string) error {
	return r.deleteNamesIn(ctx, tableMaterials, ids)
}

func (r *NomenclaturesRepo) CreateWorkName(ctx context.Context, in NameInput) error {
	return r.createName(ctx, tableWorks, in)
}
func (r *NomenclaturesRepo) UpdateWorkName(ctx context.Context, id string, in NameInput) error {
	return r.updateName(ctx, tableWorks, id, in)
}
func (r *NomenclaturesRepo) DeleteWorkName(ctx context.Context, id string) error {
	return r.deleteName(ctx, tableWorks, id)
}
func (r *NomenclaturesRepo) DeleteWorkNamesIn(ctx context.Context, ids []string) error {
	return r.deleteNamesIn(ctx, tableWorks, ids)
}

// ─── Remap operations ──────────────────────────────────────────────────────

func (r *NomenclaturesRepo) remap(ctx context.Context, table, col, from, to string) error {
	if from == "" || to == "" {
		return errors.New("nomenclaturesRepo.remap: from and to required")
	}
	_, err := r.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %s SET %s = $1 WHERE %s = $2
	`, table, col, col), to, from)
	if err != nil {
		return fmt.Errorf("nomenclaturesRepo.remap %s: %w", table, err)
	}
	return nil
}

func (r *NomenclaturesRepo) RemapBoqMaterialName(ctx context.Context, from, to string) error {
	return r.remap(ctx, "public.boq_items", colMatNameID, from, to)
}
func (r *NomenclaturesRepo) RemapMaterialsLibraryMaterialName(ctx context.Context, from, to string) error {
	return r.remap(ctx, tableLibMat, colMatNameID, from, to)
}
func (r *NomenclaturesRepo) RemapBoqWorkName(ctx context.Context, from, to string) error {
	return r.remap(ctx, "public.boq_items", colWorkNameID, from, to)
}
func (r *NomenclaturesRepo) RemapWorksLibraryWorkName(ctx context.Context, from, to string) error {
	return r.remap(ctx, tableLibWork, colWorkNameID, from, to)
}
