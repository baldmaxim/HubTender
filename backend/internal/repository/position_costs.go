package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PositionWithCostsRow mirrors the output columns of the
// public.get_positions_with_costs(p_tender_id) SQL function
// (lines 1164-1233 of 00000000000005_baseline_functions.sql).
type PositionWithCostsRow struct {
	ID                          string    `json:"id"`
	TenderID                    string    `json:"tender_id"`
	PositionNumber              float64   `json:"position_number"`
	UnitCode                    *string   `json:"unit_code"`
	Volume                      *float64  `json:"volume"`
	ClientNote                  *string   `json:"client_note"`
	ItemNo                      *string   `json:"item_no"`
	WorkName                    string    `json:"work_name"`
	ManualVolume                *float64  `json:"manual_volume"`
	ManualNote                  *string   `json:"manual_note"`
	HierarchyLevel              *int      `json:"hierarchy_level"`
	IsAdditional                *bool     `json:"is_additional"`
	ParentPositionID            *string   `json:"parent_position_id"`
	TotalMaterial               *float64  `json:"total_material"`
	TotalWorks                  *float64  `json:"total_works"`
	MaterialCostPerUnit         *float64  `json:"material_cost_per_unit"`
	WorkCostPerUnit             *float64  `json:"work_cost_per_unit"`
	TotalCommercialMaterial     *float64  `json:"total_commercial_material"`
	TotalCommercialWork         *float64  `json:"total_commercial_work"`
	TotalCommercialMaterialPerUnit *float64 `json:"total_commercial_material_per_unit"`
	TotalCommercialWorkPerUnit  *float64  `json:"total_commercial_work_per_unit"`
	CreatedAt                   time.Time `json:"created_at"`
	UpdatedAt                   time.Time `json:"updated_at"`
	BaseTotal                   float64   `json:"base_total"`
	CommercialTotal             float64   `json:"commercial_total"`
	MaterialCostTotal           float64   `json:"material_cost_total"`
	WorkCostTotal               float64   `json:"work_cost_total"`
	MarkupPercentage            float64   `json:"markup_percentage"`
	ItemsCount                  int64     `json:"items_count"`
}

// PositionCostsRepo handles the positions-with-costs aggregate query.
type PositionCostsRepo struct {
	pool *pgxpool.Pool
}

// NewPositionCostsRepo creates a PositionCostsRepo.
func NewPositionCostsRepo(pool *pgxpool.Pool) *PositionCostsRepo {
	return &PositionCostsRepo{pool: pool}
}

// GetPositionsWithCosts executes the native equivalent of the
// get_positions_with_costs RPC for the given tender.
func (r *PositionCostsRepo) GetPositionsWithCosts(
	ctx context.Context,
	tenderID string,
) ([]PositionWithCostsRow, error) {
	const q = `
		SELECT
		    cp.id::text,
		    cp.tender_id::text,
		    cp.position_number,
		    cp.unit_code,
		    cp.volume,
		    cp.client_note,
		    cp.item_no,
		    cp.work_name,
		    cp.manual_volume,
		    cp.manual_note,
		    cp.hierarchy_level,
		    cp.is_additional,
		    cp.parent_position_id::text,
		    cp.total_material,
		    cp.total_works,
		    cp.material_cost_per_unit,
		    cp.work_cost_per_unit,
		    cp.total_commercial_material,
		    cp.total_commercial_work,
		    cp.total_commercial_material_per_unit,
		    cp.total_commercial_work_per_unit,
		    COALESCE(cp.created_at, NOW()),
		    COALESCE(cp.updated_at, NOW()),
		    COALESCE(SUM(b.total_amount), 0)                                                      AS base_total,
		    COALESCE(SUM(COALESCE(b.total_commercial_material_cost,0) + COALESCE(b.total_commercial_work_cost,0)), 0) AS commercial_total,
		    COALESCE(SUM(b.total_commercial_material_cost), 0)                                    AS material_cost_total,
		    COALESCE(SUM(b.total_commercial_work_cost), 0)                                        AS work_cost_total,
		    CASE
		        WHEN COALESCE(SUM(b.total_amount), 0) > 0
		            THEN COALESCE(SUM(COALESCE(b.total_commercial_material_cost,0) + COALESCE(b.total_commercial_work_cost,0)), 0)
		                 / SUM(b.total_amount)
		        ELSE 1
		    END                                                                                    AS markup_percentage,
		    COUNT(b.id)                                                                            AS items_count
		FROM public.client_positions cp
		LEFT JOIN public.boq_items b
		    ON b.client_position_id = cp.id
		   AND b.tender_id = $1
		WHERE cp.tender_id = $1
		GROUP BY
		    cp.id, cp.tender_id, cp.position_number, cp.unit_code, cp.volume,
		    cp.client_note, cp.item_no, cp.work_name, cp.manual_volume, cp.manual_note,
		    cp.hierarchy_level, cp.is_additional, cp.parent_position_id,
		    cp.total_material, cp.total_works, cp.material_cost_per_unit, cp.work_cost_per_unit,
		    cp.total_commercial_material, cp.total_commercial_work,
		    cp.total_commercial_material_per_unit, cp.total_commercial_work_per_unit,
		    cp.created_at, cp.updated_at
		ORDER BY cp.position_number, cp.id
	`

	rows, err := r.pool.Query(ctx, q, tenderID)
	if err != nil {
		return nil, fmt.Errorf("positionCostsRepo.GetPositionsWithCosts: query: %w", err)
	}
	defer rows.Close()

	var result []PositionWithCostsRow
	for rows.Next() {
		var row PositionWithCostsRow
		if err := rows.Scan(
			&row.ID, &row.TenderID, &row.PositionNumber,
			&row.UnitCode, &row.Volume, &row.ClientNote,
			&row.ItemNo, &row.WorkName, &row.ManualVolume, &row.ManualNote,
			&row.HierarchyLevel, &row.IsAdditional, &row.ParentPositionID,
			&row.TotalMaterial, &row.TotalWorks,
			&row.MaterialCostPerUnit, &row.WorkCostPerUnit,
			&row.TotalCommercialMaterial, &row.TotalCommercialWork,
			&row.TotalCommercialMaterialPerUnit, &row.TotalCommercialWorkPerUnit,
			&row.CreatedAt, &row.UpdatedAt,
			&row.BaseTotal, &row.CommercialTotal,
			&row.MaterialCostTotal, &row.WorkCostTotal,
			&row.MarkupPercentage, &row.ItemsCount,
		); err != nil {
			return nil, fmt.Errorf("positionCostsRepo.GetPositionsWithCosts: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("positionCostsRepo.GetPositionsWithCosts: rows: %w", err)
	}
	return result, nil
}
