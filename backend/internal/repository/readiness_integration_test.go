package repository

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	"github.com/su10/hubtender/backend/internal/readiness"
)

// PostgreSQL integration tests for stage 2.4 (§10-12/§18.23-28): readiness
// audit. Живут в repository-пакете, чтобы переиспользовать seed-хелперы.
// COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL.

func runReadiness(t *testing.T, tenderID string) *readiness.Report {
	t.Helper()
	pool := newTestPool(t)
	rep, err := readiness.Run(context.Background(), pool, readiness.Options{
		TenderID: tenderID, BatchSize: 50, CalculatingTimeout: 10 * time.Minute,
		IncludeMarkup: true, IncludeACL: true,
	})
	if err != nil {
		t.Fatalf("readiness: %v", err)
	}
	return rep
}

func checkByID(rep *readiness.Report, id string) *readiness.Check {
	for i := range rep.Checks {
		if rep.Checks[i].ID == id {
			return &rep.Checks[i]
		}
	}
	return nil
}

// §18.23: здоровый (свежерассчитанный) тендер — без blockers по своему scope.
func TestReadinessIntegration_HealthyTender(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, _ := seedSourceTender(t, pool, "RD-A")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "раб", "itest-shared-work", "м2", 10, 100, "RUB"},
	})
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), ia.Options{}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	rep := runReadiness(t, tenderID)
	for _, id := range []string{"stuck_calculating", "approved_not_current", "missing_fx",
		"cross_tender_position", "cross_scope_parent", "self_parent", "parent_non_work"} {
		c := checkByID(rep, id)
		if c == nil {
			t.Fatalf("check %s missing", id)
		}
		if c.Status == readiness.StatusBlocker {
			t.Fatalf("healthy tender must have no %s blocker: %+v", id, c)
		}
	}
	if c := checkByID(rep, "boq_total_mismatch"); c == nil || c.Count != 0 {
		t.Fatalf("healthy tender: boq mismatch=%+v", c)
	}
}

// §18.24-25: намеренно неконсистентный legacy-тендер выявляется, а не молча
// объявляется здоровым (approved+stale, зависший calculating, кривой total).
func TestReadinessIntegration_InconsistentLegacyTender(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, posID := seedSourceTender(t, pool, "RD-B")
	workNameID, _ := ensureTestNames(t, pool)

	// Кривой BOQ total + подвисший calculating + approved при stale-расчёте.
	var itemID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.boq_items
			(tender_id, client_position_id, boq_item_type, description, unit_code,
			 quantity, unit_rate, currency_type, total_amount, work_name_id)
		VALUES ($1::uuid, $2::uuid, 'раб', 'legacy', 'м2', 10, 100, 'RUB', 555555, $3::uuid)
		RETURNING id::text`, tenderID, posID, workNameID).Scan(&itemID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_status = 'calculating',
		    financial_calculation_started_at = NOW() - interval '3 hours',
		    financial_approved = true,
		    financial_input_revision = 5,
		    financial_calculation_revision = 3
		WHERE id = $1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}

	rep := runReadiness(t, tenderID)
	if rep.Blockers == 0 {
		t.Fatalf("inconsistent tender must produce blockers: %+v", rep.Checks)
	}
	if c := checkByID(rep, "stuck_calculating"); c == nil || c.Status != readiness.StatusBlocker {
		t.Fatalf("stuck calculating must be blocker: %+v", c)
	}
	if c := checkByID(rep, "approved_not_current"); c == nil || c.Status != readiness.StatusBlocker {
		t.Fatalf("approved stale must be blocker: %+v", c)
	}
	if c := checkByID(rep, "boq_total_mismatch"); c == nil || c.Count == 0 {
		t.Fatalf("boq mismatch must be reported: %+v", c)
	}
	// Redacted: в details только id+delta, без описаний.
	for _, d := range checkByID(rep, "boq_total_mismatch").Details {
		if strings.Contains(d, "legacy") {
			t.Fatalf("details must be redacted: %s", d)
		}
	}
}

// §18.26: markup backfill impact — тактика без multiplyFormat попадает в отчёт
// вместе со связанным тендером и статусами.
func TestReadinessIntegration_MarkupBackfillImpact(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, _ := seedSourceTender(t, pool, "RD-C")
	var tacticID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.markup_tactics (name, sequences)
		VALUES ('itest legacy tactic', '{"раб": [{"action1": "multiply", "operand1Type": "markup", "operand1Markup": "mp1"}]}'::jsonb)
		RETURNING id::text`).Scan(&tacticID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `UPDATE public.tenders SET markup_tactic_id = NULL WHERE markup_tactic_id = $1::uuid`, tacticID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.markup_tactics WHERE id = $1::uuid`, tacticID)
	})
	if _, err := pool.Exec(ctx, `UPDATE public.tenders SET markup_tactic_id = $1::uuid WHERE id = $2::uuid`,
		tacticID, tenderID); err != nil {
		t.Fatal(err)
	}

	mi, err := readiness.BuildMarkupImpact(ctx, pool)
	if err != nil {
		t.Fatalf("markup impact: %v", err)
	}
	foundTactic, foundTender := false, false
	for _, id := range mi.AffectedTactics {
		if id == tacticID {
			foundTactic = true
		}
	}
	for _, tr := range mi.Tenders {
		if tr.TenderID == tenderID {
			foundTender = true
		}
	}
	if !foundTactic || !foundTender {
		t.Fatalf("affected tactic/tender must be reported: tactic=%v tender=%v", foundTactic, foundTender)
	}
	for _, s := range mi.Slots {
		if s.TacticID == tacticID {
			if s.Planned != "addOne" || s.DiagnosticAddOne == s.DiagnosticDirect {
				t.Fatalf("slot diagnostics wrong: %+v", s)
			}
		}
	}
}

// §18.27: retired RPC ACL-верификация выдаёт статусы (safe/risk/unknown).
func TestReadinessIntegration_ACLReport(t *testing.T) {
	pool := newTestPool(t)
	findings, err := readiness.AuditACL(context.Background(), pool)
	if err != nil {
		t.Fatalf("acl: %v", err)
	}
	ids := map[string]bool{}
	for _, f := range findings {
		ids[f.ID] = true
		if f.Status != "CONFIRMED_SAFE" && f.Status != "CONFIRMED_RISK" && f.Status != "UNKNOWN" {
			t.Fatalf("invalid status: %+v", f)
		}
	}
	for _, want := range []string{"retired_rpc", "grand_total_triggers", "direct_table_grants", "postgrest_exposure"} {
		if !ids[want] {
			t.Fatalf("ACL finding %s missing: %+v", want, findings)
		}
	}
}

// §18.28: JSON детерминирован — два запуска на одних данных дают одинаковый
// fingerprint; generated_at не входит в fingerprint.
func TestReadinessIntegration_DeterministicJSON(t *testing.T) {
	pool := newTestPool(t)
	tenderID, _ := seedSourceTender(t, pool, "RD-D")
	run := func() *readiness.Report {
		rep, err := readiness.Run(context.Background(), pool, readiness.Options{
			TenderID: tenderID, CalculatingTimeout: 10 * time.Minute,
		})
		if err != nil {
			t.Fatalf("run: %v", err)
		}
		return rep
	}
	a, b := run(), run()
	if a.Fingerprint == "" || a.Fingerprint != b.Fingerprint {
		t.Fatalf("fingerprint must be deterministic: %s vs %s", a.Fingerprint, b.Fingerprint)
	}
	// JSON сериализуем и убеждаемся в отсутствии запрещённых полей.
	data, _ := json.Marshal(a)
	s := strings.ToLower(string(data))
	for _, bad := range []string{"client_name", "password", "jwt", "unit_rate_raw"} {
		if strings.Contains(s, bad) {
			t.Fatalf("json must be redacted, found %q", bad)
		}
	}
}
