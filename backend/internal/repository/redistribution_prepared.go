package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Stage 0.1.2.3b: server-side loading of the prepared-pipeline inputs.
// Save and GET both feed the SAME calc boundary
// (calc.BuildPreparedRedistribution) from these helpers — no second engine.

// loadPreparedPositions loads the tender's client positions with the display
// metadata the prepared rows carry, in deterministic order
// (position_number ASC, id ASC as tie-break).
func loadPreparedPositions(ctx context.Context, tx pgx.Tx, tenderID string) ([]calc.PreparedPositionInput, error) {
	rows, err := tx.Query(ctx, `
		SELECT id::text, position_number, section_number, COALESCE(position_name, ''),
		       item_no, COALESCE(work_name, ''), volume, manual_volume,
		       COALESCE(unit_code, ''), manual_note,
		       COALESCE(is_additional, false), parent_position_id::text,
		       COALESCE(hierarchy_level, 0)
		FROM public.client_positions
		WHERE tender_id = $1::uuid
		ORDER BY position_number ASC, id ASC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("loadPreparedPositions: %w", err)
	}
	defer rows.Close()
	out := make([]calc.PreparedPositionInput, 0)
	for rows.Next() {
		var p calc.PreparedPositionInput
		if err := rows.Scan(&p.ID, &p.PositionNumber, &p.SectionNumber, &p.PositionName,
			&p.ItemNo, &p.WorkName, &p.ClientVolume, &p.ManualVolume,
			&p.UnitCode, &p.ManualNote, &p.IsAdditional, &p.ParentPositionID,
			&p.HierarchyLevel); err != nil {
			return nil, fmt.Errorf("loadPreparedPositions scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// loadInsuranceInput loads the tender's insurance row (nil when absent).
//
// distribute_to_rows=false (флаг «Распределить во все строки», merge c11af3a/
// c50fb65) гейтит ТОЛЬКО per-row разнос страхования в prepared-пайплайне —
// возвращаем nil, как будто страховки нет. Слагаемое страхования в итоге ФП /
// cached_grand_total идёт отдельным путём (tender_recalc.go) и от флага не
// зависит.
func loadInsuranceInput(ctx context.Context, tx pgx.Tx, tenderID string) (*calc.InsuranceInput, error) {
	var in calc.InsuranceInput
	var distributeToRows bool
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(judicial_pct, 0), COALESCE(total_pct, 0),
		       COALESCE(apt_price_m2, 0), COALESCE(apt_area, 0),
		       COALESCE(parking_price_m2, 0), COALESCE(parking_area, 0),
		       COALESCE(storage_price_m2, 0), COALESCE(storage_area, 0),
		       COALESCE(distribute_to_rows, true)
		FROM public.tender_insurance
		WHERE tender_id = $1::uuid
		LIMIT 1
	`, tenderID).Scan(&in.JudicialPct, &in.TotalPct,
		&in.AptPriceM2, &in.AptArea,
		&in.ParkingPriceM2, &in.ParkingArea,
		&in.StoragePriceM2, &in.StorageArea,
		&distributeToRows)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("loadInsuranceInput: %w", err)
	}
	if !distributeToRows {
		return nil, nil
	}
	return &in, nil
}

// buildPreparedTx assembles the pipeline input from server-side data already
// scoped to the tender and runs the ONE authoritative calc boundary.
func buildPreparedTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID string,
	items []calc.BoqItemWithCosts,
	categoryResults []calc.RedistributionResult,
	adjustments []calc.PositionAdjustmentRuleInput,
) (*calc.PreparedRedistribution, error) {
	positions, err := loadPreparedPositions(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}
	insurance, err := loadInsuranceInput(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}
	return calc.BuildPreparedRedistribution(calc.PreparedRedistributionInput{
		Positions:           positions,
		BoqItems:            items,
		CategoryResults:     categoryResults,
		PositionAdjustments: adjustments,
		Insurance:           insurance,
	})
}
