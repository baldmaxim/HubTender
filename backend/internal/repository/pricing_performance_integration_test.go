//go:build integration

package repository

import (
	"context"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/su10/hubtender/backend/internal/pricing"
)

// Run only against a disposable DB seeded by evaluation_fixture.sql plus a
// production-like noise set. It guards the indexed candidate-prefilter path.
func TestArchiveSearchP95WithLargeNoiseSet(t *testing.T) {
	if os.Getenv("RUN_MCP_PERF_TESTS") != "1" {
		t.Skip("RUN_MCP_PERF_TESTS is not set")
	}
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	repo := NewPricingRepo(pool)
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows < 100000 {
		t.Fatalf("noise set too small: %d", rows)
	}
	durations := make([]time.Duration, 0, 30)
	for i := 0; i < 30; i++ {
		start := time.Now()
		hits, err := repo.RawArchiveCandidates(ctx, pricing.ArchiveSearchInput{Query: "Мобильный пресс-компактор", Kind: "material", UnitCode: "шт"}, 500)
		if err != nil {
			t.Fatal(err)
		}
		if len(hits) == 0 {
			t.Fatal("expected fixture match")
		}
		durations = append(durations, time.Since(start))
	}
	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	p95 := durations[28]
	if p95 > 2*time.Second {
		t.Fatalf("archive search p95=%s exceeds 2s", p95)
	}
	stateDurations := make([]time.Duration, 0, 30)
	for i := 0; i < 30; i++ {
		start := time.Now()
		state, err := repo.GetPricingState(ctx, "eeeeeeee-8000-0000-0000-000000000002", 50, 0)
		if err != nil {
			t.Fatal(err)
		}
		if state.ItemCount < 100000 {
			t.Fatalf("pricing state item_count=%d", state.ItemCount)
		}
		stateDurations = append(stateDurations, time.Since(start))
	}
	sort.Slice(stateDurations, func(i, j int) bool { return stateDurations[i] < stateDurations[j] })
	stateP95 := stateDurations[28]
	if stateP95 > 3*time.Second {
		t.Fatalf("pricing state p95=%s exceeds 3s", stateP95)
	}
	t.Logf("rows=%d archive_search_p95=%s pricing_state_p95=%s", rows, p95, stateP95)
}
