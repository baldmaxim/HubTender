package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Write input types
// ---------------------------------------------------------------------------

// CreatePositionInput holds validated fields for inserting a client_position.
type CreatePositionInput struct {
	TenderID         string
	PositionNumber   int
	WorkName         string
	UnitCode         *string
	Volume           *float64
	ParentPositionID *string
	HierarchyLevel   *int
	IsAdditional     *bool
	ItemNo           *string
	CreatedBy        string
}

// UpdatePositionInput holds validated patch fields for a client_position.
type UpdatePositionInput struct {
	PositionNumber   *int
	WorkName         *string
	UnitCode         *string
	Volume           *float64
	ParentPositionID *string
	HierarchyLevel   *int
	IsAdditional     *bool
	ItemNo           *string
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// PositionRow mirrors the columns returned by ListPositions.
type PositionRow struct {
	ID               string    `json:"id"`
	TenderID         string    `json:"tender_id"`
	PositionNumber   int       `json:"position_number"`
	WorkName         string    `json:"work_name"`
	UnitCode         *string   `json:"unit_code"`
	Volume           *float64  `json:"volume"`
	HierarchyLevel   *int      `json:"hierarchy_level"`
	ParentPositionID *string   `json:"parent_position_id"`
	IsAdditional     *bool     `json:"is_additional"`
	ItemNo           *string   `json:"item_no"`
	TotalMaterial    *float64  `json:"total_material"`
	TotalWorks       *float64  `json:"total_works"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// PositionListParams holds pagination parameters for ListPositions.
type PositionListParams struct {
	TenderID        string
	CursorUpdatedAt *time.Time
	CursorID        *string
	Limit           int
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// PositionRepo handles read-only database access for client_positions.
type PositionRepo struct {
	pool *pgxpool.Pool
}

// NewPositionRepo creates a PositionRepo.
func NewPositionRepo(pool *pgxpool.Pool) *PositionRepo {
	return &PositionRepo{pool: pool}
}

// ListPositions returns a page of client_positions for the given tender,
// ordered by (updated_at DESC, id DESC). No BOQ items are embedded.
func (r *PositionRepo) ListPositions(ctx context.Context, p PositionListParams) ([]PositionRow, error) {
	args := []any{p.TenderID}
	argN := 2

	cursor := ""
	if p.CursorUpdatedAt != nil && p.CursorID != nil {
		cursor = fmt.Sprintf(
			"AND (updated_at, id) < ($%d, $%d)",
			argN, argN+1,
		)
		args = append(args, *p.CursorUpdatedAt, *p.CursorID)
		argN += 2
	}

	limit := p.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	args = append(args, limit)

	q := fmt.Sprintf(`
		SELECT id::text, tender_id::text, position_number, work_name,
		       unit_code, volume, hierarchy_level,
		       parent_position_id::text, is_additional, item_no,
		       total_material, total_works,
		       COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
		FROM public.client_positions
		WHERE tender_id = $1
		%s
		ORDER BY updated_at DESC, id DESC
		LIMIT $%d
	`, cursor, argN)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.ListPositions: query: %w", err)
	}
	defer rows.Close()

	var result []PositionRow
	for rows.Next() {
		var row PositionRow
		if err := rows.Scan(
			&row.ID, &row.TenderID, &row.PositionNumber, &row.WorkName,
			&row.UnitCode, &row.Volume, &row.HierarchyLevel,
			&row.ParentPositionID, &row.IsAdditional, &row.ItemNo,
			&row.TotalMaterial, &row.TotalWorks,
			&row.CreatedAt, &row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("positionRepo.ListPositions: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("positionRepo.ListPositions: rows: %w", err)
	}
	return result, nil
}

// positionScanCols is the common SELECT column list for PositionRow scans.
const positionScanCols = `
	id::text, tender_id::text, position_number, work_name,
	unit_code, volume, hierarchy_level,
	parent_position_id::text, is_additional, item_no,
	total_material, total_works,
	COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
`

func scanPositionRow(row interface{ Scan(...any) error }) (*PositionRow, error) {
	var p PositionRow
	if err := row.Scan(
		&p.ID, &p.TenderID, &p.PositionNumber, &p.WorkName,
		&p.UnitCode, &p.Volume, &p.HierarchyLevel,
		&p.ParentPositionID, &p.IsAdditional, &p.ItemNo,
		&p.TotalMaterial, &p.TotalWorks,
		&p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &p, nil
}

// GetPositionByID fetches a single PositionRow by primary key.
func (r *PositionRepo) GetPositionByID(ctx context.Context, id string) (*PositionRow, error) {
	q := "SELECT " + positionScanCols + " FROM public.client_positions WHERE id = $1"
	row := r.pool.QueryRow(ctx, q, id)
	p, err := scanPositionRow(row)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.GetPositionByID: scan: %w", err)
	}
	return p, nil
}

// CreatePosition inserts a new client_position and returns the created row.
func (r *PositionRepo) CreatePosition(ctx context.Context, in CreatePositionInput) (*PositionRow, error) {
	q := `
		INSERT INTO public.client_positions
		    (tender_id, position_number, work_name, unit_code, volume,
		     parent_position_id, hierarchy_level, is_additional, item_no, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
		RETURNING ` + positionScanCols
	row := r.pool.QueryRow(ctx, q,
		in.TenderID, in.PositionNumber, in.WorkName,
		in.UnitCode, in.Volume,
		in.ParentPositionID, in.HierarchyLevel, in.IsAdditional, in.ItemNo,
		in.CreatedBy,
	)
	p, err := scanPositionRow(row)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.CreatePosition: scan: %w", err)
	}
	return p, nil
}

// UpdatePosition applies non-nil fields from in to the position with the
// given id and returns the updated row.
func (r *PositionRepo) UpdatePosition(ctx context.Context, id string, in UpdatePositionInput) (*PositionRow, error) {
	args := []any{}
	argN := 1
	setClauses := ""

	set := func(col string, val any) {
		if setClauses != "" {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", col, argN)
		args = append(args, val)
		argN++
	}

	if in.PositionNumber != nil {
		set("position_number", *in.PositionNumber)
	}
	if in.WorkName != nil {
		set("work_name", *in.WorkName)
	}
	if in.UnitCode != nil {
		set("unit_code", *in.UnitCode)
	}
	if in.Volume != nil {
		set("volume", *in.Volume)
	}
	if in.ParentPositionID != nil {
		set("parent_position_id", *in.ParentPositionID)
	}
	if in.HierarchyLevel != nil {
		set("hierarchy_level", *in.HierarchyLevel)
	}
	if in.IsAdditional != nil {
		set("is_additional", *in.IsAdditional)
	}
	if in.ItemNo != nil {
		set("item_no", *in.ItemNo)
	}

	if setClauses == "" {
		return r.GetPositionByID(ctx, id)
	}

	setClauses += fmt.Sprintf(", updated_at = NOW()")
	args = append(args, id)

	q := fmt.Sprintf("UPDATE public.client_positions SET %s WHERE id = $%d RETURNING "+positionScanCols,
		setClauses, argN)
	row := r.pool.QueryRow(ctx, q, args...)
	p, err := scanPositionRow(row)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.UpdatePosition: scan: %w", err)
	}
	return p, nil
}
