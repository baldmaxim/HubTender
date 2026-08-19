package repository

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests for the background refresh of the redistribution
// snapshot inside the authoritative commercial recalc. Reuses the existing
// convention and DSN guard (newTestPool / HUBTENDER_TEST_DATABASE_URL); SKIPs
// when no test DB is configured.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run RedistributionRefresh -v
//
// Contract under test:
//  1. a financial input change no longer leaves the snapshot permanently
//     requires_recalculation — the recalc re-applies the SAVED rules;
//  2. saved rules that no longer validate are fail-SOFT: the commercial recalc
//     still succeeds and the old snapshot keeps its old revision marker;
//  3. an unchanged result set is re-stamped in place (row identities survive),
//     not rewritten row by row;
//  4. a tender without a snapshot is untouched.

// bumpRevision records a financial input change without touching any money,
// the way every category-A mutation does.
func bumpRevision(t *testing.T, pool *pgxpool.Pool, tenderID, reason string) int64 {
	t.Helper()
	rev, err := MarkTenderFinancialInputsChangedTx(context.Background(), pool, tenderID, reason)
	if err != nil {
		t.Fatalf("bumpRevision: %v", err)
	}
	return rev
}

func rdRowIDs(t *testing.T, pool *pgxpool.Pool, tenderID string) map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT boq_item_id::text, id::text
		FROM public.cost_redistribution_results
		WHERE tender_id = $1::uuid`, tenderID)
	if err != nil {
		t.Fatalf("rdRowIDs: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var boqID, rowID string
		if err := rows.Scan(&boqID, &rowID); err != nil {
			t.Fatalf("rdRowIDs scan: %v", err)
		}
		out[boqID] = rowID
	}
	return out
}

// ─── 1. a markup-style input change is healed by the recalc ─────────────────

func TestRedistributionRefresh_RecalcRestampsSnapshot(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := seedRedistributionFixture(t, pool, "refresh-heal", nil)
	f.seedTwoItems(t, pool)

	repo := NewRedistributionRepo(pool)
	if _, err := repo.SaveAuthoritative(ctx, f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor); err != nil {
		t.Fatalf("initial save: %v", err)
	}

	// A markup edit: change where the work markup lands, then record the input
	// change exactly like the markup repositories do.
	if _, err := pool.Exec(ctx, `
		UPDATE public.tender_pricing_distribution SET work_markup_target = 'work'
		WHERE tender_id = $1::uuid`, f.tenderID); err != nil {
		t.Fatalf("markup change: %v", err)
	}
	bumpRevision(t, pool, f.tenderID, "itest_markup_change")

	// Before the recalc the snapshot is honestly stale.
	before, err := repo.LoadResults(ctx, f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load before: %v", err)
	}
	if before.Status != RedistributionStatusRequiresRecalculation ||
		before.Reason != RedistributionReasonInputRevisionChanged {
		t.Fatalf("before recalc: status=%q reason=%q, want requires_recalculation/INPUT_REVISION_CHANGED",
			before.Status, before.Reason)
	}

	outcome, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID)
	if err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if outcome != RecalcOutcomeCalculated {
		t.Fatalf("recalc outcome = %q, want calculated", outcome)
	}

	after, err := repo.LoadResults(ctx, f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load after: %v", err)
	}
	if after.Status != RedistributionStatusCalculated {
		t.Fatalf("after recalc: status=%q reason=%q, want calculated", after.Status, after.Reason)
	}
	if after.Prepared == nil {
		t.Fatal("after recalc: prepared projection missing")
	}
	if len(after.Results) != 2 {
		t.Fatalf("after recalc: %d rows, want 2", len(after.Results))
	}

	// The refreshed snapshot must carry the NEW money, still balanced.
	var ded, add float64
	for _, r := range after.Results {
		ded += r.DeductedAmount
		add += r.AddedAmount
	}
	if ded <= 0 || ded != add {
		t.Fatalf("refreshed snapshot unbalanced: deducted=%v added=%v", ded, add)
	}
	var beforeOrig float64
	for _, r := range before.Results {
		beforeOrig += r.OriginalWorkCost
	}
	var afterOrig float64
	for _, r := range after.Results {
		afterOrig += r.OriginalWorkCost
	}
	if afterOrig == beforeOrig {
		t.Fatalf("original work cost unchanged (%v) — the snapshot was not recomputed", afterOrig)
	}

	st := readFinState(t, pool, f.tenderID)
	if st.status != "calculated" || st.calcRev != st.inputRev {
		t.Fatalf("tender not calculated for the current revision: %+v", st)
	}
}

// ─── 2. rules that no longer validate must NOT break the recalc ─────────────

func TestRedistributionRefresh_InvalidRulesAreFailSoft(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := seedRedistributionFixture(t, pool, "refresh-soft", nil)
	f.seedTwoItems(t, pool)

	repo := NewRedistributionRepo(pool)
	if _, err := repo.SaveAuthoritative(ctx, f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor); err != nil {
		t.Fatalf("initial save: %v", err)
	}

	// Inject a position adjustment that can never be satisfied by the base.
	if _, err := pool.Exec(ctx, `
		UPDATE public.cost_redistribution_results
		SET redistribution_rules = jsonb_set(redistribution_rules, '{position_adjustments}',
		      jsonb_build_array(jsonb_build_object(
		        'mode','transfer','amount', 1e12,
		        'sourceIds', jsonb_build_array($2::text),
		        'targetIds', jsonb_build_array($3::text))))
		WHERE tender_id = $1::uuid AND redistribution_rules IS NOT NULL`,
		f.tenderID, f.pos1ID, f.pos2ID); err != nil {
		t.Fatalf("inject rules: %v", err)
	}
	rev := bumpRevision(t, pool, f.tenderID, "itest_invalid_rules")

	outcome, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID)
	if err != nil {
		t.Fatalf("recalc must not fail on unusable saved rules: %v", err)
	}
	if outcome != RecalcOutcomeCalculated {
		t.Fatalf("recalc outcome = %q, want calculated", outcome)
	}

	// Commercial side is calculated for the new revision …
	st := readFinState(t, pool, f.tenderID)
	if st.status != "calculated" || st.calcRev != rev {
		t.Fatalf("tender should be calculated for revision %d: %+v", rev, st)
	}
	// … while the snapshot honestly stays stale.
	after, err := repo.LoadResults(ctx, f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load after: %v", err)
	}
	if after.Status != RedistributionStatusRequiresRecalculation {
		t.Fatalf("snapshot status = %q, want requires_recalculation (fail-soft)", after.Status)
	}
	if after.Prepared != nil {
		t.Fatal("a stale snapshot must not expose a prepared projection")
	}
}

// ─── 3. an unchanged set is re-stamped, not rewritten ───────────────────────

func TestRedistributionRefresh_UnchangedSetIsRestampedInPlace(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := seedRedistributionFixture(t, pool, "refresh-restamp", nil)
	f.seedTwoItems(t, pool)

	repo := NewRedistributionRepo(pool)
	if _, err := repo.SaveAuthoritative(ctx, f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor); err != nil {
		t.Fatalf("initial save: %v", err)
	}
	idsBefore := rdRowIDs(t, pool, f.tenderID)
	if len(idsBefore) != 2 {
		t.Fatalf("expected 2 snapshot rows, got %d", len(idsBefore))
	}

	// Revision moves without any money changing.
	bumpRevision(t, pool, f.tenderID, "itest_no_money_change")
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}

	after, err := repo.LoadResults(ctx, f.tenderID, f.tacticID)
	if err != nil {
		t.Fatalf("load after: %v", err)
	}
	if after.Status != RedistributionStatusCalculated {
		t.Fatalf("status = %q reason = %q, want calculated", after.Status, after.Reason)
	}

	idsAfter := rdRowIDs(t, pool, f.tenderID)
	if len(idsAfter) != len(idsBefore) {
		t.Fatalf("row count changed: %d → %d", len(idsBefore), len(idsAfter))
	}
	for boqID, rowID := range idsBefore {
		if idsAfter[boqID] != rowID {
			t.Fatalf("row for boq item %s was rewritten (%s → %s); an unchanged set must be re-stamped in place",
				boqID, rowID, idsAfter[boqID])
		}
	}
}

// ─── 4. no snapshot → the recalc is untouched ───────────────────────────────

func TestRedistributionRefresh_NoSnapshotIsNoOp(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := seedRedistributionFixture(t, pool, "refresh-none", nil)
	f.seedTwoItems(t, pool)

	bumpRevision(t, pool, f.tenderID, "itest_no_snapshot")
	outcome, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID)
	if err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if outcome != RecalcOutcomeCalculated {
		t.Fatalf("recalc outcome = %q, want calculated", outcome)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.cost_redistribution_results WHERE tender_id = $1::uuid`,
		f.tenderID).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 0 {
		t.Fatalf("recalc invented %d snapshot rows for a tender without redistribution", n)
	}
}
