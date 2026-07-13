package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Querier is the read/write surface shared by *pgxpool.Pool and pgx.Tx.
//
// It exists so the authoritative commercial recalculation can run EITHER on its
// own connection (the public CommercialRecalcService.RecalcTender path) OR inside
// an already-open transaction (copy / version transfer), reading the rows that
// transaction has just written but not yet committed.
//
// Without it, a pool-based loader inside an open tx would not see the uncommitted
// target rows, and copy/transfer could not compute authoritative values before
// commit.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}
