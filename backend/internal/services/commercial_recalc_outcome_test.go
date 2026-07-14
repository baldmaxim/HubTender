package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0-F2 §12.19/20: the service tail of the authoritative recalc —
// cache eviction ONLY after a committed 'calculated' outcome; a stale
// (rolled-back) run evicts nothing and re-enqueues the latest revision.

func seedRecalcCaches(c *cache.InMem, tenderID string) {
	c.Set("tender:overview:"+tenderID, "ov", time.Minute)
	c.Set("positions:with_costs:"+tenderID, "pos", time.Minute)
	c.Set(tenderListKeyPrefix+"u|q", "list", time.Minute)
}

func recalcSvcWith(outcome repository.CommercialRecalcOutcome, err error) (*CommercialRecalcService, *cache.InMem, *fakeEnqueuer) {
	c := cache.New()
	q := &fakeEnqueuer{}
	svc := &CommercialRecalcService{
		cache:   c,
		requeue: q,
		run: func(context.Context, *pgxpool.Pool, string) (repository.CommercialRecalcOutcome, error) {
			return outcome, err
		},
	}
	return svc, c, q
}

func TestRecalcTender_CalculatedEvictsCache(t *testing.T) {
	svc, c, q := recalcSvcWith(repository.RecalcOutcomeCalculated, nil)
	seedRecalcCaches(c, "t1")
	if err := svc.RecalcTender(context.Background(), "t1"); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if _, ok := c.Get("tender:overview:t1"); ok {
		t.Fatal("overview cache must be evicted after a committed recalc")
	}
	if _, ok := c.Get("positions:with_costs:t1"); ok {
		t.Fatal("positions cache must be evicted after a committed recalc")
	}
	if len(q.enqueued) != 0 {
		t.Fatalf("committed recalc must not requeue, got %v", q.enqueued)
	}
}

func TestRecalcTender_NoOpKeepsCache(t *testing.T) {
	svc, c, q := recalcSvcWith(repository.RecalcOutcomeNoOp, nil)
	seedRecalcCaches(c, "t1")
	if err := svc.RecalcTender(context.Background(), "t1"); err != nil {
		t.Fatalf("recalc: %v", err)
	}
	if _, ok := c.Get("tender:overview:t1"); !ok {
		t.Fatal("a no-op recalc must not churn the cache")
	}
	if len(q.enqueued) != 0 {
		t.Fatalf("no-op must not requeue, got %v", q.enqueued)
	}
}

// §12.20 — a stale (superseded) run rolled everything back: cache untouched,
// latest revision re-enqueued, NOT reported as a user-facing error.
func TestRecalcTender_StaleResultRequeuesWithoutCacheEviction(t *testing.T) {
	staleErr := &repository.StaleCalculationResultError{TenderID: "t1", CalculatedRevision: 3}
	svc, c, q := recalcSvcWith(repository.RecalcOutcomeStaleRequeue, staleErr)
	seedRecalcCaches(c, "t1")
	if err := svc.RecalcTender(context.Background(), "t1"); err != nil {
		t.Fatalf("stale outcome must not surface as an error, got %v", err)
	}
	if _, ok := c.Get("tender:overview:t1"); !ok {
		t.Fatal("stale run must NOT evict the cache (nothing was committed)")
	}
	if len(q.enqueued) != 1 || q.enqueued[0] != "t1" {
		t.Fatalf("latest revision must be re-enqueued, got %v", q.enqueued)
	}
}

func TestRecalcTender_RealFailurePropagatesWithoutEviction(t *testing.T) {
	svc, c, q := recalcSvcWith("", errors.New("COMMERCIAL_RECALC_FAILED: boom"))
	seedRecalcCaches(c, "t1")
	if err := svc.RecalcTender(context.Background(), "t1"); err == nil {
		t.Fatal("real failure must propagate")
	}
	if _, ok := c.Get("tender:overview:t1"); !ok {
		t.Fatal("failed run must not evict the cache")
	}
	if len(q.enqueued) != 0 {
		t.Fatalf("failed run must not blind-requeue, got %v", q.enqueued)
	}
}
