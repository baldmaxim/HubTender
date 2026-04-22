package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// RecalculateTenderGrandTotal replicates the PL/pgSQL
// public.recalculate_tender_grand_total(p_tender_id) function.
// It must be called inside an existing transaction (tx), never with a bare
// pool — the caller owns commit/rollback.
//
// Math (verbatim from lines 1386-1421 of 00000000000005_baseline_functions.sql):
//
//  1. boqTotal  = COALESCE(SUM(total_commercial_material_cost + total_commercial_work_cost), 0)
//     over boq_items WHERE tender_id = p_tender_id
//  2. insurance = COALESCE(
//     (apt_price_m2*apt_area + parking_price_m2*parking_area + storage_price_m2*storage_area)
//     * (judicial_pct/100) * (total_pct/100), 0)
//     from tender_insurance WHERE tender_id = p_tender_id LIMIT 1
//  3. UPDATE tenders SET cached_grand_total = ROUND(boqTotal + insurance, 2)
func RecalculateTenderGrandTotal(ctx context.Context, tx pgx.Tx, tenderID string) error {
	// Step 1 — commercial BOQ total.
	var boqTotal float64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(SUM(
			COALESCE(total_commercial_material_cost,0) +
			COALESCE(total_commercial_work_cost,0)
		), 0)
		FROM public.boq_items
		WHERE tender_id = $1
	`, tenderID).Scan(&boqTotal)
	if err != nil {
		return fmt.Errorf("recalcTenderGrandTotal: boq sum: %w", err)
	}

	// Step 2 — insurance amount (may be absent → zero).
	var insurance float64
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(
			(apt_price_m2 * apt_area + parking_price_m2 * parking_area + storage_price_m2 * storage_area)
			* (judicial_pct / 100.0)
			* (total_pct   / 100.0),
		0)
		FROM public.tender_insurance
		WHERE tender_id = $1
		LIMIT 1
	`, tenderID).Scan(&insurance)
	// pgx.ErrNoRows means no insurance row — use 0.
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("recalcTenderGrandTotal: insurance: %w", err)
	}

	// Step 3 — write ROUND(total, 2).
	_, err = tx.Exec(ctx, `
		UPDATE public.tenders
		SET cached_grand_total = ROUND($1::numeric, 2)
		WHERE id = $2
	`, boqTotal+insurance, tenderID)
	if err != nil {
		return fmt.Errorf("recalcTenderGrandTotal: update: %w", err)
	}

	return nil
}
