package repository

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests for VALUE-based (not presence-based) detection
// of a financial input change on the two tender write paths.
//
// Regression under test: the admin tender modal re-submits every form field on
// every save, so usd_rate/eur_rate/cny_rate were always PRESENT in the patch.
// Both write paths keyed off presence, so an ordinary title/link edit
//   - bumped financial_input_revision and flipped the tender to 'stale',
//   - silently REVOKED an active «Финансовые показатели» approval,
//   - ran the full reprice pipeline over every BOQ row of the tender inside the
//     request transaction — tens of seconds, past the browser fetch timeout,
//     whereupon the abort rolled the whole edit back ("TimeoutError: signal
//     timed out", nothing saved).
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run FinancialDiff -v

func titleOf(t *testing.T, pool *pgxpool.Pool, tenderID string) string {
	t.Helper()
	var title string
	if err := pool.QueryRow(context.Background(),
		`SELECT title FROM public.tenders WHERE id = $1::uuid`, tenderID).Scan(&title); err != nil {
		t.Fatalf("read title: %v", err)
	}
	return title
}

// A patch that re-sends the STORED rate is a plain field update: no revision
// bump, no approval revocation, no reprice.
func TestFinancialDiff_AdminPatchUnchangedRateIsNotFinancial(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "FXDIFF-A", fptr(90.5))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	approveDirect(t, pool, f.tenderID)
	repo := NewTenderRepo(pool)
	before := readFinState(t, pool, f.tenderID)

	// 90.50 == 90.5 as numeric — the modal's re-submitted value.
	newTitle := "itest-fxdiff-renamed"
	if err := repo.AdminPatchTender(context.Background(), f.tenderID, AdminTenderPatch{
		Title:   &newTitle,
		USDRate: fptr(90.50),
	}); err != nil {
		t.Fatalf("admin patch: %v", err)
	}

	if got := titleOf(t, pool, f.tenderID); got != newTitle {
		t.Fatalf("title = %q, want %q — the plain field edit must still apply", got, newTitle)
	}
	after := readFinState(t, pool, f.tenderID)
	if after.inputRev != before.inputRev {
		t.Fatalf("input revision %d → %d, want unchanged: no financial input moved",
			before.inputRev, after.inputRev)
	}
	if !after.approved {
		t.Fatal("an active financial approval must survive a non-financial edit")
	}
	if after.status != before.status {
		t.Fatalf("status %q → %q, want unchanged", before.status, after.status)
	}
}

// A patch that actually moves a rate keeps the full 0-F1/0-F2 semantics.
func TestFinancialDiff_AdminPatchChangedRateIsFinancial(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "FXDIFF-B", fptr(90.5))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	approveDirect(t, pool, f.tenderID)
	repo := NewTenderRepo(pool)
	before := readFinState(t, pool, f.tenderID)

	if err := repo.AdminPatchTender(context.Background(), f.tenderID, AdminTenderPatch{
		USDRate: fptr(95),
	}); err != nil {
		t.Fatalf("admin patch: %v", err)
	}

	after := readFinState(t, pool, f.tenderID)
	if after.inputRev != before.inputRev+1 {
		t.Fatalf("input revision %d → %d, want exactly +1 for a real rate change",
			before.inputRev, after.inputRev)
	}
	if after.approved {
		t.Fatal("a real rate change must revoke the financial approval")
	}
	// Category B: the sync reprice finishes with the success CAS in the same tx.
	if after.status != "calculated" || after.calcRev != after.inputRev {
		t.Fatalf("status=%q calcRev=%d inputRev=%d, want calculated with matching revisions",
			after.status, after.calcRev, after.inputRev)
	}
}

// Same rule on the ETag PATCH /api/v1/tenders/:id path.
func TestFinancialDiff_UpdateTenderUnchangedRateIsNotFinancial(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "FXDIFF-C", fptr(90.5))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	approveDirect(t, pool, f.tenderID)
	repo := NewTenderRepo(pool)
	before := readFinState(t, pool, f.tenderID)

	newTitle := "itest-fxdiff-update-renamed"
	if _, err := repo.UpdateTender(context.Background(), f.tenderID, UpdateTenderInput{
		Title:   &newTitle,
		USDRate: fptr(90.5),
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	if got := titleOf(t, pool, f.tenderID); got != newTitle {
		t.Fatalf("title = %q, want %q", got, newTitle)
	}
	after := readFinState(t, pool, f.tenderID)
	if after.inputRev != before.inputRev {
		t.Fatalf("input revision %d → %d, want unchanged", before.inputRev, after.inputRev)
	}
	if !after.approved {
		t.Fatal("an active financial approval must survive a non-financial edit")
	}
}

// Re-asserting the SAME markup tactic is not a financial change either. The
// tactic is a category-A input: it bumps the revision and revokes the approval
// without repricing, so a presence-based gate loses the approval just as surely.
func TestFinancialDiff_AdminPatchUnchangedTacticIsNotFinancial(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "FXDIFF-E", fptr(90.5))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	approveDirect(t, pool, f.tenderID)
	repo := NewTenderRepo(pool)
	before := readFinState(t, pool, f.tenderID)

	// f.tacticID is already the tender's markup_tactic_id.
	if err := repo.AdminPatchTender(context.Background(), f.tenderID, AdminTenderPatch{
		MarkupTacticID: &f.tacticID,
	}); err != nil {
		t.Fatalf("admin patch: %v", err)
	}

	after := readFinState(t, pool, f.tenderID)
	if after.inputRev != before.inputRev {
		t.Fatalf("input revision %d → %d, want unchanged: the tactic did not move",
			before.inputRev, after.inputRev)
	}
	if !after.approved {
		t.Fatal("re-asserting the same tactic must not revoke the financial approval")
	}
}

// A NULL stored rate vs an omitted patch field must not read as a change, and
// setting a previously-NULL rate must.
func TestFinancialDiff_NullStoredRateSemantics(t *testing.T) {
	pool := newTestPool(t)
	// eur_rate / cny_rate are NULL in the fixture; usd_rate is 90.5.
	f := seedRollbackFixture(t, pool, "FXDIFF-D", fptr(90.5))
	f.addItem(t, pool, "раб", "RUB", 10, 100, nil)
	approveDirect(t, pool, f.tenderID)
	repo := NewTenderRepo(pool)
	before := readFinState(t, pool, f.tenderID)

	// Omitted EUR/CNY (nil pointers) → not a change.
	newTitle := "itest-fxdiff-null"
	if err := repo.AdminPatchTender(context.Background(), f.tenderID, AdminTenderPatch{
		Title: &newTitle, USDRate: fptr(90.5),
	}); err != nil {
		t.Fatalf("admin patch: %v", err)
	}
	if st := readFinState(t, pool, f.tenderID); st.inputRev != before.inputRev || !st.approved {
		t.Fatalf("omitted NULL rates must not count as a change (rev %d → %d, approved=%v)",
			before.inputRev, st.inputRev, st.approved)
	}

	// Filling a NULL rate IS a change (NULL IS DISTINCT FROM 100).
	if err := repo.AdminPatchTender(context.Background(), f.tenderID, AdminTenderPatch{
		EURRate: fptr(100),
	}); err != nil {
		t.Fatalf("admin patch eur: %v", err)
	}
	after := readFinState(t, pool, f.tenderID)
	if after.inputRev != before.inputRev+1 {
		t.Fatalf("input revision %d → %d, want +1: NULL → 100 is a real rate change",
			before.inputRev, after.inputRev)
	}
	if after.approved {
		t.Fatal("filling a NULL rate must revoke the approval")
	}
}
