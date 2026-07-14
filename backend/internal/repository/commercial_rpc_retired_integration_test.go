package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests for stage 0.1.2.2c: the legacy SQL RPC
// public.bulk_update_boq_items_commercial_costs(jsonb) is a fail-closed
// tombstone after the retirement migration. Reuses the existing convention and
// the production-DSN guard (newTestPool / HUBTENDER_TEST_DATABASE_URL); SKIPs
// when no test DB is configured.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run RetiredCommercialCostRPC -v
//
// All DDL runs inside ONE transaction that is rolled back at the end of each
// test — the test DB keeps its original state. The migration's own BEGIN;/
// COMMIT; are stripped for the in-transaction application (noted honestly:
// the standalone transactional property is asserted structurally by the
// source guard, not executed here).

const retiredRPCSig = "public.bulk_update_boq_items_commercial_costs(jsonb)"

// legacyUnsafeRPCDef is the PRE-0.1.2.2c writer definition (verbatim from the
// old db/yandex/sql/04_functions.sql). Installed first so the migration is
// exercised against a REAL old installation, not against an already-retired one.
const legacyUnsafeRPCDef = `
CREATE OR REPLACE FUNCTION public.bulk_update_boq_items_commercial_costs(p_rows jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
  v_tender_id uuid;
BEGIN
  UPDATE boq_items bi
  SET
    commercial_markup              = (r.value->>'commercial_markup')::numeric,
    total_commercial_material_cost = (r.value->>'total_commercial_material_cost')::numeric,
    total_commercial_work_cost     = (r.value->>'total_commercial_work_cost')::numeric,
    updated_at                     = now()
  FROM jsonb_array_elements(p_rows) AS r(value)
  WHERE bi.id = (r.value->>'id')::uuid;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  FOR v_tender_id IN
    SELECT DISTINCT bi.tender_id
    FROM boq_items bi
    JOIN jsonb_array_elements(p_rows) AS r(value) ON bi.id = (r.value->>'id')::uuid
  LOOP
    PERFORM public.recalculate_tender_grand_total(v_tender_id);
  END LOOP;

  RETURN v_count;
END;
$function$;
`

// readRetirementMigration loads the incremental migration and strips the
// top-level BEGIN;/COMMIT; so it can be applied inside the test's transaction.
func readRetirementMigration(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "db", "yandex", "incremental",
		"2026_07_retire_bulk_update_commercial_costs.sql")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	stripped := regexp.MustCompile(`(?m)^(BEGIN|COMMIT);\s*$`).ReplaceAllString(string(raw), "")
	return stripped
}

type retiredRPCFixture struct {
	tx       pgx.Tx
	tenderID string
	posID    string
	itemID   string
}

// setupRetiredRPC opens a tx (rolled back via t.Cleanup), installs the OLD
// unsafe RPC, applies the retirement migration TWICE (idempotency), and seeds
// a tender/position/item with known commercial values (7 / 8 / 9).
func setupRetiredRPC(t *testing.T, pool *pgxpool.Pool) *retiredRPCFixture {
	t.Helper()
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	if _, err := tx.Exec(ctx, legacyUnsafeRPCDef); err != nil {
		t.Fatalf("install legacy unsafe definition: %v", err)
	}
	mig := readRetirementMigration(t)
	for i := 1; i <= 2; i++ { // §9 E: second application must also succeed
		if _, err := tx.Exec(ctx, mig); err != nil {
			t.Fatalf("apply retirement migration (attempt %d): %v", i, err)
		}
	}

	f := &retiredRPCFixture{tx: tx}
	if err := tx.QueryRow(ctx, `INSERT INTO public.tenders (title, client_name, tender_number)
		VALUES ('itest-rpc','itest-client','ITEST-RPC-1') RETURNING id::text`).Scan(&f.tenderID); err != nil {
		t.Fatalf("seed tender: %v", err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 1, 'itest-rpc-pos') RETURNING id::text`, f.tenderID).Scan(&f.posID); err != nil {
		t.Fatalf("seed position: %v", err)
	}
	wnID, _ := ensureTestNames(t, pool)
	if err := tx.QueryRow(ctx, `INSERT INTO public.boq_items
		(client_position_id, tender_id, boq_item_type, work_name_id, quantity, unit_rate,
		 commercial_markup, total_commercial_material_cost, total_commercial_work_cost)
		VALUES ($1::uuid, $2::uuid, 'раб', $3::uuid, 10, 100, 7, 8, 9) RETURNING id::text`,
		f.posID, f.tenderID, wnID).Scan(&f.itemID); err != nil {
		t.Fatalf("seed item: %v", err)
	}
	return f
}

// callRPC invokes the RPC in a savepoint (so the expected error does not abort
// the outer tx) and returns the pg error, or nil if the call succeeded.
func (f *retiredRPCFixture) callRPC(t *testing.T, payloadSQL string) *pgconn.PgError {
	t.Helper()
	ctx := context.Background()
	sp, err := f.tx.Begin(ctx) // pgx nested Begin = SAVEPOINT
	if err != nil {
		t.Fatalf("savepoint: %v", err)
	}
	defer sp.Rollback(ctx) //nolint:errcheck
	var res *int
	err = sp.QueryRow(ctx,
		"SELECT public.bulk_update_boq_items_commercial_costs("+payloadSQL+")").Scan(&res)
	if err == nil {
		t.Fatalf("RPC call with payload %s SUCCEEDED (returned %v) — tombstone missing", payloadSQL, res)
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("RPC call with payload %s: expected PgError, got %v", payloadSQL, err)
	}
	return pgErr
}

func (f *retiredRPCFixture) readCommercial(t *testing.T) (markup, mat, work float64) {
	t.Helper()
	if err := f.tx.QueryRow(context.Background(), `
		SELECT commercial_markup, total_commercial_material_cost, total_commercial_work_cost
		FROM public.boq_items WHERE id = $1::uuid`, f.itemID).Scan(&markup, &mat, &work); err != nil {
		t.Fatalf("read commercial: %v", err)
	}
	return
}

// ─── A. Tombstone blocks the exact payload that used to mutate ───────────────

func TestRetiredCommercialCostRPC_ValidPayloadCannotMutate(t *testing.T) {
	pool := newTestPool(t)
	f := setupRetiredRPC(t, pool)

	payload := `'[{"id":"` + f.itemID + `","commercial_markup":111,` +
		`"total_commercial_material_cost":222,"total_commercial_work_cost":333}]'::jsonb`
	pgErr := f.callRPC(t, payload)

	if pgErr.Code != "0A000" {
		t.Fatalf("SQLSTATE = %s, want 0A000", pgErr.Code)
	}
	if !strings.Contains(pgErr.Message, "COMMERCIAL_COST_WRITE_RETIRED") {
		t.Fatalf("message = %q, want COMMERCIAL_COST_WRITE_RETIRED", pgErr.Message)
	}
	if markup, mat, work := f.readCommercial(t); markup != 7 || mat != 8 || work != 9 {
		t.Fatalf("row mutated: %v/%v/%v, want 7/8/9", markup, mat, work)
	}
}

// ─── B. Failure is payload-independent (NULL especially: not STRICT) ─────────

func TestRetiredCommercialCostRPC_PayloadIndependentFailure(t *testing.T) {
	pool := newTestPool(t)
	f := setupRetiredRPC(t, pool)

	// A second tender's item for the cross-tender payload.
	var otherTender, otherPos, otherItem string
	ctx := context.Background()
	if err := f.tx.QueryRow(ctx, `INSERT INTO public.tenders (title, client_name, tender_number)
		VALUES ('itest-rpc2','itest-client','ITEST-RPC-2') RETURNING id::text`).Scan(&otherTender); err != nil {
		t.Fatalf("seed tender2: %v", err)
	}
	if err := f.tx.QueryRow(ctx, `INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 1, 'p') RETURNING id::text`, otherTender).Scan(&otherPos); err != nil {
		t.Fatalf("seed pos2: %v", err)
	}
	_, mnID := ensureTestNames(t, pool)
	if err := f.tx.QueryRow(ctx, `INSERT INTO public.boq_items
		(client_position_id, tender_id, boq_item_type, material_name_id, commercial_markup)
		VALUES ($1::uuid, $2::uuid, 'мат', $3::uuid, 42) RETURNING id::text`, otherPos, otherTender, mnID).Scan(&otherItem); err != nil {
		t.Fatalf("seed item2: %v", err)
	}

	payloads := map[string]string{
		"NULL":          `NULL::jsonb`,
		"empty array":   `'[]'::jsonb`,
		"empty object":  `'{}'::jsonb`,
		"valid rows":    `'[{"id":"` + f.itemID + `","commercial_markup":1}]'::jsonb`,
		"unknown id":    `'[{"id":"ffffffff-ffff-ffff-ffff-ffffffffffff","commercial_markup":1}]'::jsonb`,
		"cross-tender":  `'[{"id":"` + f.itemID + `"},{"id":"` + otherItem + `"}]'::jsonb`,
		"extreme value": `'[{"id":"` + f.itemID + `","commercial_markup":-1e308,"total_commercial_work_cost":1e308}]'::jsonb`,
	}
	for name, payload := range payloads {
		t.Run(name, func(t *testing.T) {
			pgErr := f.callRPC(t, payload)
			// Especially NULL: if the function were accidentally STRICT, the call
			// would return NULL "успешно" and callRPC would t.Fatal above.
			if pgErr.Code != "0A000" || !strings.Contains(pgErr.Message, "COMMERCIAL_COST_WRITE_RETIRED") {
				t.Fatalf("payload %s: SQLSTATE=%s message=%q", name, pgErr.Code, pgErr.Message)
			}
		})
	}
	if markup, mat, work := f.readCommercial(t); markup != 7 || mat != 8 || work != 9 {
		t.Fatalf("row mutated: %v/%v/%v, want 7/8/9", markup, mat, work)
	}
	var otherMarkup float64
	if err := f.tx.QueryRow(ctx,
		`SELECT commercial_markup FROM public.boq_items WHERE id=$1::uuid`, otherItem).Scan(&otherMarkup); err != nil {
		t.Fatalf("read item2: %v", err)
	}
	if otherMarkup != 42 {
		t.Fatalf("cross-tender row mutated: %v, want 42", otherMarkup)
	}
}

// ─── C+D. Security properties and ACL after the migration ────────────────────

func TestRetiredCommercialCostRPC_SecurityAndACL(t *testing.T) {
	pool := newTestPool(t)
	f := setupRetiredRPC(t, pool)
	ctx := context.Background()

	var secdef, isStrict bool
	var retType, def string
	if err := f.tx.QueryRow(ctx, `
		SELECT p.prosecdef, p.proisstrict, pg_get_function_result(p.oid), pg_get_functiondef(p.oid)
		FROM pg_proc p WHERE p.oid = $1::regprocedure`, retiredRPCSig,
	).Scan(&secdef, &isStrict, &retType, &def); err != nil {
		t.Fatalf("pg_proc: %v", err)
	}
	if secdef {
		t.Fatal("prosecdef = true — tombstone must be SECURITY INVOKER")
	}
	if isStrict {
		t.Fatal("proisstrict = true — NULL would bypass the tombstone body")
	}
	if retType != "integer" {
		t.Fatalf("return type = %q, want integer (compatible signature)", retType)
	}
	if !strings.Contains(def, "COMMERCIAL_COST_WRITE_RETIRED") {
		t.Fatal("definition lacks the retired marker")
	}
	if regexp.MustCompile(`(?i)UPDATE\s+(public\.)?boq_items`).MatchString(def) {
		t.Fatal("definition still contains the mutation body")
	}

	// Exactly one overload of this name must exist (no alternate-signature bypass).
	var overloads int
	if err := f.tx.QueryRow(ctx, `
		SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		WHERE n.nspname='public' AND p.proname='bulk_update_boq_items_commercial_costs'`,
	).Scan(&overloads); err != nil {
		t.Fatalf("overloads: %v", err)
	}
	if overloads != 1 {
		t.Fatalf("overloads = %d, want 1", overloads)
	}

	// ACL: PUBLIC has no EXECUTE; no non-owner grantees remain.
	var publicHas bool
	var nonOwner int
	if err := f.tx.QueryRow(ctx, `
		SELECT COALESCE(bool_or(a.grantee = 0), false),
		       COALESCE(count(*) FILTER (WHERE a.grantee <> 0 AND a.grantee <> p.proowner), 0)
		FROM pg_proc p
		LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl,'{}'::aclitem[])) a ON true
		WHERE p.oid = $1::regprocedure
		GROUP BY p.proowner`, retiredRPCSig,
	).Scan(&publicHas, &nonOwner); err != nil {
		t.Fatalf("acl: %v", err)
	}
	if publicHas {
		t.Fatal("PUBLIC still has a grant on the retired RPC")
	}
	if nonOwner != 0 {
		t.Fatalf("non-owner grantees remain: %d", nonOwner)
	}
	// CREATEROLE is not assumed on the test role, so an actual permission-denied
	// probe under a fresh non-owner role is NOT executed here (reported honestly);
	// owner invocation still fails closed:
	if pgErr := f.callRPC(t, `'[]'::jsonb`); pgErr.Code != "0A000" {
		t.Fatalf("owner invocation: SQLSTATE=%s, want 0A000", pgErr.Code)
	}
}

// ─── F. The internal writer path is unaffected by the retirement ─────────────

func TestRetiredCommercialCostRPC_InternalWriterUnaffected(t *testing.T) {
	pool := newTestPool(t)
	f := setupRetiredRPC(t, pool)

	n, err := PersistCalculatedCommercialCostsTx(context.Background(), f.tx, f.tenderID,
		[]CalculatedCommercialCostRow{{
			ID:                          f.itemID,
			CommercialMarkup:            1.5,
			TotalCommercialMaterialCost: 500,
			TotalCommercialWorkCost:     1000,
		}})
	if err != nil {
		t.Fatalf("internal writer failed after RPC retirement: %v", err)
	}
	if n != 1 {
		t.Fatalf("writer updated %d rows, want 1", n)
	}
	if markup, mat, work := f.readCommercial(t); markup != 1.5 || mat != 500 || work != 1000 {
		t.Fatalf("writer values = %v/%v/%v, want 1.5/500/1000", markup, mat, work)
	}
}
