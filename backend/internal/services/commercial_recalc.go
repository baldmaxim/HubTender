package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// CommercialRecalcService recomputes and materializes every BOQ item's
// commercial material/work cost (and commercial_markup) for a tender.
//
// Stage 0-F2: the actual pipeline lives in
// repository.RecalcTenderCommercialAuthoritative — ONE REPEATABLE READ
// transaction guarded by a per-tender advisory lock and finished with a
// compare-and-set on financial_input_revision. Consequences:
//
//   - two concurrent recalcs of one tender serialize across processes; the
//     second sees the fresh revision and no-ops;
//   - an OLD calculation can never overwrite NEWER inputs: a CAS miss rolls
//     back every derived write of that run (stale_requeue outcome);
//   - the cache is evicted ONLY after a successful authoritative commit —
//     a rolled-back stale run leaves the cache untouched.
type CommercialRecalcService struct {
	pool    *pgxpool.Pool
	cache   *cache.InMem
	requeue Enqueuer // re-enqueue latest revision after a stale_requeue outcome
	// run is repository.RecalcTenderCommercialAuthoritative; injectable for
	// service-level unit tests (cache/requeue side-effects).
	run func(ctx context.Context, pool *pgxpool.Pool, tenderID string) (repository.CommercialRecalcOutcome, error)
}

// NewCommercialRecalcService wires the pool the authoritative recalc runs on.
func NewCommercialRecalcService(pool *pgxpool.Pool, c *cache.InMem) *CommercialRecalcService {
	return &CommercialRecalcService{pool: pool, cache: c, run: repository.RecalcTenderCommercialAuthoritative}
}

// WithRequeue wires the queue used to re-enqueue the LATEST revision when a
// run finished for inputs that changed mid-flight.
func (s *CommercialRecalcService) WithRequeue(q Enqueuer) *CommercialRecalcService {
	s.requeue = q
	return s
}

// RecalcTender runs one authoritative background recalc for the tender.
func (s *CommercialRecalcService) RecalcTender(ctx context.Context, tenderID string) error {
	outcome, err := s.run(ctx, s.pool, tenderID)
	if err != nil {
		var stale *repository.StaleCalculationResultError
		if errors.As(err, &stale) {
			// Inputs moved on while we calculated: everything rolled back.
			// Requeue the latest revision; this is NOT a user-facing error and
			// the cache is deliberately NOT evicted (nothing was committed).
			log.Info().Str("tender_id", tenderID).
				Int64("stale_revision", stale.CalculatedRevision).
				Msg("commercial recalc superseded by newer inputs — requeueing latest revision")
			if s.requeue != nil {
				s.requeue.Enqueue(tenderID)
			}
			return nil
		}
		return fmt.Errorf("commercialRecalc: %w", err)
	}

	if outcome == repository.RecalcOutcomeCalculated {
		// Only AFTER a successful authoritative commit: evict derived caches.
		s.cache.Delete("tender:overview:" + tenderID)
		s.cache.Delete("positions:with_costs:" + tenderID)
		s.cache.DeleteByPrefix(tenderListKeyPrefix)
	}
	return nil
}
