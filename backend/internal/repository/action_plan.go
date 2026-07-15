package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/quality"
)

// ActionPlanRepo — read-only загрузка ВСЕХ трёх аналитических снапшотов
// (quality, price benchmark, price source) в ОДНОЙ REPEATABLE READ READ ONLY
// транзакции — Action Plan этапа 1.4 относится к одному согласованному срезу
// financial_input_revision. Никаких мутаций и никаких HTTP-вызовов
// собственных endpoints: переиспользуются те же load*SnapshotTx, что и у
// публичных endpoints трёх аналитик.
type ActionPlanRepo struct {
	pool *pgxpool.Pool
}

// NewActionPlanRepo creates an ActionPlanRepo.
func NewActionPlanRepo(pool *pgxpool.Pool) *ActionPlanRepo {
	return &ActionPlanRepo{pool: pool}
}

// ActionPlanSnapshots — три снапшота из одной транзакции.
type ActionPlanSnapshots struct {
	Quality   *quality.Snapshot
	Benchmark *BenchmarkSnapshot
	Source    *SourceSnapshot
}

// LoadSnapshots — фиксированное число запросов (5 quality + 3 benchmark +
// 2 source), не зависящее от количества строк/действий. Никакого N+1.
func (r *ActionPlanRepo) LoadSnapshots(
	ctx context.Context, tenderID string, periodMonths int,
) (*ActionPlanSnapshots, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("actionPlanRepo: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	out := &ActionPlanSnapshots{}
	if out.Quality, err = loadQualitySnapshotTx(ctx, tx, tenderID); err != nil {
		return nil, err // ErrQualityTenderNotFound → 404 в handler
	}
	if out.Benchmark, err = loadBenchmarkSnapshotTx(ctx, tx, tenderID, periodMonths); err != nil {
		return nil, err
	}
	if out.Source, err = loadSourceSnapshotTx(ctx, tx, tenderID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("actionPlanRepo: commit: %w", err)
	}
	return out, nil
}
