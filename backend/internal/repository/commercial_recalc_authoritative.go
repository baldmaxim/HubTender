package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CommercialRecalcOutcome describes how an authoritative background recalc
// finished. Only "calculated" changed anything.
type CommercialRecalcOutcome string

const (
	// RecalcOutcomeCalculated — derived values written and the revision CAS
	// succeeded: calculation_revision == input_revision, status = calculated.
	RecalcOutcomeCalculated CommercialRecalcOutcome = "calculated"
	// RecalcOutcomeNoOp — the tender was already calculated for the current
	// input revision; nothing was read or written beyond the status row.
	RecalcOutcomeNoOp CommercialRecalcOutcome = "no_op"
	// RecalcOutcomeStaleRequeue — inputs changed while the calculation ran;
	// every derived write of this run rolled back and the caller must enqueue
	// the latest revision. Not a user-facing failure.
	RecalcOutcomeStaleRequeue CommercialRecalcOutcome = "stale_requeue"
)

// RecalcTenderCommercialAuthoritative is the stage 0-F2 background recalc:
//
//  1. cheap pre-check + indicative 'calculating' claim (UI only);
//  2. ONE REPEATABLE READ transaction:
//     a. pg_advisory_xact_lock(tender) — cross-process serialization; the
//     lock dies with the connection, so a crash never wedges the tender;
//     b. read input/calculation revision in the tx snapshot → fix
//     calculatedRevision; no-op if already calculated for it;
//     c. compute commercial rows from the SAME snapshot, persist changed
//     rows via the internal writer, refresh cached_grand_total;
//     d. MarkTenderCalculationSucceededTx — CAS on input revision;
//  3. a CAS miss (or a REPEATABLE READ serialization conflict caused by a
//     concurrent input change) rolls back EVERY derived write of this run
//     and reports stale_requeue — the OLD result can never beat NEW inputs;
//  4. any other failure rolls back and marks 'failed' — but only while the
//     failed revision is still current (MarkTenderCalculationFailedIfCurrent).
func RecalcTenderCommercialAuthoritative(
	ctx context.Context,
	pool *pgxpool.Pool,
	tenderID string,
) (CommercialRecalcOutcome, error) {
	// Cheap pre-check outside the tx: skip the whole pipeline when nothing
	// changed since the last successful calculation.
	inputRev, calcRev, status, err := ReadTenderFinancialRevisionTx(ctx, pool, tenderID)
	if err != nil {
		return "", err
	}
	if status == "calculated" && calcRev == inputRev {
		return RecalcOutcomeNoOp, nil
	}
	ClaimTenderCalculationIndicative(ctx, pool, tenderID, inputRev)

	outcome, calculatedRevision, err := recalcTenderCommercialTx(ctx, pool, tenderID)
	if err == nil {
		return outcome, nil
	}

	// Stale result (CAS miss or snapshot conflict): everything rolled back —
	// requeue the latest revision, do not mark failed.
	var stale *StaleCalculationResultError
	if errors.As(err, &stale) || isSerializationFailure(err) {
		return RecalcOutcomeStaleRequeue, &StaleCalculationResultError{
			TenderID: tenderID, CalculatedRevision: calculatedRevision}
	}

	// Real failure of the CURRENT revision → short own-tx failed marker with a
	// safe code/message (never a stack trace or SQL text).
	code, safeMsg := classifyRecalcFailure(err)
	if markErr := MarkTenderCalculationFailedIfCurrent(ctx, pool, tenderID, calculatedRevision, code, safeMsg); markErr != nil {
		return "", fmt.Errorf("recalcTenderCommercialAuthoritative: %w (mark failed: %v)", err, markErr)
	}
	return "", fmt.Errorf("recalcTenderCommercialAuthoritative: %w", err)
}

// recalcTenderCommercialTx runs the single REPEATABLE READ calculation
// transaction and returns the revision it calculated for.
//
// The per-tender advisory lock is a SESSION lock on a dedicated pooled
// connection, acquired BEFORE the transaction starts. Order matters: a
// REPEATABLE READ snapshot is fixed by the first statement, so taking the
// lock inside the tx would freeze a PRE-lock snapshot — the second of two
// queued jobs would then recalculate against stale data and bounce off the
// CAS instead of cleanly no-opping. With lock-then-begin, the job that waited
// sees the fresh revision and no-ops. The lock dies with the connection, so a
// crashed process can never wedge the tender.
func recalcTenderCommercialTx(
	ctx context.Context,
	pool *pgxpool.Pool,
	tenderID string,
) (CommercialRecalcOutcome, int64, error) {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return "", 0, fmt.Errorf("recalcTenderCommercialTx: acquire conn: %w", err)
	}
	if _, err := conn.Exec(ctx,
		`SELECT pg_advisory_lock($1, hashtext($2))`,
		tenderRecalcAdvisoryLockClass, tenderID); err != nil {
		conn.Release()
		return "", 0, fmt.Errorf("recalcTenderCommercialTx: advisory lock: %w", err)
	}
	defer func() {
		// Always unlock before the connection returns to the pool; on unlock
		// failure destroy the connection so the server frees the lock.
		if _, uerr := conn.Exec(context.WithoutCancel(ctx),
			`SELECT pg_advisory_unlock($1, hashtext($2))`,
			tenderRecalcAdvisoryLockClass, tenderID); uerr != nil {
			_ = conn.Conn().Close(context.WithoutCancel(ctx))
		}
		conn.Release()
	}()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead})
	if err != nil {
		return "", 0, fmt.Errorf("recalcTenderCommercialTx: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// The claim: fix the revision this calculation is built for, from the tx
	// snapshot the inputs will also be read from (fresh — the lock is already
	// held, so no committed writer can be mid-flight for this tender).
	inputRev, calcRev, status, err := ReadTenderFinancialRevisionTx(ctx, tx, tenderID)
	if err != nil {
		return "", 0, err
	}
	if status == "calculated" && calcRev == inputRev {
		return RecalcOutcomeNoOp, inputRev, nil // second queued job after the first → no-op
	}
	calculatedRevision := inputRev

	// Compute from the SAME consistent snapshot the revision was read in.
	computed, err := ComputeCommercialRows(ctx, tx, tenderID)
	if err != nil {
		return "", calculatedRevision, fmt.Errorf("recalcTenderCommercialTx: compute: %w", err)
	}
	changed := ChangedCommercialRows(computed)
	if len(changed) > 0 {
		if _, err := PersistCalculatedCommercialCostsTx(ctx, tx, tenderID, changed); err != nil {
			return "", calculatedRevision, err
		}
	}
	if _, err := RecalculateTenderGrandTotalTx(ctx, tx, tenderID); err != nil {
		return "", calculatedRevision, err
	}

	// CAS: succeed ONLY if the inputs did not move on. A concurrent input
	// change surfaces either as RowsAffected==0 (StaleCalculationResultError)
	// or as SQLSTATE 40001 on this UPDATE under REPEATABLE READ — both roll
	// back every derived write above.
	if err := MarkTenderCalculationSucceededTx(ctx, tx, tenderID, calculatedRevision); err != nil {
		return "", calculatedRevision, err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", calculatedRevision, fmt.Errorf("recalcTenderCommercialTx: commit: %w", err)
	}
	return RecalcOutcomeCalculated, calculatedRevision, nil
}

// isSerializationFailure recognizes SQLSTATE 40001 (REPEATABLE READ write
// conflict) — the DB-level twin of a CAS miss.
func isSerializationFailure(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "40001"
}

// classifyRecalcFailure maps a calculation error onto a SAFE user-visible
// code/message pair (no stack traces, no SQL).
func classifyRecalcFailure(err error) (code, safeMessage string) {
	type coded interface{ Code() string }
	var c coded
	if errors.As(err, &c) {
		return c.Code(), "Расчёт коммерческих стоимостей завершился ошибкой конфигурации"
	}
	return "COMMERCIAL_RECALC_FAILED", "Не удалось выполнить пересчёт — проверьте входные данные тендера"
}
