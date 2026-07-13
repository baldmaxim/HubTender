package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// spyWriter records every call to the internal commercial writer.
type spyWriter struct {
	calls     int
	tenderIDs []string
	rowCounts []int
	err       error
}

func (s *spyWriter) PersistCalculatedCommercialCosts(
	_ context.Context,
	tenderID string,
	rows []repository.CalculatedCommercialCostRow,
) (int, error) {
	s.calls++
	s.tenderIDs = append(s.tenderIDs, tenderID)
	s.rowCounts = append(s.rowCounts, len(rows))
	if s.err != nil {
		return 0, s.err
	}
	return len(rows), nil
}

// These tests drive the REAL production tail of RecalcTender
// (CommercialRecalcService.persistCalculated) through a spy writer. The read half
// of RecalcTender needs concrete repos + a DB, so the writer/cache contract is
// asserted at this boundary.

func calcRows(n int) []repository.CalculatedCommercialCostRow {
	rows := make([]repository.CalculatedCommercialCostRow, n)
	for i := range rows {
		rows[i] = repository.CalculatedCommercialCostRow{
			ID: "row", CommercialMarkup: 1, TotalCommercialMaterialCost: 1, TotalCommercialWorkCost: 1,
		}
	}
	return rows
}

// 11 + 14 + 15. The writer is called ONCE per batch, with THIS tender's id, and
// the grand-total path is not driven per row (one call carries all rows).
func TestRecalc_WriterCalledOncePerBatchWithTenderID(t *testing.T) {
	const tenderID = "tender-A"
	w := &spyWriter{}
	svc := &CommercialRecalcService{bulk: w, cache: cache.New()}

	if err := svc.persistCalculated(context.Background(), tenderID, calcRows(5)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if w.calls != 1 {
		t.Fatalf("writer calls = %d, want exactly 1 per batch (no per-row writes)", w.calls)
	}
	if w.tenderIDs[0] != tenderID {
		t.Fatalf("writer got tenderID %q, want %q", w.tenderIDs[0], tenderID)
	}
	if w.rowCounts[0] != 5 {
		t.Fatalf("writer got %d rows, want all 5 in one call", w.rowCounts[0])
	}
}

// 13. On success only THIS tender's cache keys are evicted.
func TestRecalc_SuccessEvictsOnlyThisTendersCache(t *testing.T) {
	const tenderID = "tender-A"
	const otherID = "tender-B"

	c := cache.New()
	c.Set("tender:overview:"+tenderID, "A", time.Minute)
	c.Set("positions:with_costs:"+tenderID, "A", time.Minute)
	c.Set("tender:overview:"+otherID, "B", time.Minute)
	c.Set("positions:with_costs:"+otherID, "B", time.Minute)

	svc := &CommercialRecalcService{bulk: &spyWriter{}, cache: c}
	if err := svc.persistCalculated(context.Background(), tenderID, calcRows(1)); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if _, ok := c.Get("tender:overview:" + tenderID); ok {
		t.Error("this tender's overview cache should be evicted on success")
	}
	if _, ok := c.Get("positions:with_costs:" + tenderID); ok {
		t.Error("this tender's positions cache should be evicted on success")
	}
	if _, ok := c.Get("tender:overview:" + otherID); !ok {
		t.Error("another tender's cache must NOT be evicted")
	}
	if _, ok := c.Get("positions:with_costs:" + otherID); !ok {
		t.Error("another tender's cache must NOT be evicted")
	}
}

// 12. On a writer error (e.g. exact-set mismatch) the cache is NOT invalidated —
// the DB is unchanged, so the cached values are still correct.
func TestRecalc_WriterErrorDoesNotInvalidateCache(t *testing.T) {
	const tenderID = "tender-A"

	c := cache.New()
	c.Set("tender:overview:"+tenderID, "A", time.Minute)
	c.Set("positions:with_costs:"+tenderID, "A", time.Minute)

	mismatch := &repository.CommercialResultSetMismatchError{TenderID: tenderID, Expected: 3, Updated: 2}
	svc := &CommercialRecalcService{bulk: &spyWriter{err: mismatch}, cache: c}

	err := svc.persistCalculated(context.Background(), tenderID, calcRows(3))

	var me *repository.CommercialResultSetMismatchError
	if !errors.As(err, &me) {
		t.Fatalf("expected CommercialResultSetMismatchError, got %v", err)
	}
	if _, ok := c.Get("tender:overview:" + tenderID); !ok {
		t.Error("cache must NOT be invalidated when the write failed")
	}
	if _, ok := c.Get("positions:with_costs:" + tenderID); !ok {
		t.Error("cache must NOT be invalidated when the write failed")
	}
}

// An empty calculated set is a no-op: no writer call, no cache churn.
func TestRecalc_EmptySetIsNoOp(t *testing.T) {
	const tenderID = "tender-A"
	c := cache.New()
	c.Set("tender:overview:"+tenderID, "A", time.Minute)

	w := &spyWriter{}
	svc := &CommercialRecalcService{bulk: w, cache: c}

	if err := svc.persistCalculated(context.Background(), tenderID, nil); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if w.calls != 0 {
		t.Fatalf("writer must not be called for an empty set, got %d calls", w.calls)
	}
	if _, ok := c.Get("tender:overview:" + tenderID); !ok {
		t.Error("cache must not be evicted when nothing changed")
	}
}
