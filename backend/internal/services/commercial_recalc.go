package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// CommercialRecalcService recomputes and materializes every BOQ item's
// commercial material/work cost (and commercial_markup) for a tender.
//
// It is the server-side, authoritative replacement for the frontend «Пересчитать»
// button. The math itself lives in ONE place —
// repository.ComputeCommercialRows (→ calc.CalculateBoqItemCost) — which is also
// what copy / version-transfer run INSIDE their own transaction. This service is
// the pool-based (own-connection) entry point; it must never be the only way a
// tender ends up with correct commercial values.
type CommercialRecalcService struct {
	compute commercialComputer
	bulk    calculatedCommercialWriter
	cache   *cache.InMem
}

// commercialComputer runs the authoritative commercial calculation for a tender
// on its own connection. Implemented by *repository.CommercialRepo.
type commercialComputer interface {
	ComputeCommercialRowsForTender(ctx context.Context, tenderID string) ([]repository.ComputedCommercialRow, error)
}

// calculatedCommercialWriter is the ONLY way commercial costs reach the DB.
// It is deliberately narrow and tender-scoped: a caller must name the tender it
// calculated, and the writer refuses to touch any other tender's rows.
// *repository.BulkBoqRepo satisfies it. No client-facing handler can reach it.
type calculatedCommercialWriter interface {
	PersistCalculatedCommercialCosts(
		ctx context.Context,
		tenderID string,
		rows []repository.CalculatedCommercialCostRow,
	) (int, error)
}

// NewCommercialRecalcService wires the repos the recalc reads/writes through.
func NewCommercialRecalcService(
	compute *repository.CommercialRepo,
	bulk *repository.BulkBoqRepo,
	c *cache.InMem,
) *CommercialRecalcService {
	return &CommercialRecalcService{compute: compute, bulk: bulk, cache: c}
}

// RecalcTender recomputes every item's commercial split and writes only the rows
// that actually changed. A tender with no markup tactic is left untouched.
func (s *CommercialRecalcService) RecalcTender(ctx context.Context, tenderID string) error {
	computed, err := s.compute.ComputeCommercialRowsForTender(ctx, tenderID)
	if err != nil {
		return fmt.Errorf("commercialRecalc: compute: %w", err)
	}

	// Only the rows whose values actually moved — keeps WS/cache churn down and
	// breaks any echo loop.
	changed := repository.ChangedCommercialRows(computed)

	return s.persistCalculated(ctx, tenderID, changed)
}

// persistCalculated writes the calculated result set for ONE tender and, only on
// success, evicts that tender's cache.
//
// Invariants (unit-tested):
//   - exactly ONE writer call per batch (never per row);
//   - the writer is always told which tender was calculated;
//   - an empty result set is a no-op (no write, no cache churn);
//   - on ANY writer error (e.g. exact-set mismatch) nothing was persisted, so the
//     cache is deliberately NOT invalidated and no success is reported.
func (s *CommercialRecalcService) persistCalculated(
	ctx context.Context,
	tenderID string,
	changed []repository.CalculatedCommercialCostRow,
) error {
	if len(changed) == 0 {
		return nil
	}

	// ONE writer call for the whole batch, explicitly scoped to THIS tender. The
	// writer validates the result set, refuses to touch other tenders' rows, and
	// rolls back atomically if the updated set != the calculated set (grand total
	// included — it is recomputed once inside that same tx).
	if _, err := s.bulk.PersistCalculatedCommercialCosts(ctx, tenderID, changed); err != nil {
		return fmt.Errorf("commercialRecalc: persist calculated commercial costs: %w", err)
	}

	// Only AFTER a successful commit: evict THIS tender's derived caches.
	s.cache.Delete("tender:overview:" + tenderID)
	s.cache.Delete("positions:with_costs:" + tenderID)

	return nil
}
