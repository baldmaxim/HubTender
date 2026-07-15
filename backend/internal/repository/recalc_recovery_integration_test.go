package repository

import (
	"context"
	"testing"
	"time"

	ia "github.com/su10/hubtender/backend/internal/importanalysis"
)

// PostgreSQL integration tests for stage 2.4 (§4/§18): recovery потерянных
// enqueue и зависших calculating. COMPILED + SKIPPED без
// HUBTENDER_TEST_DATABASE_URL.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run RecalcRecoveryIntegration -v

// §18.1: mutation commit прошёл, enqueue потерян → кандидат виден скану, а
// реальный authoritative recalc доводит тендер до calculated (startup recovery
// после «рестарта» — §4.1/§4.11).
func TestRecalcRecoveryIntegration_LostEnqueue(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, _ := seedSourceTender(t, pool, "RC-A")

	// Мутация без enqueue: импорт строки (WithTenderFinancialMutationTx внутри
	// BulkImport-контура выполняет bump→stale), «процесс умер» до Enqueue.
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "раб", "itest-shared-work", "м2", 10, 100, "RUB"},
	})
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), ia.Options{}); err != nil {
		t.Fatalf("seed import: %v", err)
	}
	// smartExecute-зеркало не enqueue'ит recalc — состояние ровно «потерянный
	// enqueue»: status=stale, cached total не является успехом (§2.A).
	var status string
	_ = pool.QueryRow(ctx, `SELECT financial_calculation_status FROM public.tenders WHERE id=$1::uuid`, tenderID).Scan(&status)
	if status != "stale" {
		t.Fatalf("precondition: status=%s, want stale", status)
	}

	// Recovery-скан находит кандидата.
	cands, err := ListRecalcRecoveryCandidates(ctx, pool, 10*time.Minute, "", 500)
	if err != nil {
		t.Fatalf("candidates: %v", err)
	}
	found := false
	for _, c := range cands {
		if c.TenderID == tenderID && c.Status == "stale" {
			found = true
		}
	}
	if !found {
		t.Fatalf("lost-enqueue tender must be a recovery candidate: %+v", cands)
	}

	// «Enqueue» → настоящий authoritative recalc → calculated (rev==rev).
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	var inputRev, calcRev int64
	_ = pool.QueryRow(ctx, `
		SELECT financial_input_revision, financial_calculation_revision
		FROM public.tenders WHERE id=$1::uuid`, tenderID).Scan(&inputRev, &calcRev)
	if inputRev != calcRev {
		t.Fatalf("recovered tender must be calculated: %d != %d", inputRev, calcRev)
	}
	// §4.9: calculated/current больше не кандидат.
	cands2, _ := ListRecalcRecoveryCandidates(ctx, pool, 10*time.Minute, "", 500)
	for _, c := range cands2 {
		if c.TenderID == tenderID {
			t.Fatalf("calculated tender must not be a candidate: %+v", c)
		}
	}
}

// §18.2: воркер умер после claim → status calculating висит; timeout истёк,
// lock свободен → reclaim переводит в stale (CAS) и тендер снова считается.
func TestRecalcRecoveryIntegration_StuckCalculatingReclaimed(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, _ := seedSourceTender(t, pool, "RC-B")

	// Эмуляция crash после claim: status=calculating, started_at давно.
	if _, err := pool.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_status='calculating',
		    financial_calculation_started_at = NOW() - interval '2 hours'
		WHERE id=$1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}

	// §4.4: свежий calculating (не старше timeout) кандидатом НЕ является.
	fresh, _ := ListRecalcRecoveryCandidates(ctx, pool, 3*time.Hour, "", 500)
	for _, c := range fresh {
		if c.TenderID == tenderID {
			t.Fatalf("calculating younger than timeout must not be candidate: %+v", c)
		}
	}

	// Старше timeout → кандидат; reclaim (lock свободен) → stale.
	cands, _ := ListRecalcRecoveryCandidates(ctx, pool, 10*time.Minute, "", 500)
	seen := false
	for _, c := range cands {
		if c.TenderID == tenderID && c.Status == "calculating" && c.AgeSeconds > 3600 {
			seen = true
		}
	}
	if !seen {
		t.Fatalf("expired calculating must be candidate: %+v", cands)
	}
	reclaimed, err := ReclaimStuckCalculating(ctx, pool, tenderID, 10*time.Minute)
	if err != nil || !reclaimed {
		t.Fatalf("reclaim: %v %v", reclaimed, err)
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT financial_calculation_status FROM public.tenders WHERE id=$1::uuid`, tenderID).Scan(&status)
	if status != "stale" {
		t.Fatalf("reclaimed status=%s, want stale", status)
	}
	// §4.7: повторный reclaim (дубль-скан) — безопасный no-op.
	again, err := ReclaimStuckCalculating(ctx, pool, tenderID, 10*time.Minute)
	if err != nil || again {
		t.Fatalf("duplicate reclaim must no-op: %v %v", again, err)
	}
}

// §18.3/§4.5: advisory lock реально удерживается «живым воркером» → recovery
// не вмешивается, даже если started_at старше timeout.
func TestRecalcRecoveryIntegration_AdvisoryLockHeld(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, _ := seedSourceTender(t, pool, "RC-C")
	if _, err := pool.Exec(ctx, `
		UPDATE public.tenders
		SET financial_calculation_status='calculating',
		    financial_calculation_started_at = NOW() - interval '2 hours'
		WHERE id=$1::uuid`, tenderID); err != nil {
		t.Fatal(err)
	}

	// «Живой воркер»: session advisory lock на выделенном соединении.
	holder, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(ctx, `SELECT pg_advisory_lock($1, hashtext($2))`,
		42001, tenderID); err != nil {
		holder.Release()
		t.Fatal(err)
	}
	reclaimed, err := ReclaimStuckCalculating(ctx, pool, tenderID, 10*time.Minute)
	if err != nil {
		t.Fatalf("reclaim err: %v", err)
	}
	if reclaimed {
		t.Fatal("recovery must not touch tender while worker holds the lock")
	}
	var status string
	_ = pool.QueryRow(ctx, `SELECT financial_calculation_status FROM public.tenders WHERE id=$1::uuid`, tenderID).Scan(&status)
	if status != "calculating" {
		t.Fatalf("status must stay calculating, got %s", status)
	}
	// Воркер «завершился» — lock освобождён; теперь reclaim срабатывает.
	if _, err := holder.Exec(ctx, `SELECT pg_advisory_unlock($1, hashtext($2))`, 42001, tenderID); err != nil {
		t.Fatal(err)
	}
	holder.Release()
	reclaimed, err = ReclaimStuckCalculating(ctx, pool, tenderID, 10*time.Minute)
	if err != nil || !reclaimed {
		t.Fatalf("after unlock reclaim must succeed: %v %v", reclaimed, err)
	}
}

// §4.8: ревизия ушла вперёд во время recovery — устаревший расчёт НЕ помечает
// новые входы calculated (CAS воркера), recovery-скан подхватит свежий stale.
func TestRecalcRecoveryIntegration_RevisionMovedDuringRecovery(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, _ := seedSourceTender(t, pool, "RC-D")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "раб", "itest-shared-work", "м2", 5, 10, "RUB"},
	})
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), ia.Options{}); err != nil {
		t.Fatalf("seed: %v", err)
	}
	var revBefore int64
	_ = pool.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders WHERE id=$1::uuid`, tenderID).Scan(&revBefore)

	// Recovery увидел stale → «enqueue»; до запуска воркера входы изменились.
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, pool, tenderID, "test_mutation"); err != nil {
		t.Fatal(err)
	}
	// Воркер (эмуляция recovery-enqueue) считает УЖЕ свежую ревизию — CAS
	// гарантирует, что calculated соответствует текущему input_revision.
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	var inputRev, calcRev int64
	var status string
	_ = pool.QueryRow(ctx, `
		SELECT financial_input_revision, financial_calculation_revision, financial_calculation_status
		FROM public.tenders WHERE id=$1::uuid`, tenderID).Scan(&inputRev, &calcRev, &status)
	if status != "calculated" || calcRev != inputRev || calcRev <= revBefore {
		t.Fatalf("stale revision must never be marked calculated: rev=%d calc=%d status=%s", inputRev, calcRev, status)
	}
}

// Health snapshot: счётчики без финансовых данных.
func TestRecalcRecoveryIntegration_HealthSnapshot(t *testing.T) {
	pool := newTestPool(t)
	snap, err := ReadRecalcHealthSnapshot(context.Background(), pool)
	if err != nil {
		t.Fatalf("health: %v", err)
	}
	if snap.StaleCount < 0 || snap.CalculatingCount < 0 {
		t.Fatalf("counts must be non-negative: %+v", snap)
	}
}
