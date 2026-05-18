package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// CostImportCategory is one (name, unit) cost category to find-or-create.
type CostImportCategory struct {
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// CostImportDetail is one detail cost category row to upsert.
// NOTE: Yandex schema stores `location` as TEXT NOT NULL on
// detail_cost_categories (no locations table / location_id — that was the
// old Supabase schema; this endpoint targets the migrated Yandex schema).
type CostImportDetail struct {
	OrderNum     int    `json:"order_num"`
	CategoryName string `json:"category_name"`
	CategoryUnit string `json:"category_unit"`
	CostName     string `json:"cost_name"`
	CostUnit     string `json:"cost_unit"`
	Location     string `json:"location"`
}

// CostImportRepo runs the whole cost-category import in a single pgx.Tx.
type CostImportRepo struct {
	pool *pgxpool.Pool
}

// NewCostImportRepo creates a CostImportRepo.
func NewCostImportRepo(pool *pgxpool.Pool) *CostImportRepo {
	return &CostImportRepo{pool: pool}
}

// Import upserts cost_categories (find-or-create by name+unit) and inserts
// new detail_cost_categories (skipping existing by cost_category_id+name),
// all atomically. Returns the number of detail rows added.
func (r *CostImportRepo) Import(
	ctx context.Context,
	categories []CostImportCategory,
	details []CostImportDetail,
) (int, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("costImportRepo.Import: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	catID := make(map[string]string, len(categories))
	key := func(name, unit string) string { return name + "\x00" + unit }

	for _, c := range categories {
		if c.Name == "" || c.Unit == "" {
			continue
		}
		var id string
		err := tx.QueryRow(ctx,
			`SELECT id::text FROM public.cost_categories
			 WHERE name = $1 AND unit = $2 LIMIT 1`,
			c.Name, c.Unit,
		).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			if err := tx.QueryRow(ctx,
				`INSERT INTO public.cost_categories (name, unit)
				 VALUES ($1, $2) RETURNING id::text`,
				c.Name, c.Unit,
			).Scan(&id); err != nil {
				return 0, fmt.Errorf("costImportRepo.Import: insert category: %w", err)
			}
		} else if err != nil {
			return 0, fmt.Errorf("costImportRepo.Import: select category: %w", err)
		}
		catID[key(c.Name, c.Unit)] = id
	}

	added := 0
	for _, d := range details {
		if d.CostName == "" {
			continue
		}
		cid, ok := catID[key(d.CategoryName, d.CategoryUnit)]
		if !ok {
			continue // категория не найдена — пропускаем (как в оригинале)
		}

		var exists bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS(
				SELECT 1 FROM public.detail_cost_categories
				WHERE cost_category_id = $1::uuid AND name = $2
			)`, cid, d.CostName).Scan(&exists); err != nil {
			return 0, fmt.Errorf("costImportRepo.Import: exists check: %w", err)
		}
		if exists {
			continue
		}

		if _, err := tx.Exec(ctx, `
			INSERT INTO public.detail_cost_categories
				(cost_category_id, location, name, unit, order_num)
			VALUES ($1::uuid, $2, $3, $4, $5)
		`, cid, d.Location, d.CostName, d.CostUnit, d.OrderNum); err != nil {
			return 0, fmt.Errorf("costImportRepo.Import: insert detail: %w", err)
		}
		added++
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("costImportRepo.Import: commit: %w", err)
	}
	return added, nil
}
