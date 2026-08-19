package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// ONE engine turning (current tender state + rules) into the persisted
// redistribution snapshot. Two callers go through it and there is deliberately
// no second implementation:
//
//   - RedistributionRepo.SaveAuthoritative — the user command from the
//     «Перераспределение» page (bumps the financial input revision itself);
//   - RefreshRedistributionSnapshotTx — the background authoritative recalc,
//     which re-applies the ALREADY SAVED rules to freshly materialized
//     commercial values, so a markup edit no longer leaves the snapshot stuck
//     in requires_recalculation until someone opens the page.
//
// Precondition for both: the caller has already materialized the tender's
// commercial values inside THIS transaction, and has decided which financial
// input revision the snapshot is stamped with.

// redistributionSnapshotEpsilon — two persisted money values closer than this
// are the same row (mirrors commercialEpsilon).
const redistributionSnapshotEpsilon = 1e-6

// redistributionRebuild is one authoritative rebuild, already persisted.
type redistributionRebuild struct {
	Results        []calc.RedistributionResult
	TotalDeducted  float64
	TotalAdded     float64
	IsBalanced     bool
	CanonicalJSON  []byte
	PositionDeltas map[string]float64
	Prepared       *calc.PreparedRedistribution
	// Rewritten is false when the computed set equalled the stored one and only
	// the revision marker had to be re-stamped — 1 UPDATE instead of
	// DELETE + N INSERT over six indexes and 2×N per-row pg_notify.
	Rewritten bool
}

// redistributionRefs is the DB-confirmed reference data the rules validation
// needs (canonical names + the effective category/position universe).
type redistributionRefs struct {
	categories       map[string]string
	details          map[string]string
	detailToCategory map[string]string
	positions        map[string]bool
}

// loadRedistributionRefs reads the category dictionaries (small, tender-wide)
// and the tender's position ids.
func loadRedistributionRefs(ctx context.Context, tx pgx.Tx, tenderID string) (*redistributionRefs, error) {
	refs := &redistributionRefs{
		details:          map[string]string{},
		detailToCategory: map[string]string{},
		positions:        map[string]bool{},
	}

	var err error
	refs.categories, err = loadNameMap(ctx, tx, `SELECT id::text, name FROM public.cost_categories`)
	if err != nil {
		return nil, fmt.Errorf("loadRedistributionRefs: categories: %w", err)
	}

	if err := func() error {
		rows, err := tx.Query(ctx,
			`SELECT id::text, name, cost_category_id::text FROM public.detail_cost_categories`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id, name, catID string
			if err := rows.Scan(&id, &name, &catID); err != nil {
				return err
			}
			refs.details[id] = name
			refs.detailToCategory[id] = catID
		}
		return rows.Err()
	}(); err != nil {
		return nil, fmt.Errorf("loadRedistributionRefs: details: %w", err)
	}

	if err := func() error {
		rows, err := tx.Query(ctx,
			`SELECT id::text FROM public.client_positions WHERE tender_id = $1::uuid`, tenderID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			refs.positions[id] = true
		}
		return rows.Err()
	}(); err != nil {
		return nil, fmt.Errorf("loadRedistributionRefs: positions: %w", err)
	}

	return refs, nil
}

// rebuildRedistributionSnapshotTx validates the rules against the tender's
// CURRENT state, runs the authoritative calculation + every invariant, builds
// the prepared projection through the same calc boundary the GET uses, and
// persists the complete server-generated set stamped with `revision`.
//
// Fail-closed: any error leaves it to the caller to roll back (a transaction
// for the user save, a savepoint for the background refresh).
func rebuildRedistributionSnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID, tacticID string,
	rules calc.RedistributionRulesInput,
	createdBy string,
	revision int64,
) (*redistributionRebuild, error) {
	refs, err := loadRedistributionRefs(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}

	// The FULL current BOQ set, deterministic order (id ASC).
	items, err := loadRedistributionBoq(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}
	if len(items) == 0 {
		return nil, &calc.RedistributionNoBoqItemsError{TenderID: tenderID}
	}

	norm, err := calc.ValidateAndNormalizeRedistributionRules(rules, calc.RedistributionValidationContext{
		KnownCategories:  refs.categories,
		KnownDetails:     refs.details,
		DetailToCategory: refs.detailToCategory,
		BoqItems:         items,
	})
	if err != nil {
		return nil, err
	}

	out := calc.CalculateRedistribution(items, norm.Sources, norm.Targets, refs.detailToCategory)
	if err := calc.ValidateRedistributionCalculation(items, out); err != nil {
		return nil, err
	}

	// Position rules on the server-generated base.
	base := calc.PositionWorksAfterRedistribution(items, out.Results)
	adjIssues, positionDeltas := calc.ValidatePositionAdjustments(norm.PositionAdjustments, base, refs.positions)
	if len(adjIssues) > 0 {
		return nil, &calc.InvalidRedistributionRulesError{Issues: adjIssues}
	}

	// The FULL prepared projection is built and validated BEFORE anything is
	// persisted — a prepared failure aborts the rebuild.
	prepared, err := buildPreparedTx(ctx, tx, tenderID, items, out.Results, norm.PositionAdjustments)
	if err != nil {
		return nil, fmt.Errorf("prepared: %w", err)
	}

	canonicalJSON, err := json.Marshal(norm.Canonical)
	if err != nil {
		return nil, fmt.Errorf("canonical rules: %w", err)
	}
	// 0-F2 §7: stamp the snapshot with the input revision it was built for.
	// Written ONLY here, i.e. only with a real server calculation.
	canonicalJSON, err = stampRulesInputRevision(canonicalJSON, revision)
	if err != nil {
		return nil, err
	}

	rewritten, err := persistRedistributionSnapshotTx(
		ctx, tx, tenderID, tacticID, out.Results, canonicalJSON, createdBy)
	if err != nil {
		return nil, err
	}

	return &redistributionRebuild{
		Results:        out.Results,
		TotalDeducted:  out.TotalDeducted,
		TotalAdded:     out.TotalAdded,
		IsBalanced:     out.IsBalanced,
		CanonicalJSON:  canonicalJSON,
		PositionDeltas: positionDeltas,
		Prepared:       prepared,
		Rewritten:      rewritten,
	}, nil
}

// storedRedistributionResults reads the persisted set in the SAME deterministic
// order the calculation produces (boq_item_id ASC == the BOQ's id ASC), plus
// whether the single rules-holder row is present.
func storedRedistributionResults(
	ctx context.Context,
	tx pgx.Tx,
	tenderID, tacticID string,
) (rows []calc.RedistributionResult, hasHolder bool, err error) {
	q, err := tx.Query(ctx, `
		SELECT boq_item_id::text,
		       COALESCE(original_work_cost, 0),
		       deducted_amount,
		       added_amount,
		       COALESCE(final_work_cost, 0),
		       redistribution_rules IS NOT NULL
		FROM public.cost_redistribution_results
		WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid
		ORDER BY boq_item_id ASC
	`, tenderID, tacticID)
	if err != nil {
		return nil, false, fmt.Errorf("storedRedistributionResults: %w", err)
	}
	defer q.Close()
	for q.Next() {
		var r calc.RedistributionResult
		var holder bool
		if err := q.Scan(&r.BoqItemID, &r.OriginalWorkCost, &r.DeductedAmount,
			&r.AddedAmount, &r.FinalWorkCost, &holder); err != nil {
			return nil, false, fmt.Errorf("storedRedistributionResults: scan: %w", err)
		}
		if holder {
			hasHolder = true
		}
		rows = append(rows, r)
	}
	if err := q.Err(); err != nil {
		return nil, false, fmt.Errorf("storedRedistributionResults: %w", err)
	}
	return rows, hasHolder, nil
}

// redistributionResultsEqual compares two ordered sets row by row.
func redistributionResultsEqual(a, b []calc.RedistributionResult) bool {
	if len(a) != len(b) {
		return false
	}
	near := func(x, y float64) bool { return math.Abs(x-y) < redistributionSnapshotEpsilon }
	for i := range a {
		if a[i].BoqItemID != b[i].BoqItemID ||
			!near(a[i].OriginalWorkCost, b[i].OriginalWorkCost) ||
			!near(a[i].DeductedAmount, b[i].DeductedAmount) ||
			!near(a[i].AddedAmount, b[i].AddedAmount) ||
			!near(a[i].FinalWorkCost, b[i].FinalWorkCost) {
			return false
		}
	}
	return true
}

// persistRedistributionSnapshotTx writes the complete server-generated set.
//
// Diff-before-write: when the computed rows equal the stored ones, only the
// revision marker on the rules-holder row is refreshed. That is the common case
// for a recalc triggered by a non-monetary input change, and it avoids
// rewriting N rows across six indexes plus 2×N per-row pg_notify events.
func persistRedistributionSnapshotTx(
	ctx context.Context,
	tx pgx.Tx,
	tenderID, tacticID string,
	results []calc.RedistributionResult,
	canonicalJSON []byte,
	createdBy string,
) (rewritten bool, err error) {
	stored, hasHolder, err := storedRedistributionResults(ctx, tx, tenderID, tacticID)
	if err != nil {
		return false, err
	}
	if hasHolder && redistributionResultsEqual(stored, results) {
		tag, err := tx.Exec(ctx, `
			UPDATE public.cost_redistribution_results
			SET redistribution_rules = $3::jsonb
			WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid
			  AND redistribution_rules IS NOT NULL
		`, tenderID, tacticID, canonicalJSON)
		if err != nil {
			return false, fmt.Errorf("persistRedistributionSnapshotTx: restamp: %w", err)
		}
		if tag.RowsAffected() != 1 {
			// The single-holder invariant is broken — refuse the shortcut rather
			// than leave an ambiguous rules row behind.
			return false, &calc.InvalidRedistributionCalculationResultError{
				Field:  "persist",
				Reason: fmt.Sprintf("re-stamped %d rules holder rows, expected exactly 1", tag.RowsAffected()),
			}
		}
		return false, nil
	}

	if _, err := tx.Exec(ctx, `
		DELETE FROM public.cost_redistribution_results
		WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid
	`, tenderID, tacticID); err != nil {
		return false, fmt.Errorf("persistRedistributionSnapshotTx: delete old set: %w", err)
	}

	ids := make([]string, len(results))
	originals := make([]float64, len(results))
	deducted := make([]float64, len(results))
	added := make([]float64, len(results))
	finals := make([]float64, len(results))
	for i, res := range results {
		ids[i] = res.BoqItemID
		originals[i] = res.OriginalWorkCost
		deducted[i] = res.DeductedAmount
		added[i] = res.AddedAmount
		finals[i] = res.FinalWorkCost
	}
	// Deterministic holder: items are ordered by id ASC, so results[0] is the
	// smallest boq_item_id.
	holderID := ids[0]
	var createdByArg any
	if createdBy != "" {
		createdByArg = createdBy
	}
	tag, err := tx.Exec(ctx, `
		INSERT INTO public.cost_redistribution_results (
			tender_id, markup_tactic_id, boq_item_id,
			original_work_cost, deducted_amount, added_amount, final_work_cost,
			redistribution_rules, created_by
		)
		SELECT $1::uuid, $2::uuid, u.id,
		       u.original, u.deducted, u.added, u.final,
		       CASE WHEN u.id = $3::uuid THEN $4::jsonb ELSE NULL END,
		       $5
		FROM UNNEST($6::uuid[], $7::numeric[], $8::numeric[], $9::numeric[], $10::numeric[])
		     AS u(id, original, deducted, added, final)
	`, tenderID, tacticID, holderID, canonicalJSON, createdByArg,
		ids, originals, deducted, added, finals)
	if err != nil {
		return false, fmt.Errorf("persistRedistributionSnapshotTx: insert set: %w", err)
	}
	if int(tag.RowsAffected()) != len(results) {
		return false, &calc.InvalidRedistributionCalculationResultError{
			Field:  "persist",
			Reason: fmt.Sprintf("persisted %d rows, calculated %d (exact-set mismatch)", tag.RowsAffected(), len(results)),
		}
	}
	return true, nil
}
