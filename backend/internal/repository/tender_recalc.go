package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Stage 0.1.2.4a: transaction-aware orchestration of tenders.cached_grand_total.
// The FORMULA lives ONLY in calc.CalculateCachedTenderGrandTotal (insurance —
// calc.CalculateInsuranceTotal); SQL here does nothing financial: one aggregate
// read over boq_items, one insurance read, one exact write of the
// server-calculated result. No SQL ROUND, no SQL insurance expression, no
// PL/pgSQL twin (public.recalculate_tender_grand_total is a fail-closed
// tombstone), no per-row triggers.

// CachedGrandTotalTenderNotFoundError — the UPDATE matched no tender row.
type CachedGrandTotalTenderNotFoundError struct {
	TenderID string
}

func (e *CachedGrandTotalTenderNotFoundError) Error() string {
	return "CACHED_GRAND_TOTAL_TENDER_NOT_FOUND: " + e.TenderID
}

// CachedGrandTotalWriteMismatchError — the exact-write invariant failed
// (RowsAffected != 1).
type CachedGrandTotalWriteMismatchError struct {
	TenderID string
	Updated  int64
}

func (e *CachedGrandTotalWriteMismatchError) Error() string {
	return fmt.Sprintf("CACHED_GRAND_TOTAL_WRITE_MISMATCH: tender %s, updated %d rows (want 1)", e.TenderID, e.Updated)
}

// RecalculateTenderGrandTotalTx recomputes and persists cached_grand_total for
// ONE tender inside the caller's transaction (or any Querier boundary):
//
//  1. aggregate the tender's materialized commercial totals (ONE query,
//     material and work summed separately — no per-BOQ loop);
//  2. load the insurance row and compute the total via
//     calc.CalculateInsuranceTotal (never an SQL expression);
//  3. compute the final value via calc.CalculateCachedTenderGrandTotal
//     (validation + single rounding);
//  4. write the ready-made number (no ROUND in SQL) and verify RowsAffected==1.
//
// Fail-closed: any malformed aggregate/insurance input is a typed error and
// the UPDATE never runs; the caller's transaction owns commit/rollback.
func RecalculateTenderGrandTotalTx(
	ctx context.Context,
	q Querier,
	tenderID string,
) (*calc.CachedTenderGrandTotalResult, error) {
	if tenderID == "" {
		return nil, &CachedGrandTotalTenderNotFoundError{TenderID: tenderID}
	}

	// 1. Aggregated materialized commercial totals (material / work separately).
	var materialTotal, workTotal float64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(COALESCE(total_commercial_material_cost, 0)), 0),
		       COALESCE(SUM(COALESCE(total_commercial_work_cost, 0)), 0)
		FROM public.boq_items
		WHERE tender_id = $1::uuid
	`, tenderID).Scan(&materialTotal, &workTotal)
	if err != nil {
		return nil, fmt.Errorf("recalcTenderGrandTotalTx: aggregate: %w", err)
	}

	// 2. Insurance configuration → calc kernel (shared with the prepared
	//    pipeline; the formula is NOT duplicated here or in SQL).
	var ins calc.InsuranceInput
	haveInsurance := true
	err = q.QueryRow(ctx, `
		SELECT COALESCE(judicial_pct, 0), COALESCE(total_pct, 0),
		       COALESCE(apt_price_m2, 0), COALESCE(apt_area, 0),
		       COALESCE(parking_price_m2, 0), COALESCE(parking_area, 0),
		       COALESCE(storage_price_m2, 0), COALESCE(storage_area, 0)
		FROM public.tender_insurance
		WHERE tender_id = $1::uuid
		LIMIT 1
	`, tenderID).Scan(&ins.JudicialPct, &ins.TotalPct,
		&ins.AptPriceM2, &ins.AptArea,
		&ins.ParkingPriceM2, &ins.ParkingArea,
		&ins.StoragePriceM2, &ins.StorageArea)
	if err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("recalcTenderGrandTotalTx: insurance: %w", err)
		}
		haveInsurance = false
	}
	var insurancePtr *calc.InsuranceInput
	if haveInsurance {
		insurancePtr = &ins
	}
	insuranceTotal, err := calc.CalculateInsuranceTotal(insurancePtr)
	if err != nil {
		// Materialized configuration is broken — fail closed, never write 0.
		return nil, fmt.Errorf("recalcTenderGrandTotalTx: tender %s: %w", tenderID, err)
	}

	// 3. The ONE formula.
	result, err := calc.CalculateCachedTenderGrandTotal(calc.CachedTenderGrandTotalInput{
		CommercialMaterialTotal: materialTotal,
		CommercialWorkTotal:     workTotal,
		InsuranceTotal:          insuranceTotal,
	})
	if err != nil {
		return nil, fmt.Errorf("recalcTenderGrandTotalTx: tender %s: %w", tenderID, err)
	}

	// 4. Exact write of the server-calculated number.
	tag, err := q.Exec(ctx, `
		UPDATE public.tenders
		SET cached_grand_total = $1
		WHERE id = $2::uuid
	`, result.RoundedTotal, tenderID)
	if err != nil {
		return nil, fmt.Errorf("recalcTenderGrandTotalTx: update: %w", err)
	}
	switch tag.RowsAffected() {
	case 1:
		return result, nil
	case 0:
		return nil, &CachedGrandTotalTenderNotFoundError{TenderID: tenderID}
	default:
		return nil, &CachedGrandTotalWriteMismatchError{TenderID: tenderID, Updated: tag.RowsAffected()}
	}
}
