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

// BoqItemRow mirrors the columns returned by ListBoqItems.
type BoqItemRow struct {
	ID                   string    `json:"id"`
	ClientPositionID     string    `json:"client_position_id"`
	TenderID             string    `json:"tender_id"`
	BoqItemType          string    `json:"boq_item_type"`
	MaterialType         *string   `json:"material_type"`
	Description          *string   `json:"description"`
	UnitCode             *string   `json:"unit_code"`
	Quantity             *float64  `json:"quantity"`
	UnitRate             *float64  `json:"unit_rate"`
	CurrencyType         *string   `json:"currency_type"`
	DeliveryPriceType    *string   `json:"delivery_price_type"`
	DeliveryAmount       *float64  `json:"delivery_amount"`
	TotalAmount          *float64  `json:"total_amount"`
	SortNumber           int       `json:"sort_number"`
	DetailCostCategoryID *string   `json:"detail_cost_category_id"`
	ParentWorkItemID     *string   `json:"parent_work_item_id"`
	MaterialNameID       *string   `json:"material_name_id"`
	WorkNameID           *string   `json:"work_name_id"`
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// BoqRepo handles read-only database access for boq_items.
type BoqRepo struct {
	pool *pgxpool.Pool
}

// NewBoqRepo creates a BoqRepo.
func NewBoqRepo(pool *pgxpool.Pool) *BoqRepo {
	return &BoqRepo{pool: pool}
}

// ListBoqItems returns all BOQ items for the given position, ordered by sort_number.
// The tenderID is included for RLS alignment but the primary filter is client_position_id.
func (r *BoqRepo) ListBoqItems(ctx context.Context, tenderID, positionID string) ([]BoqItemRow, error) {
	const q = `
		SELECT
		    id::text,
		    client_position_id::text,
		    tender_id::text,
		    boq_item_type::text,
		    material_type::text,
		    description,
		    unit_code,
		    quantity,
		    unit_rate,
		    currency_type::text,
		    delivery_price_type::text,
		    delivery_amount,
		    total_amount,
		    sort_number,
		    detail_cost_category_id::text,
		    parent_work_item_id::text,
		    material_name_id::text,
		    work_name_id::text,
		    COALESCE(created_at, NOW()),
		    COALESCE(updated_at, NOW())
		FROM public.boq_items
		WHERE tender_id = $1
		  AND client_position_id = $2
		ORDER BY sort_number ASC, id ASC
	`

	rows, err := r.pool.Query(ctx, q, tenderID, positionID)
	if err != nil {
		return nil, fmt.Errorf("boqRepo.ListBoqItems: query: %w", err)
	}
	defer rows.Close()

	var result []BoqItemRow
	for rows.Next() {
		var row BoqItemRow
		if err := rows.Scan(
			&row.ID, &row.ClientPositionID, &row.TenderID,
			&row.BoqItemType, &row.MaterialType, &row.Description,
			&row.UnitCode, &row.Quantity, &row.UnitRate,
			&row.CurrencyType, &row.DeliveryPriceType, &row.DeliveryAmount,
			&row.TotalAmount, &row.SortNumber,
			&row.DetailCostCategoryID, &row.ParentWorkItemID,
			&row.MaterialNameID, &row.WorkNameID,
			&row.CreatedAt, &row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("boqRepo.ListBoqItems: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("boqRepo.ListBoqItems: rows: %w", err)
	}
	return result, nil
}
