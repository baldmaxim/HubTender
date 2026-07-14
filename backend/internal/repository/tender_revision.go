package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

// Stage 0-F2: the minimal financial-revision model.
//
// State machine (public.tenders):
//
//	financial_input_revision        — +1 per USER financial command (never per
//	                                  batch row); bumped by the ONE central
//	                                  helper below, in the same tx as the input
//	                                  change, BEFORE the change itself.
//	financial_calculation_revision  — the input revision the last successful
//	                                  authoritative calculation was built for.
//	financial_calculation_status    — calculated | stale | calculating | failed.
//
//	    mark inputs changed             CAS success (rev == input_rev)
//	calculated ────────────▶ stale ────────────▶ calculated
//	    ▲                      │  claim (indicative)      ▲
//	    │                      ▼                           │
//	    └──────── failed ◀── calculating ──────────────────┘
//	              (only if rev is still current)
//
// Invariants:
//   - an OLD calculation can never mark NEW inputs as calculated: the success
//     UPDATE is a compare-and-set on financial_input_revision;
//   - marking inputs changed also invalidates the financial approval — a
//     stale approval boolean must never survive a financial mutation;
//   - calculation_revision <= input_revision is enforced by a DB CHECK.

// StaleCalculationResultError — a background calculation finished for inputs
// that changed while it ran. The whole derived-write transaction MUST roll
// back; the latest revision is re-enqueued. Not a user-facing error.
type StaleCalculationResultError struct {
	TenderID           string
	CalculatedRevision int64
}

func (e *StaleCalculationResultError) Error() string {
	return fmt.Sprintf("STALE_CALCULATION_RESULT: tender %s, calculated revision %d is no longer current",
		e.TenderID, e.CalculatedRevision)
}

// Code returns the stable machine-readable code (logs/metrics).
func (e *StaleCalculationResultError) Code() string { return "STALE_CALCULATION_RESULT" }

// FinancialCalculationNotReadyError — the tender's financial calculation is
// not current (stale/calculating/failed or revision mismatch), so approval /
// final export is refused. Maps to RFC 7807 409 FINANCIAL_CALCULATION_NOT_READY.
type FinancialCalculationNotReadyError struct {
	TenderID            string
	CalculationStatus   string
	InputRevision       int64
	CalculationRevision int64
	Reason              string // CALCULATION_STALE | CALCULATION_RUNNING | CALCULATION_FAILED | REVISION_MISMATCH | REDISTRIBUTION_STALE
}

func (e *FinancialCalculationNotReadyError) Error() string {
	return fmt.Sprintf("FINANCIAL_CALCULATION_NOT_READY: tender %s: %s (status=%s, input_rev=%d, calc_rev=%d)",
		e.TenderID, e.Reason, e.CalculationStatus, e.InputRevision, e.CalculationRevision)
}

// Code returns the stable machine-readable code.
func (e *FinancialCalculationNotReadyError) Code() string { return "FINANCIAL_CALCULATION_NOT_READY" }

// MarkTenderFinancialInputsChangedTx is the ONE way a financial input change
// is recorded. Call it inside the mutation's transaction BEFORE changing the
// data. In a single UPDATE it:
//
//  1. bumps financial_input_revision by exactly 1 (one USER command = one
//     bump — batch loops must not call this per row);
//  2. sets financial_calculation_status = 'stale';
//  3. clears the calculation error and started_at;
//  4. invalidates the current financial approval (approved=false, by/at=NULL) —
//     the approval history/audit trail, where one exists, is not touched.
//
// Returns the NEW input revision. RowsAffected must be exactly 1 (unknown
// tender → typed not-found error).
func MarkTenderFinancialInputsChangedTx(
	ctx context.Context,
	q Querier,
	tenderID string,
	reason string,
) (int64, error) {
	if tenderID == "" {
		return 0, &CachedGrandTotalTenderNotFoundError{TenderID: tenderID}
	}
	var newRev int64
	var wasApproved bool
	// The self-join exposes the PRE-update row ("old"), so the RETURNING can
	// report whether an ACTIVE approval was just invalidated (audit log).
	err := q.QueryRow(ctx, `
		UPDATE public.tenders t
		SET financial_input_revision            = t.financial_input_revision + 1,
		    financial_calculation_status        = 'stale',
		    financial_calculation_error_code    = NULL,
		    financial_calculation_error_message = NULL,
		    financial_calculation_started_at    = NULL,
		    financial_approved                  = false,
		    financial_approved_by               = NULL,
		    financial_approved_at               = NULL
		FROM public.tenders old
		WHERE t.id = $1::uuid AND old.id = t.id
		RETURNING t.financial_input_revision, old.financial_approved
	`, tenderID).Scan(&newRev, &wasApproved)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return 0, &CachedGrandTotalTenderNotFoundError{TenderID: tenderID}
		}
		return 0, fmt.Errorf("markTenderFinancialInputsChangedTx: %w", err)
	}
	if wasApproved {
		// Minimal invalidation record via the existing structured-log audit
		// stream (no tender-level audit table exists; schema is not extended).
		log.Info().Str("tender_id", tenderID).Int64("input_revision", newRev).
			Str("reason", reason).Msg("ACTIVE financial approval invalidated by a financial input change")
	}
	log.Debug().Str("tender_id", tenderID).Int64("input_revision", newRev).
		Str("reason", reason).Msg("financial inputs changed → stale")
	return newRev, nil
}

// MarkTenderCalculationSucceededTx finishes an authoritative calculation with
// a COMPARE-AND-SET on the input revision: the UPDATE applies ONLY while
// financial_input_revision == calculatedRevision. If inputs moved on while
// the calculation ran, it returns StaleCalculationResultError and the caller
// MUST roll back every derived write of that calculation.
func MarkTenderCalculationSucceededTx(
	ctx context.Context,
	q Querier,
	tenderID string,
	calculatedRevision int64,
) error {
	tag, err := q.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_revision      = $2,
		    financial_calculation_status        = 'calculated',
		    financial_calculated_at             = NOW(),
		    financial_calculation_started_at    = NULL,
		    financial_calculation_error_code    = NULL,
		    financial_calculation_error_message = NULL
		WHERE id = $1::uuid
		  AND financial_input_revision = $2
	`, tenderID, calculatedRevision)
	if err != nil {
		return fmt.Errorf("markTenderCalculationSucceededTx: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return &StaleCalculationResultError{TenderID: tenderID, CalculatedRevision: calculatedRevision}
	}
	return nil
}

// MarkTenderCalculationFailedIfCurrent records a FAILED calculation in its own
// short transaction (call it AFTER the calculation tx rolled back). The status
// flips to 'failed' only while the failed revision is still the current input
// revision; if the inputs already changed, the tender stays 'stale' and the
// newer revision's own calculation decides its fate.
//
// safeMessage must be a short human-readable cause — never a stack trace or
// raw SQL.
func MarkTenderCalculationFailedIfCurrent(
	ctx context.Context,
	q Querier,
	tenderID string,
	calculatedRevision int64,
	code string,
	safeMessage string,
) error {
	tag, err := q.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_status        = 'failed',
		    financial_calculation_error_code    = $3,
		    financial_calculation_error_message = $4,
		    financial_calculation_started_at    = NULL
		WHERE id = $1::uuid
		  AND financial_input_revision = $2
	`, tenderID, calculatedRevision, code, safeMessage)
	if err != nil {
		return fmt.Errorf("markTenderCalculationFailedIfCurrent: %w", err)
	}
	if tag.RowsAffected() == 0 {
		log.Info().Str("tender_id", tenderID).Int64("failed_revision", calculatedRevision).
			Msg("calculation failure for an already-superseded revision — tender stays stale")
	}
	return nil
}

// ClaimTenderCalculationIndicative flips the status to 'calculating' for UI
// visibility. Purely indicative: SERIALIZATION is provided by the advisory
// transaction lock inside the calculation tx, not by this status, so a claim
// left behind by a crashed process never blocks anything — the next
// mutation marks 'stale', the next successful CAS marks 'calculated'.
func ClaimTenderCalculationIndicative(ctx context.Context, q Querier, tenderID string, revision int64) {
	if _, err := q.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_status     = 'calculating',
		    financial_calculation_started_at = NOW()
		WHERE id = $1::uuid
		  AND financial_input_revision = $2
		  AND financial_calculation_status IN ('stale', 'failed')
	`, tenderID, revision); err != nil {
		log.Warn().Err(err).Str("tender_id", tenderID).Msg("indicative calculating claim failed")
	}
}

// tenderRecalcAdvisoryLockClass namespaces the per-tender advisory lock used
// to serialize authoritative recalcs across application processes. It is a
// SESSION lock held on a dedicated pooled connection for the duration of the
// calculation (see recalcTenderCommercialTx) — released explicitly and, on
// any failure/crash, by the server when the connection dies.
const tenderRecalcAdvisoryLockClass = 42001

// WithTenderFinancialMutationTx runs a category-A financial input mutation in
// ONE transaction: revision bump + stale marker + approval invalidation FIRST,
// then the mutation itself. The caller enqueues the async recalc AFTER commit.
// Exactly one bump per user command — fn must not bump again per row.
func WithTenderFinancialMutationTx(
	ctx context.Context,
	pool *pgxpool.Pool,
	tenderID string,
	reason string,
	fn func(tx pgx.Tx) error,
) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("withTenderFinancialMutationTx: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, tx, tenderID, reason); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("withTenderFinancialMutationTx: commit: %w", err)
	}
	return nil
}

// ReadTenderFinancialRevisionTx reads the tender's revision/status inside the
// caller's transaction (the calculation snapshot).
func ReadTenderFinancialRevisionTx(ctx context.Context, q Querier, tenderID string) (inputRev, calcRev int64, status string, err error) {
	err = q.QueryRow(ctx, `
		SELECT financial_input_revision, financial_calculation_revision, financial_calculation_status
		FROM public.tenders WHERE id = $1::uuid
	`, tenderID).Scan(&inputRev, &calcRev, &status)
	if err != nil {
		err = fmt.Errorf("readTenderFinancialRevisionTx: %w", err)
	}
	return
}
