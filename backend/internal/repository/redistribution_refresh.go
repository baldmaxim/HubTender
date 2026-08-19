package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/calc"
)

// RefreshRedistributionSnapshotTx re-applies the tender's ALREADY SAVED
// redistribution rules to the commercial values this transaction has just
// materialized, and re-stamps the snapshot with `revision`.
//
// Why it exists: every financial input change (markup percentages, markup
// tactic/constructor, FX, BOQ edits) bumps financial_input_revision. Without
// this step the persisted snapshot keeps the OLD revision marker forever, so
// LoadResults degrades it to requires_recalculation / INPUT_REVISION_CHANGED
// and Commerce, «Финансовые показатели» and every final export stay blocked
// until a human opens the «Перераспределение» page and re-saves.
//
// Cost policy (the snapshot rewrite is the expensive part of a recalc):
//
//   - tenders WITHOUT a snapshot pay one indexed lookup and return early;
//   - a snapshot already stamped with `revision` returns early;
//   - an unchanged result set is re-stamped with a single UPDATE instead of
//     DELETE + N INSERT (see persistRedistributionSnapshotTx).
//
// Fail-SOFT by design: the commercial recalc must never fail because saved
// rules no longer validate against the new state (e.g. a position adjustment
// that now exceeds its source). The rebuild runs inside a SAVEPOINT; on any
// calculation/validation error the savepoint rolls back, the snapshot keeps its
// old revision marker — exactly the pre-existing requires_recalculation
// behaviour — and the recalc continues. Only infrastructure errors propagate.
//
// Returns true when the snapshot was refreshed for `revision`.
func RefreshRedistributionSnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID string,
	revision int64,
) (bool, error) {
	var tacticID *string
	if err := tx.QueryRow(ctx,
		`SELECT markup_tactic_id::text FROM public.tenders WHERE id = $1::uuid`, tenderID,
	).Scan(&tacticID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("refreshRedistributionSnapshotTx: tender: %w", err)
	}
	if tacticID == nil || *tacticID == "" {
		return false, nil // no active tactic → no snapshot to maintain
	}

	// The cheap gate: one lookup on idx_redistribution_tender_tactic. Most
	// tenders have no redistribution configured and stop here.
	var rawRules []byte
	var createdBy *string
	err := tx.QueryRow(ctx, `
		SELECT redistribution_rules, created_by::text
		FROM public.cost_redistribution_results
		WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid
		  AND redistribution_rules IS NOT NULL
		ORDER BY created_at ASC
		LIMIT 1
	`, tenderID, *tacticID).Scan(&rawRules, &createdBy)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil // not_configured (or a legacy set without a holder)
		}
		return false, fmt.Errorf("refreshRedistributionSnapshotTx: rules: %w", err)
	}
	if len(rawRules) == 0 {
		return false, nil
	}

	var meta rulesServerMetadata
	if err := json.Unmarshal(rawRules, &meta); err != nil {
		return false, nil // unparseable → legacy, left to the manual recalc
	}
	if meta.SchemaVersion < calc.RedistributionSchemaVersion ||
		meta.CalculationSource != calc.RedistributionCalculationServer {
		// A pre-0.1.2.3a client-calculated snapshot is NOT silently promoted to
		// a server one: LEGACY_SNAPSHOT stays until a human re-saves.
		return false, nil
	}
	if meta.FinancialInputRevision != nil && *meta.FinancialInputRevision == revision {
		return false, nil // already current for this revision
	}

	var rules calc.RedistributionRulesInput
	if err := json.Unmarshal(rawRules, &rules); err != nil {
		return false, nil
	}
	// Legacy single-operation form, mirrored from LoadResults.
	if rules.LegacyPositionAdjustment != nil && len(rules.PositionAdjustments) == 0 &&
		rules.LegacyPositionAdjustment.Amount > 0 {
		rules.PositionAdjustments = []calc.PositionAdjustmentRuleInput{*rules.LegacyPositionAdjustment}
	}

	owner := ""
	if createdBy != nil {
		owner = *createdBy
	}

	// SAVEPOINT: a rules/calculation failure must not abort the commercial
	// recalc that already succeeded above.
	sp, err := tx.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("refreshRedistributionSnapshotTx: savepoint: %w", err)
	}
	built, err := rebuildRedistributionSnapshotTx(ctx, sp, tenderID, *tacticID, rules, owner, revision)
	if err != nil {
		if rbErr := sp.Rollback(ctx); rbErr != nil {
			return false, fmt.Errorf("refreshRedistributionSnapshotTx: rollback: %w (cause: %v)", rbErr, err)
		}
		// A REPEATABLE READ write conflict is NOT a rules problem: it means the
		// inputs moved on and this whole calculation is stale. Propagate it so
		// the recalc rolls back and re-enqueues the latest revision instead of
		// logging a misleading "rules no longer apply".
		if isSerializationFailure(err) {
			return false, err
		}
		log.Warn().Err(err).
			Str("tender_id", tenderID).
			Str("markup_tactic_id", *tacticID).
			Int64("input_revision", revision).
			Msg("saved redistribution rules no longer apply — snapshot left as requires_recalculation")
		return false, nil
	}
	if err := sp.Commit(ctx); err != nil {
		return false, fmt.Errorf("refreshRedistributionSnapshotTx: release savepoint: %w", err)
	}

	log.Debug().
		Str("tender_id", tenderID).
		Int64("input_revision", revision).
		Int("rows", len(built.Results)).
		Bool("rewritten", built.Rewritten).
		Msg("redistribution snapshot refreshed by the authoritative recalc")
	return true, nil
}
