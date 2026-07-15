package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/quality"
)

// ReviewPackRepo — этап 1.6: ВСЕ аналитические снапшоты отчёта в ОДНОЙ
// REPEATABLE READ READ ONLY транзакции (quality, benchmark, source, change
// impact) + approval-метаданные. Никаких мутаций и HTTP-to-HTTP: те же
// load*SnapshotTx, что у собственных endpoints аналитик.
type ReviewPackRepo struct {
	pool *pgxpool.Pool
}

// NewReviewPackRepo creates a ReviewPackRepo.
func NewReviewPackRepo(pool *pgxpool.Pool) *ReviewPackRepo {
	return &ReviewPackRepo{pool: pool}
}

// ReviewPackSnapshot — согласованный срез одной financial_input_revision.
type ReviewPackSnapshot struct {
	Quality      *quality.Snapshot
	Benchmark    *BenchmarkSnapshot
	Source       *SourceSnapshot
	ChangeImpact *ChangeImpactSnapshot

	TenderLabel     string
	TenderNumber    string
	TenderVersion   int
	Approved        bool
	ApprovedByLabel string
	ApprovedAt      string
}

// LoadSnapshot — фиксированное число запросов (5+3+2 аналитик 1.1-1.3 +
// change impact + 1 approval/label), не зависящее от объёма данных.
func (r *ReviewPackRepo) LoadSnapshot(
	ctx context.Context, tenderID string, periodMonths int, baselineID string,
) (*ReviewPackSnapshot, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("reviewPackRepo: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	out := &ReviewPackSnapshot{}

	// Реквизиты + approval-метаданные (approved_by — display label, не ID).
	err = tx.QueryRow(ctx, `
		SELECT t.title, t.tender_number, COALESCE(t.version, 1),
		       t.financial_approved,
		       COALESCE(u.full_name, ''),
		       COALESCE(to_char(t.financial_approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
		FROM public.tenders t
		LEFT JOIN public.users u ON u.id = t.financial_approved_by
		WHERE t.id = $1::uuid
	`, tenderID).Scan(&out.TenderLabel, &out.TenderNumber, &out.TenderVersion,
		&out.Approved, &out.ApprovedByLabel, &out.ApprovedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQualityTenderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("reviewPackRepo: tender: %w", err)
	}

	if out.Quality, err = loadQualitySnapshotTx(ctx, tx, tenderID); err != nil {
		return nil, err
	}
	if out.Benchmark, err = loadBenchmarkSnapshotTx(ctx, tx, tenderID, periodMonths); err != nil {
		return nil, err
	}
	if out.Source, err = loadSourceSnapshotTx(ctx, tx, tenderID); err != nil {
		return nil, err
	}
	if out.ChangeImpact, err = loadChangeImpactSnapshotTx(ctx, tx, tenderID, baselineID); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("reviewPackRepo: commit: %w", err)
	}
	return out, nil
}
