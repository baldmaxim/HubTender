package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PositionFiltersRepo handles user_position_filters CRUD.
type PositionFiltersRepo struct {
	pool *pgxpool.Pool
}

// NewPositionFiltersRepo creates a PositionFiltersRepo.
func NewPositionFiltersRepo(pool *pgxpool.Pool) *PositionFiltersRepo {
	return &PositionFiltersRepo{pool: pool}
}

// List returns the position_id values stored for (userID, tenderID).
func (r *PositionFiltersRepo) List(ctx context.Context, userID, tenderID string) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT position_id
		FROM public.user_position_filters
		WHERE user_id = $1 AND tender_id = $2
	`, userID, tenderID)
	if err != nil {
		return nil, fmt.Errorf("positionFiltersRepo.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("positionFiltersRepo.List: scan: %w", err)
		}
		out = append(out, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("positionFiltersRepo.List: rows: %w", err)
	}
	return out, nil
}

// Replace atomically deletes existing rows for (userID, tenderID) and
// inserts the supplied positionIDs. Empty positionIDs simply clears the filter.
func (r *PositionFiltersRepo) Replace(ctx context.Context, userID, tenderID string, positionIDs []string) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("positionFiltersRepo.Replace: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `
		DELETE FROM public.user_position_filters
		WHERE user_id = $1 AND tender_id = $2
	`, userID, tenderID); err != nil {
		return fmt.Errorf("positionFiltersRepo.Replace: delete: %w", err)
	}

	if len(positionIDs) > 0 {
		// Build a single INSERT with unnest for efficiency.
		_, err := tx.Exec(ctx, `
			INSERT INTO public.user_position_filters (user_id, tender_id, position_id)
			SELECT $1, $2, pid
			FROM unnest($3::uuid[]) AS pid
		`, userID, tenderID, positionIDs)
		if err != nil {
			return fmt.Errorf("positionFiltersRepo.Replace: insert: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("positionFiltersRepo.Replace: commit: %w", err)
	}
	return nil
}

// Append inserts a single position_id (no-op if already present).
func (r *PositionFiltersRepo) Append(ctx context.Context, userID, tenderID, positionID string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.user_position_filters (user_id, tender_id, position_id)
		VALUES ($1, $2, $3)
		ON CONFLICT DO NOTHING
	`, userID, tenderID, positionID)
	if err != nil {
		return fmt.Errorf("positionFiltersRepo.Append: %w", err)
	}
	return nil
}

// Clear removes all filter entries for (userID, tenderID).
func (r *PositionFiltersRepo) Clear(ctx context.Context, userID, tenderID string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM public.user_position_filters
		WHERE user_id = $1 AND tender_id = $2
	`, userID, tenderID)
	if err != nil {
		return fmt.Errorf("positionFiltersRepo.Clear: %w", err)
	}
	return nil
}
