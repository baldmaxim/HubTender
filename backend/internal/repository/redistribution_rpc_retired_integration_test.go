package repository

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

// Stage 0.1.2.3a (§18 I/J): the legacy SQL RPC save_redistribution_results is
// a fail-closed tombstone after the retirement migration, and the Go internal
// writer (SaveAuthoritative) is unaffected. Same conventions as the
// bulk_update_boq_items_commercial_costs retirement suite: DDL runs inside ONE
// rolled-back transaction; the migration's BEGIN;/COMMIT; are stripped for the
// in-transaction application.

const retiredRedisRPCSig = "public.save_redistribution_results(uuid, uuid, jsonb, jsonb, uuid)"

// legacyUnsafeRedisRPCDef is the PRE-0.1.2.3a writer definition (verbatim from
// the old db/yandex/sql/04_functions.sql) so the migration is exercised
// against a REAL old installation.
const legacyUnsafeRedisRPCDef = `
CREATE OR REPLACE FUNCTION public.save_redistribution_results(
  p_tender_id        uuid,
  p_markup_tactic_id uuid,
  p_records          jsonb,
  p_rules            jsonb,
  p_created_by       uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_holder uuid;
  v_count  integer;
BEGIN
  IF jsonb_array_length(p_records) = 0 THEN
    RETURN 0;
  END IF;

  SELECT (elem->>'boq_item_id')::uuid
    INTO v_holder
    FROM jsonb_array_elements(p_records) elem
   ORDER BY (elem->>'boq_item_id')::uuid
   LIMIT 1;

  UPDATE public.cost_redistribution_results
     SET redistribution_rules = NULL
   WHERE tender_id        = p_tender_id
     AND markup_tactic_id = p_markup_tactic_id
     AND redistribution_rules IS NOT NULL;

  DELETE FROM public.cost_redistribution_results
   WHERE tender_id        = p_tender_id
     AND markup_tactic_id = p_markup_tactic_id
     AND boq_item_id <> ALL (
           SELECT (elem->>'boq_item_id')::uuid
             FROM jsonb_array_elements(p_records) elem
         );

  INSERT INTO public.cost_redistribution_results (
    tender_id, markup_tactic_id, boq_item_id,
    original_work_cost, deducted_amount, added_amount, final_work_cost,
    redistribution_rules, created_by
  )
  SELECT p_tender_id,
         p_markup_tactic_id,
         (elem->>'boq_item_id')::uuid,
         NULLIF(elem->>'original_work_cost','')::numeric,
         COALESCE(NULLIF(elem->>'deducted_amount','')::numeric, 0),
         COALESCE(NULLIF(elem->>'added_amount','')::numeric, 0),
         NULLIF(elem->>'final_work_cost','')::numeric,
         CASE WHEN (elem->>'boq_item_id')::uuid = v_holder THEN p_rules ELSE NULL END,
         p_created_by
    FROM jsonb_array_elements(p_records) elem
  ON CONFLICT (tender_id, markup_tactic_id, boq_item_id) DO UPDATE SET
    original_work_cost   = EXCLUDED.original_work_cost,
    deducted_amount      = EXCLUDED.deducted_amount,
    added_amount         = EXCLUDED.added_amount,
    final_work_cost      = EXCLUDED.final_work_cost,
    redistribution_rules = EXCLUDED.redistribution_rules,
    updated_at           = NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END$$;
`

func readRedisRetirementMigration(t *testing.T) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "db", "yandex", "incremental",
		"2026_07_retire_save_redistribution_results.sql")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	return regexp.MustCompile(`(?m)^(BEGIN|COMMIT);\s*$`).ReplaceAllString(string(raw), "")
}

// ─── I. Tombstone blocks any payload; idempotent; ACL closed ─────────────────

func TestRetiredRedistributionRPC_TombstoneBlocksAllPayloads(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	// Real old installation → retirement migration, applied TWICE (idempotency).
	if _, err := tx.Exec(ctx, legacyUnsafeRedisRPCDef); err != nil {
		t.Fatalf("install legacy definition: %v", err)
	}
	mig := readRedisRetirementMigration(t)
	for i := 1; i <= 2; i++ {
		if _, err := tx.Exec(ctx, mig); err != nil {
			t.Fatalf("apply retirement migration (attempt %d): %v", i, err)
		}
	}

	var rowsBefore int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM public.cost_redistribution_results`).Scan(&rowsBefore); err != nil {
		t.Fatalf("count before: %v", err)
	}

	call := func(argsSQL string) *pgconn.PgError {
		sp, err := tx.Begin(ctx)
		if err != nil {
			t.Fatalf("savepoint: %v", err)
		}
		defer sp.Rollback(ctx) //nolint:errcheck
		var res *int
		err = sp.QueryRow(ctx, "SELECT public.save_redistribution_results("+argsSQL+")").Scan(&res)
		if err == nil {
			t.Fatalf("RPC call (%s) SUCCEEDED (returned %v) — tombstone missing", argsSQL, res)
		}
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) {
			t.Fatalf("RPC call (%s): expected PgError, got %v", argsSQL, err)
		}
		return pgErr
	}

	payloads := map[string]string{
		"valid old payload": `'11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid,
			'[{"boq_item_id":"33333333-3333-3333-3333-333333333333","original_work_cost":777,"final_work_cost":-123}]'::jsonb,
			'{"deductions":[]}'::jsonb, NULL::uuid`,
		"NULL records":  `NULL::uuid, NULL::uuid, NULL::jsonb, NULL::jsonb, NULL::uuid`,
		"empty records": `'11111111-1111-1111-1111-111111111111'::uuid, '22222222-2222-2222-2222-222222222222'::uuid, '[]'::jsonb, '{}'::jsonb, NULL::uuid`,
	}
	for name, args := range payloads {
		t.Run(name, func(t *testing.T) {
			pgErr := call(args)
			if pgErr.Code != "0A000" {
				t.Fatalf("SQLSTATE = %s, want 0A000", pgErr.Code)
			}
			if !strings.Contains(pgErr.Message, "REDISTRIBUTION_RESULT_WRITE_RETIRED") {
				t.Fatalf("message = %q", pgErr.Message)
			}
		})
	}

	var rowsAfter int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM public.cost_redistribution_results`).Scan(&rowsAfter); err != nil {
		t.Fatalf("count after: %v", err)
	}
	if rowsAfter != rowsBefore {
		t.Fatalf("cost_redistribution_results changed: %d → %d", rowsBefore, rowsAfter)
	}

	// Security properties + ACL after the migration.
	var secdef, isStrict bool
	var def string
	if err := tx.QueryRow(ctx, `
		SELECT p.prosecdef, p.proisstrict, pg_get_functiondef(p.oid)
		FROM pg_proc p WHERE p.oid = $1::regprocedure`, retiredRedisRPCSig,
	).Scan(&secdef, &isStrict, &def); err != nil {
		t.Fatalf("pg_proc: %v", err)
	}
	if secdef || isStrict {
		t.Fatalf("prosecdef=%v proisstrict=%v — want false/false", secdef, isStrict)
	}
	if !strings.Contains(def, "REDISTRIBUTION_RESULT_WRITE_RETIRED") ||
		regexp.MustCompile(`(?i)INSERT\s+INTO\s+(public\.)?cost_redistribution_results`).MatchString(def) {
		t.Fatal("definition is not a pure tombstone")
	}
	var publicHas bool
	var nonOwner int
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(bool_or(a.grantee = 0), false),
		       COALESCE(count(*) FILTER (WHERE a.grantee <> 0 AND a.grantee <> p.proowner), 0)
		FROM pg_proc p
		LEFT JOIN LATERAL aclexplode(COALESCE(p.proacl,'{}'::aclitem[])) a ON true
		WHERE p.oid = $1::regprocedure
		GROUP BY p.proowner`, retiredRedisRPCSig,
	).Scan(&publicHas, &nonOwner); err != nil {
		t.Fatalf("acl: %v", err)
	}
	if publicHas || nonOwner != 0 {
		t.Fatalf("ACL not closed: public=%v nonOwner=%d", publicHas, nonOwner)
	}
}

// ─── J. The Go internal writer is unaffected by the retired RPC ──────────────
//
// Applies the tombstone migration COMMITTED (idempotent; the intended end
// state of any DB) and verifies that SaveAuthoritative still persists — the
// internal writer never used the RPC.
func TestRedistributionSave_WorksWithRetiredRPC(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()

	raw, err := os.ReadFile(filepath.Join("..", "..", "..", "db", "yandex", "incremental",
		"2026_07_retire_save_redistribution_results.sql"))
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(raw)); err != nil {
		t.Fatalf("apply retirement migration: %v", err)
	}
	// The RPC now fails closed…
	var res *int
	err = pool.QueryRow(ctx,
		`SELECT public.save_redistribution_results(NULL::uuid,NULL::uuid,NULL::jsonb,NULL::jsonb,NULL::uuid)`,
	).Scan(&res)
	var pgErr *pgconn.PgError
	if err == nil || !errors.As(err, &pgErr) || pgErr.Code != "0A000" {
		t.Fatalf("retired RPC must raise 0A000, got %v", err)
	}

	// …while the internal Go writer keeps working.
	f := seedRedistributionFixture(t, pool, "postrpc", nil)
	f.seedTwoItems(t, pool)
	repo := NewRedistributionRepo(pool)
	out, err := repo.SaveAuthoritative(ctx, f.tenderID, f.tacticID, f.d1toD2Rules(), rbActor)
	if err != nil {
		t.Fatalf("internal writer failed after RPC retirement: %v", err)
	}
	if out.SavedCount != 2 {
		t.Fatalf("saved_count = %d, want 2", out.SavedCount)
	}
	if rows := readRdRows(t, pool, f.tenderID, f.tacticID); len(rows) != 2 {
		t.Fatalf("persisted rows = %d, want 2", len(rows))
	}
}
