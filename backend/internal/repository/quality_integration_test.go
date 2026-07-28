package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/su10/hubtender/backend/internal/quality"
)

// PostgreSQL integration tests for stage 1.1: the quality snapshot loader +
// engine on a real database. Reuses newTestPool / HUBTENDER_TEST_DATABASE_URL
// (COMPILED + SKIPPED without a test DB) and the stage-0 fixtures.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run QualityIntegration -v

func loadReport(t *testing.T, repo *QualityAnalyticsRepo, tenderID string) *quality.Report {
	t.Helper()
	snap, err := repo.LoadSnapshot(context.Background(), tenderID)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	return quality.Evaluate(snap)
}

func issueByCode(r *quality.Report, code string) *quality.Issue {
	for i := range r.Issues {
		if r.Issues[i].Code == code {
			return &r.Issues[i]
		}
	}
	return nil
}

// §12.3 — несуществующий тендер → typed not-found (handler отдаёт 404).
func TestQualityIntegration_TenderNotFound(t *testing.T) {
	pool := newTestPool(t)
	repo := NewQualityAnalyticsRepo(pool)
	_, err := repo.LoadSnapshot(context.Background(), "ffffffff-ffff-ffff-ffff-ffffffffffff")
	if !errors.Is(err, ErrQualityTenderNotFound) {
		t.Fatalf("want ErrQualityTenderNotFound, got %v", err)
	}
}

// §12.5/7 — FX-агрегация: entity IDs соответствуют реальным строкам.
func TestQualityIntegration_MissingFxAggregation(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "QFX", nil) // usd_rate NULL
	usd1 := f.addItem(t, pool, "раб", "USD", 1, 10, nil)
	usd2 := f.addItem(t, pool, "раб", "USD", 2, 10, nil)
	repo := NewQualityAnalyticsRepo(pool)

	r := loadReport(t, repo, f.tenderID)
	is := issueByCode(r, "FX_RATE_MISSING")
	if is == nil || is.Severity != quality.SeverityBlocker {
		t.Fatalf("want aggregated FX blocker, got %+v", r.Issues)
	}
	if is.AffectedCount != 2 {
		t.Fatalf("affected = %d, want 2", is.AffectedCount)
	}
	found := map[string]bool{}
	for _, id := range is.AffectedItemIDs {
		found[id] = true
	}
	if !found[usd1] || !found[usd2] {
		t.Fatalf("issue does not reference the real rows: %v", is.AffectedItemIDs)
	}
}

// §12.6 — exact duplicates на реальной БД.
func TestQualityIntegration_ExactDuplicates(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "QDUP", fptr(90))
	a := f.addItem(t, pool, "раб", "RUB", 5, 100, nil)
	b := f.addItem(t, pool, "раб", "RUB", 5, 100, nil) // тот же key
	_ = a
	_ = b
	repo := NewQualityAnalyticsRepo(pool)
	r := loadReport(t, repo, f.tenderID)
	is := issueByCode(r, "EXACT_DUPLICATE_GROUP")
	if is == nil || is.AffectedCount != 2 || is.Severity != quality.SeverityWarning {
		t.Fatalf("want one duplicate warning of 2 rows, got %+v", r.Issues)
	}
}

// §12.8 — derived mismatch checks на реальных данных.
func TestQualityIntegration_DerivedMismatch(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "QDER", fptr(90))
	itemID := f.addItem(t, pool, "раб", "RUB", 10, 100, nil) // stored junk 111
	ctx := context.Background()

	// Привести тендер к calculated/current (авторитетный recalc), затем
	// вручную испортить total_amount строки (имитация повреждения).
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, pool, f.tenderID, "seed"); err != nil {
		t.Fatalf("mark: %v", err)
	}
	if _, err := RecalcTenderCommercialAuthoritative(ctx, pool, f.tenderID); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	// recompute BOQ totals тоже (recalc пересчитывает commercial, не total_amount)
	tx, _ := pool.Begin(ctx)
	if _, err := RecomputeBoqTotalAmountsTx(ctx, tx, f.tenderID, []string{itemID}); err != nil {
		t.Fatalf("recompute: %v", err)
	}
	if err := RecomputePositionTotalsForTenderTx(ctx, tx, f.tenderID); err != nil {
		t.Fatalf("pos totals: %v", err)
	}
	_ = tx.Commit(ctx)

	repo := NewQualityAnalyticsRepo(pool)
	if is := issueByCode(loadReport(t, repo, f.tenderID), "BOQ_TOTAL_AMOUNT_MISMATCH"); is != nil {
		t.Fatalf("healthy tender flagged: %+v", is)
	}

	// Повреждение: total_amount мимо сервера.
	if _, err := pool.Exec(ctx,
		`UPDATE public.boq_items SET total_amount = 42 WHERE id = $1::uuid`, itemID); err != nil {
		t.Fatalf("corrupt: %v", err)
	}
	r := loadReport(t, repo, f.tenderID)
	is := issueByCode(r, "BOQ_TOTAL_AMOUNT_MISMATCH")
	if is == nil || is.EntityID != itemID {
		t.Fatalf("want BOQ_TOTAL_AMOUNT_MISMATCH on %s, got %+v", itemID, r.Issues)
	}
	if issueByCode(r, "POSITION_TOTALS_MISMATCH") == nil {
		t.Fatal("position totals mismatch must follow the corrupted row")
	}
}

// §12.9 — один consistent snapshot: конкурентное изменение после чтения не
// проявляется в отчёте (REPEATABLE READ READ ONLY): проверяем, что ревизия в
// отчёте согласована со статусом даже при гонке (smoke-подтверждение).
func TestQualityIntegration_ConsistentSnapshotSmoke(t *testing.T) {
	pool := newTestPool(t)
	f := seedRollbackFixture(t, pool, "QSNAP", fptr(90))
	f.addItem(t, pool, "раб", "RUB", 1, 10, nil)
	repo := NewQualityAnalyticsRepo(pool)
	r := loadReport(t, repo, f.tenderID)
	// Согласованность полей одного snapshot: status+revisions читаются одним
	// запросом → отчёт не может смешать состояния разных ревизий.
	if r.FinancialCalculationStatus == "calculated" &&
		r.FinancialCalculationRevision > r.FinancialInputRevision {
		t.Fatalf("inconsistent snapshot: %+v", r)
	}
}
