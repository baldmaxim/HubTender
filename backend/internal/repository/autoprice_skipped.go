package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Позиции, не попавшие в авторасценку (тест): список пропусков прогона задаёт
// загрузчик целиком, а «без цены» вычисляется при чтении из строк и карточек.
// Миграция: db/yandex/incremental/2026_10_autoprice_skipped.sql.

// AutopriceSkippedInput — один пропуск из тела PUT .../skipped.
type AutopriceSkippedInput struct {
	PositionID string
	ReasonCode string
	Reason     *string
}

// AutopriceUnpriced — позиция тендера прогона, не попавшая в авторасценку.
type AutopriceUnpriced struct {
	PositionID       string   `json:"position_id"`
	PositionNumber   float64  `json:"position_number"`
	ItemNo           *string  `json:"item_no"`
	WorkName         string   `json:"work_name"`
	SectionName      *string  `json:"section_name"`
	UnitCode         *string  `json:"unit_code"`
	Volume           *float64 `json:"volume"`
	IsAdditional     bool     `json:"is_additional"`
	ItemsCount       int      `json:"items_count"`
	RunItemsCount    int      `json:"run_items_count"`
	DerivedReason    string   `json:"derived_reason"`
	LoaderReasonCode *string  `json:"loader_reason_code"`
	LoaderReason     *string  `json:"loader_reason"`
}

// MissingPositionsError — позиции не принадлежат тендеру прогона (400).
type MissingPositionsError struct{ IDs []string }

func (e *MissingPositionsError) Error() string {
	return fmt.Sprintf("autoprice: %d positions not in run tender", len(e.IDs))
}

// lockedRunOnly — прогон для записи пропусков: существует, autoprice, не отменён.
func lockedRunOnly(ctx context.Context, tx pgx.Tx, sessionID string) (string, error) {
	var (
		tid       *string
		cancelled bool
	)
	err := tx.QueryRow(ctx, `
		SELECT tender_id::text, cancelled_at IS NOT NULL
		FROM public.import_sessions WHERE id = $1 AND source = $2`,
		sessionID, AutopriceSource).Scan(&tid, &cancelled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrAutopriceRunNotFound
		}
		return "", fmt.Errorf("autoprice: load run: %w", err)
	}
	if tid == nil {
		return "", ErrAutopriceRunNotFound
	}
	if cancelled {
		return "", ErrAutopriceRunCancelled
	}
	return *tid, nil
}

// ReplaceSkipped заменяет весь набор пропусков прогона одной транзакцией
// (пустой список — очистка). Прогон должен существовать, быть autoprice и не
// отменённым; все позиции — принадлежать тендеру прогона, иначе
// *MissingPositionsError. Возвращает число записанных пропусков.
func (r *AutopriceReviewRepo) ReplaceSkipped(ctx context.Context, sessionID string, items []AutopriceSkippedInput) (int, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("autoprice.ReplaceSkipped: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	tenderID, err := lockedRunOnly(ctx, tx, sessionID)
	if err != nil {
		return 0, err
	}

	ids := make([]string, 0, len(items))
	codes := make([]string, 0, len(items))
	reasons := make([]*string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.PositionID)
		codes = append(codes, it.ReasonCode)
		reasons = append(reasons, it.Reason)
	}

	if len(ids) > 0 {
		rows, err := tx.Query(ctx, `
			SELECT x.id::text FROM unnest($1::uuid[]) AS x(id)
			WHERE NOT EXISTS (SELECT 1 FROM public.client_positions cp
			                  WHERE cp.id = x.id AND cp.tender_id = $2)`, ids, tenderID)
		if err != nil {
			return 0, fmt.Errorf("autoprice.ReplaceSkipped: check positions: %w", err)
		}
		bad := make([]string, 0)
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return 0, fmt.Errorf("autoprice.ReplaceSkipped: check scan: %w", err)
			}
			bad = append(bad, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return 0, fmt.Errorf("autoprice.ReplaceSkipped: check rows: %w", err)
		}
		if len(bad) > 0 {
			return 0, &MissingPositionsError{IDs: bad}
		}
	}

	if _, err := tx.Exec(ctx,
		`DELETE FROM public.autoprice_skipped_positions WHERE import_session_id = $1`, sessionID); err != nil {
		return 0, fmt.Errorf("autoprice.ReplaceSkipped: delete: %w", err)
	}
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.autoprice_skipped_positions
			    (import_session_id, tender_id, client_position_id, reason_code, reason)
			SELECT $1, $2, x.id, x.code, x.reason
			FROM unnest($3::uuid[], $4::text[], $5::text[]) AS x(id, code, reason)`,
			sessionID, tenderID, ids, codes, reasons); err != nil {
			return 0, fmt.Errorf("autoprice.ReplaceSkipped: insert: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("autoprice.ReplaceSkipped: commit: %w", err)
	}
	return len(ids), nil
}

// autopriceUnpricedSQL — позиции тендера прогона ($1 = id сессии) без карточки
// проверки в этом прогоне либо с пропуском от загрузчика. derived_reason — по
// первому совпадению: строки прогона есть, но карточки нет → no_review; строки
// есть вне прогона → priced_outside_run; нет единицы или объёма → no_volume;
// иначе empty. Раздел — как в autopriceReviewQuery.
const autopriceUnpricedSQL = `
SELECT cp.id::text, cp.position_number::float8, cp.item_no, cp.work_name, sec.name,
       cp.unit_code, COALESCE(cp.manual_volume, cp.volume)::float8, COALESCE(cp.is_additional, false),
       agg.items_count, agg.run_items_count,
       CASE WHEN agg.run_items_count > 0 THEN 'no_review'
            WHEN agg.items_count > 0 THEN 'priced_outside_run'
            WHEN COALESCE(cp.unit_code, '') = '' OR COALESCE(COALESCE(cp.manual_volume, cp.volume), 0) = 0 THEN 'no_volume'
            ELSE 'empty' END,
       sk.reason_code, sk.reason
FROM public.import_sessions s
JOIN public.client_positions cp ON cp.tender_id = s.tender_id
LEFT JOIN public.autoprice_skipped_positions sk
       ON sk.import_session_id = s.id AND sk.client_position_id = cp.id
LEFT JOIN LATERAL (
    SELECT count(*)::int AS items_count,
           (count(*) FILTER (WHERE b.import_session_id = s.id))::int AS run_items_count
    FROM public.boq_items b
    WHERE b.client_position_id = cp.id
) agg ON true
LEFT JOIN LATERAL (
    SELECT cc.name
    FROM public.boq_items bi
    JOIN public.detail_cost_categories dcc ON dcc.id = bi.detail_cost_category_id
    JOIN public.cost_categories cc ON cc.id = dcc.cost_category_id
    WHERE bi.client_position_id = cp.id
    GROUP BY cc.id, cc.name
    ORDER BY COUNT(*) DESC, cc.name, cc.id
    LIMIT 1
) sec ON true
WHERE s.id = $1 AND s.source = $2
  AND (sk.client_position_id IS NOT NULL
       OR NOT EXISTS (SELECT 1 FROM public.autoprice_position_reviews r
                      WHERE r.import_session_id = s.id AND r.client_position_id = cp.id))
ORDER BY cp.position_number, cp.id`

// ListUnpriced — позиции тендера прогона, не попавшие в авторасценку, по
// номеру позиции. Прогон должен существовать (иначе ErrAutopriceRunNotFound).
func (r *AutopriceReviewRepo) ListUnpriced(ctx context.Context, sessionID string) ([]AutopriceUnpriced, error) {
	if _, err := r.TenderOfRun(ctx, sessionID); err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, autopriceUnpricedSQL, sessionID, AutopriceSource)
	if err != nil {
		return nil, fmt.Errorf("autoprice.ListUnpriced: %w", err)
	}
	defer rows.Close()
	out := make([]AutopriceUnpriced, 0)
	for rows.Next() {
		var v AutopriceUnpriced
		if err := rows.Scan(&v.PositionID, &v.PositionNumber, &v.ItemNo, &v.WorkName, &v.SectionName,
			&v.UnitCode, &v.Volume, &v.IsAdditional, &v.ItemsCount, &v.RunItemsCount,
			&v.DerivedReason, &v.LoaderReasonCode, &v.LoaderReason); err != nil {
			return nil, fmt.Errorf("autoprice.ListUnpriced scan: %w", err)
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
