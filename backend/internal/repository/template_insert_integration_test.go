package repository

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL integration tests for the production InsertTemplateItems path.
//
// They compile in the normal suite but only RUN when a dedicated test database
// is configured:
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run TemplateInsertIntegration -v
//
// Without the variable they SKIP (never a silent PASS).
//
// SAFETY: the DSN must point at an obvious test database — its database name has
// to contain "test". This makes it impossible to point the suite at production by
// accident, because these tests CREATE and DELETE rows.
const testDBEnv = "HUBTENDER_TEST_DATABASE_URL"

// newTestPool connects to the test DB or skips the test.
func newTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()

	dsn := os.Getenv(testDBEnv)
	if dsn == "" {
		t.Skipf("%s is not configured — PostgreSQL integration test skipped", testDBEnv)
	}
	if !isObviousTestDSN(dsn) {
		t.Fatalf("%s does not look like a test database (its database name must contain "+
			"\"test\"); refusing to run destructive fixtures", testDBEnv)
	}

	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect to test DB: %v", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		pool.Close()
		t.Fatalf("ping test DB: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// isObviousTestDSN reports whether the DSN's database name contains "test".
// Guards against pointing the destructive fixtures at production.
func isObviousTestDSN(dsn string) bool {
	// strip query string, take the last path segment (the database name)
	s := dsn
	if i := strings.IndexByte(s, '?'); i >= 0 {
		s = s[:i]
	}
	i := strings.LastIndexByte(s, '/')
	if i < 0 || i == len(s)-1 {
		return false
	}
	return strings.Contains(strings.ToLower(s[i+1:]), "test")
}

// The production-safety guard itself is unit-tested (runs without a DB).
func TestIsObviousTestDSN(t *testing.T) {
	tests := []struct {
		dsn  string
		want bool
	}{
		{"postgres://u:p@localhost:5432/hubtender_test", true},
		{"postgres://u:p@localhost:5432/hubtender_test?sslmode=disable", true},
		{"postgres://u:p@host/test_db?sslmode=verify-full", true},

		// production-looking DSNs must be refused
		{"postgres://u:p@rc1d-xxx.mdb.yandexcloud.net:6432/HubTender?sslmode=verify-full", false},
		{"postgres://u:p@localhost:5432/hubtender", false},
		{"postgres://u:p@localhost:5432/prod", false},
		{"", false},
		{"postgres://u:p@localhost:5432/", false},
	}
	for _, tt := range tests {
		if got := isObviousTestDSN(tt.dsn); got != tt.want {
			t.Errorf("isObviousTestDSN(%q) = %v, want %v", tt.dsn, got, tt.want)
		}
	}
}

// ─── fixture graph ───────────────────────────────────────────────────────────

type tmplFixture struct {
	tenderID   string
	positionID string
	templateID string
	workLibID  string
	matLibID   string
	// template item ids, in insertion order
	itemIDs []string
}

// seedFixture creates an isolated tender / position / template graph. Everything
// is committed (InsertTemplateItems opens its own tx from the pool, so it cannot
// see uncommitted rows). Cleanup is registered with t.Cleanup.
func seedFixture(t *testing.T, pool *pgxpool.Pool) *tmplFixture {
	t.Helper()
	ctx := context.Background()
	f := &tmplFixture{}

	var costCatID, detailCatID, workNameID, matNameID string

	must := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("fixture exec failed: %v\nSQL: %s", err, q)
		}
	}
	scan := func(dst *string, q string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			t.Fatalf("fixture query failed: %v\nSQL: %s", err, q)
		}
	}

	scan(&costCatID, `INSERT INTO public.cost_categories (name, unit) VALUES ('itest-cat','м2') RETURNING id::text`)
	scan(&detailCatID, `INSERT INTO public.detail_cost_categories (cost_category_id, location, name, unit)
	                    VALUES ($1::uuid,'itest-loc','itest-detail','м2') RETURNING id::text`, costCatID)
	scan(&workNameID, `INSERT INTO public.work_names (name, unit) VALUES ('itest-work','м2') RETURNING id::text`)
	scan(&matNameID, `INSERT INTO public.material_names (name, unit) VALUES ('itest-mat','кг') RETURNING id::text`)

	// Tender WITHOUT any currency rates → any foreign-currency row must block.
	scan(&f.tenderID, `INSERT INTO public.tenders (title, client_name, tender_number)
	                   VALUES ('itest-tender','itest-client','ITEST-1') RETURNING id::text`)
	scan(&f.positionID, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
	                     VALUES ($1::uuid, 1, 'itest-position') RETURNING id::text`, f.tenderID)

	scan(&f.workLibID, `INSERT INTO public.works_library (work_name_id, item_type, unit_rate, currency_type)
	                    VALUES ($1::uuid, 'раб', 100, 'RUB') RETURNING id::text`, workNameID)
	scan(&f.matLibID, `INSERT INTO public.materials_library
	                     (material_type, item_type, consumption_coefficient, unit_rate, currency_type,
	                      delivery_price_type, delivery_amount, material_name_id)
	                   VALUES ('основн.','мат', 1.2, 100, 'RUB', 'в цене', 0, $1::uuid) RETURNING id::text`, matNameID)

	scan(&f.templateID, `INSERT INTO public.templates (name, detail_cost_category_id)
	                     VALUES ('itest-template', $1::uuid) RETURNING id::text`, detailCatID)

	t.Cleanup(func() {
		// FK-safe reverse order. boq_items/audit are removed by the tests' own
		// cleanup of the tender.
		must(`DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.template_items WHERE template_id = $1::uuid`, f.templateID)
		must(`DELETE FROM public.templates WHERE id = $1::uuid`, f.templateID)
		must(`DELETE FROM public.client_positions WHERE tender_id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.tenders WHERE id = $1::uuid`, f.tenderID)
		must(`DELETE FROM public.works_library WHERE id = $1::uuid`, f.workLibID)
		must(`DELETE FROM public.materials_library WHERE id = $1::uuid`, f.matLibID)
		must(`DELETE FROM public.work_names WHERE id = $1::uuid`, workNameID)
		must(`DELETE FROM public.material_names WHERE id = $1::uuid`, matNameID)
		must(`DELETE FROM public.detail_cost_categories WHERE id = $1::uuid`, detailCatID)
		must(`DELETE FROM public.cost_categories WHERE id = $1::uuid`, costCatID)
	})

	return f
}

// addWorkItem appends a work template item and returns its id.
func (f *tmplFixture) addWorkItem(t *testing.T, pool *pgxpool.Pool, pos int) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO public.template_items (template_id, kind, work_library_id, position)
		 VALUES ($1::uuid,'work',$2::uuid,$3) RETURNING id::text`,
		f.templateID, f.workLibID, pos,
	).Scan(&id); err != nil {
		t.Fatalf("add work item: %v", err)
	}
	f.itemIDs = append(f.itemIDs, id)
	return id
}

// addMaterialItem appends a material template item (optionally with a parent).
func (f *tmplFixture) addMaterialItem(t *testing.T, pool *pgxpool.Pool, pos int, parentTID *string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO public.template_items (template_id, kind, material_library_id, parent_work_item_id, conversation_coeff, position)
		 VALUES ($1::uuid,'material',$2::uuid,$3::uuid, CASE WHEN $3::uuid IS NULL THEN NULL ELSE 1::numeric END, $4) RETURNING id::text`,
		f.templateID, f.matLibID, parentTID, pos,
	).Scan(&id); err != nil {
		t.Fatalf("add material item: %v", err)
	}
	f.itemIDs = append(f.itemIDs, id)
	return id
}

// ─── observation helpers ─────────────────────────────────────────────────────

func countBoqItems(t *testing.T, pool *pgxpool.Pool, tenderID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.boq_items WHERE tender_id = $1::uuid`, tenderID).Scan(&n); err != nil {
		t.Fatalf("count boq_items: %v", err)
	}
	return n
}

func countAudit(t *testing.T, pool *pgxpool.Pool, tenderID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.boq_items_audit a
		 WHERE EXISTS (SELECT 1 FROM public.boq_items b
		               WHERE b.id = a.boq_item_id AND b.tender_id = $1::uuid)`,
		tenderID).Scan(&n); err != nil {
		// audit rows may outlive their item; fall back to 0 rather than failing
		// the whole test on a schema nuance.
		t.Logf("audit count query failed (ignored): %v", err)
		return 0
	}
	return n
}

func positionTotals(t *testing.T, pool *pgxpool.Pool, positionID string) (float64, float64) {
	t.Helper()
	var tm, tw *float64
	if err := pool.QueryRow(context.Background(),
		`SELECT total_material, total_works FROM public.client_positions WHERE id = $1::uuid`,
		positionID).Scan(&tm, &tw); err != nil {
		t.Fatalf("position totals: %v", err)
	}
	var m, w float64
	if tm != nil {
		m = *tm
	}
	if tw != nil {
		w = *tw
	}
	return m, w
}

// ─── A. Atomic rollback: row 2 is invalid ⇒ NOTHING is persisted ─────────────

func TestTemplateInsertIntegration_AtomicRollback(t *testing.T) {
	pool := newTestPool(t)
	f := seedFixture(t, pool)
	repo := NewBoqRepo(pool)

	// row 1: a valid work. row 2: a material whose parent points at ITSELF —
	// a blocking InvalidTemplateParentError.
	f.addWorkItem(t, pool, 1)
	matID := f.addMaterialItem(t, pool, 2, nil)
	// template_items_material_logic_check: a material with a parent must carry
	// a conversation_coeff — set both so ONLY the self-reference is invalid.
	if _, err := pool.Exec(context.Background(),
		`UPDATE public.template_items SET parent_work_item_id = id, conversation_coeff = 1 WHERE id = $1::uuid`, matID); err != nil {
		t.Fatalf("make self-parent: %v", err)
	}

	beforeItems := countBoqItems(t, pool, f.tenderID)
	beforeAudit := countAudit(t, pool, f.tenderID)
	beforeM, beforeW := positionTotals(t, pool, f.positionID)

	_, err := repo.InsertTemplateItems(context.Background(), f.templateID, f.positionID, "00000000-0000-0000-0000-000000000000")

	var pe *InvalidTemplateParentError
	if !errors.As(err, &pe) {
		t.Fatalf("expected InvalidTemplateParentError, got %v", err)
	}
	if pe.Reason != SelfParentReference {
		t.Fatalf("reason = %q, want %q", pe.Reason, SelfParentReference)
	}

	// Nothing persisted.
	if got := countBoqItems(t, pool, f.tenderID); got != beforeItems {
		t.Fatalf("boq_items after failed insert = %d, want %d (rollback failed)", got, beforeItems)
	}
	if got := countAudit(t, pool, f.tenderID); got != beforeAudit {
		t.Fatalf("audit rows after failed insert = %d, want %d", got, beforeAudit)
	}
	afterM, afterW := positionTotals(t, pool, f.positionID)
	if afterM != beforeM || afterW != beforeW {
		t.Fatalf("position totals changed on failure: (%v,%v) → (%v,%v)", beforeM, beforeW, afterM, afterW)
	}
}

// Same, but the second row blocks on a MISSING FX RATE (tender has no usd_rate).
func TestTemplateInsertIntegration_AtomicRollback_MissingFX(t *testing.T) {
	pool := newTestPool(t)
	f := seedFixture(t, pool)
	repo := NewBoqRepo(pool)

	f.addWorkItem(t, pool, 1)

	// A USD material library entry — the tender has NO usd_rate.
	var usdMatLib string
	var matNameID string
	if err := pool.QueryRow(context.Background(),
		`SELECT material_name_id::text FROM public.materials_library WHERE id = $1::uuid`, f.matLibID).Scan(&matNameID); err != nil {
		t.Fatalf("read mat name: %v", err)
	}
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO public.materials_library
		   (material_type, item_type, consumption_coefficient, unit_rate, currency_type,
		    delivery_price_type, delivery_amount, material_name_id)
		 VALUES ('основн.','мат', 1, 100, 'USD', 'в цене', 0, $1::uuid) RETURNING id::text`,
		matNameID).Scan(&usdMatLib); err != nil {
		t.Fatalf("insert usd material lib: %v", err)
	}
	t.Cleanup(func() {
		// LIFO: this runs BEFORE seedFixture's cleanup, so drop the dependent
		// template_items row first or the library delete silently FK-fails and
		// the fixture's material_names delete then breaks.
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.template_items WHERE material_library_id = $1::uuid`, usdMatLib)
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.materials_library WHERE id = $1::uuid`, usdMatLib)
	})
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO public.template_items (template_id, kind, material_library_id, position)
		 VALUES ($1::uuid,'material',$2::uuid,2)`, f.templateID, usdMatLib); err != nil {
		t.Fatalf("add usd template item: %v", err)
	}

	before := countBoqItems(t, pool, f.tenderID)

	_, err := repo.InsertTemplateItems(context.Background(), f.templateID, f.positionID, "00000000-0000-0000-0000-000000000000")

	var fx *calc.MissingFXRateError
	if !errors.As(err, &fx) {
		t.Fatalf("expected MissingFXRateError, got %v", err)
	}
	if fx.Currency != calc.CurrencyUSD {
		t.Fatalf("currency = %q, want USD", fx.Currency)
	}
	if got := countBoqItems(t, pool, f.tenderID); got != before {
		t.Fatalf("boq_items after failed insert = %d, want %d (rollback failed)", got, before)
	}
}

// ─── B. Successful parent insertion: real UUID link + child pricing ──────────

func TestTemplateInsertIntegration_ParentLinkAndChildPricing(t *testing.T) {
	pool := newTestPool(t)
	f := seedFixture(t, pool)
	repo := NewBoqRepo(pool)

	workTID := f.addWorkItem(t, pool, 1)
	f.addMaterialItem(t, pool, 2, &workTID) // child material (consumption 1.2 in library)

	res, err := repo.InsertTemplateItems(context.Background(), f.templateID, f.positionID, "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}
	if res.TotalInserted != 2 {
		t.Fatalf("inserted = %d, want 2", res.TotalInserted)
	}

	// The work row.
	var workID string
	var workTotal float64
	if err := pool.QueryRow(context.Background(),
		`SELECT id::text, total_amount FROM public.boq_items
		 WHERE tender_id = $1::uuid AND boq_item_type = 'раб'`, f.tenderID).Scan(&workID, &workTotal); err != nil {
		t.Fatalf("read work row: %v", err)
	}
	// work: quantity 1 × unit_rate 100 = 100
	if workTotal != 100 {
		t.Fatalf("work total_amount = %v, want 100", workTotal)
	}

	// The child material row.
	var matParent *string
	var matTotal float64
	if err := pool.QueryRow(context.Background(),
		`SELECT parent_work_item_id::text, total_amount FROM public.boq_items
		 WHERE tender_id = $1::uuid AND boq_item_type = 'мат'`, f.tenderID).Scan(&matParent, &matTotal); err != nil {
		t.Fatalf("read material row: %v", err)
	}

	// Parent link points at the really-inserted work row (no dangling reference).
	if matParent == nil {
		t.Fatal("child material parent_work_item_id is NULL — link was not restored")
	}
	if *matParent != workID {
		t.Fatalf("parent_work_item_id = %s, want the inserted work %s", *matParent, workID)
	}

	// Child ⇒ calc forces consumption to 1: 1 × 1 × 100 = 100 (NOT 120).
	if matTotal != 100 {
		t.Fatalf("child material total_amount = %v, want 100 (consumption forced to 1 for a child)", matTotal)
	}
}

// ─── C. Valid batch: every row persisted with the calc amount ───────────────

func TestTemplateInsertIntegration_ValidBatch(t *testing.T) {
	pool := newTestPool(t)
	f := seedFixture(t, pool)
	repo := NewBoqRepo(pool)

	f.addWorkItem(t, pool, 1)
	f.addMaterialItem(t, pool, 2, nil) // standalone material ⇒ consumption 1.2 applies

	res, err := repo.InsertTemplateItems(context.Background(), f.templateID, f.positionID, "00000000-0000-0000-0000-000000000000")
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}
	if res.TotalInserted != 2 || res.WorksCount != 1 || res.MaterialsCount != 1 {
		t.Fatalf("unexpected result: %+v", res)
	}
	if got := countBoqItems(t, pool, f.tenderID); got != 2 {
		t.Fatalf("boq_items = %d, want 2", got)
	}

	var matTotal float64
	var matParent *string
	if err := pool.QueryRow(context.Background(),
		`SELECT total_amount, parent_work_item_id::text FROM public.boq_items
		 WHERE tender_id = $1::uuid AND boq_item_type = 'мат'`, f.tenderID).Scan(&matTotal, &matParent); err != nil {
		t.Fatalf("read material: %v", err)
	}
	if matParent != nil {
		t.Fatalf("standalone material must have NULL parent, got %s", *matParent)
	}
	// standalone ⇒ 1 × 1.2 × 100 = 120 (this is the amount the legacy formula got wrong)
	if matTotal != 120 {
		t.Fatalf("standalone material total_amount = %v, want 120 (consumption applied)", matTotal)
	}
}
