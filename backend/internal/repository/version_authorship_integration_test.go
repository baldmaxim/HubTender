package repository

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/actorctx"
	"github.com/su10/hubtender/backend/internal/calc"
)

// A new tender version — «Новая версия» (clone_tender_as_new_version) or the
// transfer after matching customer rows (ExecuteVersionTransfer) — keeps the
// authors of the previous version: each copied row and GP value carries the
// last author of its source, never the user who copies (docs/mcp/AUTHORSHIP.md).

const (
	vaAuthorA = "dddddddd-7000-0000-0000-00000000000a"
	vaAuthorB = "dddddddd-7000-0000-0000-00000000000b"
	vaCopier  = "00000000-0000-0000-0000-000000000000" // Itest Actor
)

// seedVersionAuthors gives the transfer fixture real authors:
// work → A, child material → B, standalone material → no author (fixture
// INSERT has no app.user_id), additional work → A; normal GP → A, additional GP → B.
func seedVersionAuthors(t *testing.T, pool *pgxpool.Pool, f *transferFixture) {
	t.Helper()
	ctx := context.Background()
	must := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("authors fixture: %v\nSQL: %s", err, q)
		}
	}
	for id, name := range map[string]string{vaAuthorA: "Author A", vaAuthorB: "Author B"} {
		must(`INSERT INTO auth.users(id,email) VALUES($1,$2) ON CONFLICT (id) DO NOTHING`, id, id+"@example.test")
		must(`INSERT INTO public.users(id,email,full_name,role_code,access_enabled,access_status)
		      VALUES($1,$2,$3,'engineer',true,'approved') ON CONFLICT (id) DO NOTHING`, id, id+"@example.test", name)
	}
	users := []string{vaAuthorA, vaAuthorB, vaCopier}
	t.Cleanup(func() {
		must(`DELETE FROM public.boq_items_audit WHERE changed_by = ANY($1::uuid[])`, users)
		must(`DELETE FROM public.client_position_gp_audit WHERE changed_by = ANY($1::uuid[])
		      OR tender_id IN (SELECT id FROM public.tenders WHERE tender_number = $2)`, users, f.tenderNumber)
		must(`DELETE FROM public.users WHERE id = ANY($1::uuid[])`, []string{vaAuthorA, vaAuthorB})
		must(`DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, []string{vaAuthorA, vaAuthorB})
	})
	edit := func(userID, q string, args ...any) {
		t.Helper()
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx) //nolint:errcheck
		if _, err := tx.Exec(ctx, `SELECT set_config('app.user_id',$1,true)`, userID); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, q, args...); err != nil {
			t.Fatalf("author edit: %v\nSQL: %s", err, q)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	edit(vaAuthorA, `UPDATE public.boq_items SET description='by A' WHERE id = ANY($1::uuid[])`, []string{f.workID, f.addWorkID})
	edit(vaAuthorB, `UPDATE public.boq_items SET description='by B' WHERE id = $1::uuid`, f.childMatID)
	edit(vaAuthorA, `UPDATE public.client_positions SET manual_volume = 12 WHERE id = $1::uuid`, f.normalPosID)
	edit(vaAuthorB, `UPDATE public.client_positions SET manual_volume = 3, manual_note = 'note B' WHERE id = $1::uuid`, f.addPosID)
}

// assertVersionAuthors checks the copied rows and GP of newTenderID.
func assertVersionAuthors(t *testing.T, pool *pgxpool.Pool, newTenderID string) {
	t.Helper()
	ctx := context.Background()
	rows := readTenderBoq(t, pool, newTenderID)
	if len(rows) != 4 {
		t.Fatalf("expected 4 copied rows, got %d", len(rows))
	}
	author := func(itemID string) string {
		t.Helper()
		var id *string
		if err := pool.QueryRow(ctx, `SELECT (SELECT changed_by::text FROM public.boq_item_last_authorship($1::uuid))`, itemID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if id == nil {
			return ""
		}
		return *id
	}
	for _, r := range rows {
		want := ""
		switch {
		case r.isAdd:
			want = vaAuthorA
		case calc.IsWorkBoqType(r.itemType):
			want = vaAuthorA
		case r.parent != nil:
			want = vaAuthorB
		}
		if got := author(r.id); got != want {
			t.Errorf("row %s (%s, add=%t, linked=%t): author %q, want %q", r.id, r.itemType, r.isAdd, r.parent != nil, got, want)
		}
		var total, copies int
		if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE operation_type='INSERT' AND changed_fields = ARRAY['version_copy'])
			FROM public.boq_items_audit WHERE boq_item_id = $1::uuid`, r.id).Scan(&total, &copies); err != nil {
			t.Fatal(err)
		}
		if total != 1 || copies != 1 {
			t.Errorf("row %s: %d audit rows (%d version_copy), want exactly one version_copy record", r.id, total, copies)
		}
	}
	var copierRows int
	if err := pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM public.boq_items_audit a JOIN public.boq_items b ON b.id = a.boq_item_id
		  WHERE b.tender_id = $1::uuid AND a.changed_by = $2::uuid)
		+ (SELECT count(*) FROM public.client_position_gp_audit WHERE tender_id = $1::uuid AND changed_by = $2::uuid)`,
		newTenderID, vaCopier).Scan(&copierRows); err != nil {
		t.Fatal(err)
	}
	if copierRows != 0 {
		t.Errorf("the copying user became an author of %d records", copierRows)
	}
	gp := func(isAdditional bool, field string) string {
		t.Helper()
		var id *string
		if err := pool.QueryRow(ctx, `SELECT (SELECT changed_by::text FROM public.client_position_gp_last_authorship(cp.id, $3))
			FROM public.client_positions cp WHERE cp.tender_id = $1::uuid AND cp.is_additional = $2`,
			newTenderID, isAdditional, field).Scan(&id); err != nil {
			t.Fatal(err)
		}
		if id == nil {
			return ""
		}
		return *id
	}
	if got := gp(false, "volume"); got != vaAuthorA {
		t.Errorf("GP of the matched position: author %q, want A", got)
	}
	if got, note := gp(true, "volume"), gp(true, "note"); got != vaAuthorB || note != vaAuthorB {
		t.Errorf("GP of the additional position: volume %q note %q, want B", got, note)
	}
}

func TestVersionTransferCarriesAuthorship(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "authz", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	seedVersionAuthors(t, pool, f)
	in := f.transferInput()
	in.ChangedBy = vaCopier
	if _, err := NewTransferRepo(pool).ExecuteVersionTransfer(actorctx.WithUserID(context.Background(), vaCopier), in); err != nil {
		t.Fatalf("transfer: %v", err)
	}
	newID := newVersionID(t, pool, f)
	if newID == "" {
		t.Fatal("no new version")
	}
	assertVersionAuthors(t, pool, newID)
}

func TestCloneVersionCarriesAuthorship(t *testing.T) {
	pool := newTestPool(t)
	f := seedTransferSource(t, pool, "clonez", nil)
	f.seedFullBoq(t, pool, calc.CurrencyRUB)
	seedVersionAuthors(t, pool, f)
	res, err := NewCloneRepo(pool).CloneTender(actorctx.WithUserID(context.Background(), vaCopier), f.srcTenderID)
	if err != nil {
		t.Fatalf("clone: %v", err)
	}
	assertVersionAuthors(t, pool, res.TenderID)
	// A later edit in the new version makes its editor the author.
	rows := readTenderBoq(t, pool, res.TenderID)
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background()) //nolint:errcheck
	if _, err := tx.Exec(context.Background(), `SELECT set_config('app.user_id',$1,true)`, vaAuthorB); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(context.Background(), `UPDATE public.boq_items SET unit_rate = unit_rate + 1 WHERE id = $1::uuid`, rows[0].id); err != nil {
		t.Fatal(err)
	}
	var author string
	if err := tx.QueryRow(context.Background(), `SELECT changed_by::text FROM public.boq_item_last_authorship($1::uuid)`, rows[0].id).Scan(&author); err != nil || author != vaAuthorB {
		t.Fatalf("edit after copy: author %q %v", author, err)
	}
}
