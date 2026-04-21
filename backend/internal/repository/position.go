package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

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
