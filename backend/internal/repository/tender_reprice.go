package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Stage 0-F1: an INTERACTIVE currency-rate change may never leave BOQ rows,
// position totals, commercial values or cached_grand_total computed with the
// OLD rates. Every rate-changing write path (regular tender PATCH and the
// admin patch) therefore runs this pipeline inside ONE transaction:
//
//	UPDATE rates
//	→ RecomputeBoqTotalAmountsTx    (all tender rows, calc kernel, rates loaded once)
//	→ RecomputePositionTotalsForTenderTx
//	→ MaterializeCommercialForTenderTx (authoritative calc → internal writer)
//	→ RecalculateTenderGrandTotalTx
//	→ COMMIT
//
// Fail-closed: if the NEW rates make any existing row uncalculable
// (calc.MissingFXRateError — e.g. the tender has USD rows and usd_rate was
// zeroed), the WHOLE transaction rolls back: old rates, old totals, old
// commercial values and the old cached grand total all survive; the caller
// returns an error, cache is NOT invalidated as success.
//
// The async recalc queue may still run afterwards as an idempotent extra pass,
// but it is NOT the mechanism that makes the values correct — the transaction is.
//
// Stage 0-F2 (category B): the caller marks the financial inputs changed
// (revision N) BEFORE the rate UPDATE; this pipeline performs the FULL
// calculation for revision N and finishes with the success CAS — after commit
// the tender is 'calculated' with calculation_revision == input_revision.
func repriceTenderAfterRateChangeTx(ctx context.Context, tx pgx.Tx, tenderID string, revision int64) error {
	// All BOQ rows of the tender (one query; batch recompute — no per-row FX).
	rows, err := tx.Query(ctx,
		`SELECT id::text FROM public.boq_items WHERE tender_id = $1::uuid`, tenderID)
	if err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: list items: %w", err)
	}
	var itemIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("repriceTenderAfterRateChangeTx: scan: %w", err)
		}
		itemIDs = append(itemIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: rows: %w", err)
	}

	// 1. total_amount from persisted inputs + NEW rates (fail-closed on FX).
	if _, err := RecomputeBoqTotalAmountsTx(ctx, tx, tenderID, itemIDs); err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: %w", err)
	}
	// 2. Position totals follow the new row totals.
	if err := RecomputePositionTotalsForTenderTx(ctx, tx, tenderID); err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: %w", err)
	}
	// 3. Commercial values from the NEW total_amount (authoritative calc +
	//    internal writer; never derived from the old totals).
	if err := MaterializeCommercialForTenderTx(ctx, tx, tenderID); err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: %w", err)
	}
	// 4. cached_grand_total exactly once, from the fresh commercial values.
	if _, err := RecalculateTenderGrandTotalTx(ctx, tx, tenderID); err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: %w", err)
	}
	// 5. Full sync calculation done for revision N → success CAS in the same tx.
	if err := MarkTenderCalculationSucceededTx(ctx, tx, tenderID, revision); err != nil {
		return fmt.Errorf("repriceTenderAfterRateChangeTx: %w", err)
	}
	return nil
}
