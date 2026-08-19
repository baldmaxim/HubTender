package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// financialPatchDiff reports which financial inputs a tender patch ACTUALLY
// moves, as opposed to which ones it merely mentions.
type financialPatchDiff struct {
	RatesChanged  bool
	TacticChanged bool
}

// Any reports whether the patch moves any financial input at all.
func (d financialPatchDiff) Any() bool { return d.RatesChanged || d.TacticChanged }

// diffFinancialInputsTx compares the SUBMITTED currency rates / markup tactic
// against what is stored and reports only the genuine differences.
//
// Why this exists: the financial write path is expensive and destructive —
// MarkTenderFinancialInputsChangedTx bumps the revision and REVOKES an active
// financial approval, and repriceTenderAfterRateChangeTx recomputes every BOQ
// row, position total and commercial value of the tender in the same
// transaction. Deciding to run all of that from the mere PRESENCE of a rate
// field in the JSON body is wrong: the admin tender modal re-submits every
// form field on every save, so an untouched tender name edit used to trigger a
// full reprice (tens of seconds → browser fetch abort → whole edit rolled
// back) and silently invalidate the «Финансовые показатели» approval.
//
// The row is locked FOR UPDATE so the decision and the write that follows it
// are atomic against a concurrent financial mutation: nobody can change the
// rate between "unchanged" being observed here and the patch being applied.
//
// Comparison happens in SQL on the numeric column, so 90.5 and 90.50 compare
// equal, and the float64 → numeric conversion is the same one the UPDATE
// itself uses for the parameter — a value that compares equal here is a value
// the UPDATE would write back unchanged.
//
// A missing tender reports no change (pgx.ErrNoRows is swallowed): the caller's
// UPDATE ... WHERE id = ... then matches no row, preserving the previous
// no-such-tender behaviour of both write paths.
func diffFinancialInputsTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID string,
	usd, eur, cny *float64,
	tacticID *string,
) (financialPatchDiff, error) {
	var d financialPatchDiff
	err := tx.QueryRow(ctx, `
		SELECT
		    ($2::numeric IS NOT NULL AND usd_rate IS DISTINCT FROM $2::numeric)
		 OR ($3::numeric IS NOT NULL AND eur_rate IS DISTINCT FROM $3::numeric)
		 OR ($4::numeric IS NOT NULL AND cny_rate IS DISTINCT FROM $4::numeric),
		    ($5::uuid IS NOT NULL AND markup_tactic_id IS DISTINCT FROM $5::uuid)
		FROM public.tenders
		WHERE id = $1::uuid
		FOR UPDATE
	`, tenderID, usd, eur, cny, tacticID).Scan(&d.RatesChanged, &d.TacticChanged)
	if errors.Is(err, pgx.ErrNoRows) {
		return financialPatchDiff{}, nil
	}
	if err != nil {
		return financialPatchDiff{}, fmt.Errorf("diffFinancialInputsTx: %w", err)
	}
	return d, nil
}
