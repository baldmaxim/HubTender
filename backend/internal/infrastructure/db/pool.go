package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolConfig holds tuning parameters for the pgx connection pool.
type PoolConfig struct {
	MaxConns        int32
	MinConns        int32
	MaxConnIdleTime time.Duration
}

// DefaultPoolConfig returns production-ready defaults.
func DefaultPoolConfig() PoolConfig {
	return PoolConfig{
		MaxConns:        20,
		MinConns:        2,
		MaxConnIdleTime: 5 * time.Minute,
	}
}

// NewPool creates and validates a pgxpool connection pool.
// It applies the provided PoolConfig on top of whatever the DATABASE_URL
// connection string specifies, then pings the database to verify connectivity.
func NewPool(ctx context.Context, databaseURL string, cfg PoolConfig) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: parse DATABASE_URL: %w", err)
	}

	// Apply pool tuning.
	poolCfg.MaxConns = cfg.MaxConns
	poolCfg.MinConns = cfg.MinConns
	poolCfg.MaxConnIdleTime = cfg.MaxConnIdleTime

	// Give the initial connection attempt a generous timeout.
	connectCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(connectCtx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	// Ping to confirm the DB is reachable at startup.
	pingCtx, pingCancel := context.WithTimeout(ctx, 5*time.Second)
	defer pingCancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: ping failed: %w", err)
	}

	return pool, nil
}
