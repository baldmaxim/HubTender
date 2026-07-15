package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
)

// PriceSourceRepo — read-only загрузка данных актуальности источников цен.
type PriceSourceRepo struct {
	pool *pgxpool.Pool
}

// NewPriceSourceRepo creates a PriceSourceRepo.
func NewPriceSourceRepo(pool *pgxpool.Pool) *PriceSourceRepo {
	return &PriceSourceRepo{pool: pool}
}

// SourceSnapshot — всё для pure-движка + server as-of date (клиентское время
// НИКОГДА не authority — §4).
type SourceSnapshot struct {
	TenderID    string
	InputRev    int64
	CalcRev     int64
	CalcStatus  string
	GeneratedAt string
	AsOfDate    string // server CURRENT_DATE
	Items       []ps.Item
}

// LoadSnapshot — два фиксированных запроса в одной REPEATABLE READ READ ONLY
// транзакции (никакого N+1; source-метаданные лежат на boq_items — вариант B).
func (r *PriceSourceRepo) LoadSnapshot(ctx context.Context, tenderID string) (*SourceSnapshot, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("priceSourceRepo: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	s, err := loadSourceSnapshotTx(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("priceSourceRepo: commit: %w", err)
	}
	return s, nil
}

// loadSourceSnapshotTx — тело загрузки в уже открытой транзакции
// (переиспользуется Action Plan этапа 1.4 для общего снапшота).
func loadSourceSnapshotTx(ctx context.Context, tx pgx.Tx, tenderID string) (*SourceSnapshot, error) {
	s := &SourceSnapshot{TenderID: tenderID}

	// 1. Tender-state + server dates.
	err := tx.QueryRow(ctx, `
		SELECT financial_input_revision, financial_calculation_revision,
		       financial_calculation_status,
		       to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(CURRENT_DATE, 'YYYY-MM-DD')
		FROM public.tenders WHERE id = $1::uuid
	`, tenderID).Scan(&s.InputRev, &s.CalcRev, &s.CalcStatus, &s.GeneratedAt, &s.AsOfDate)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQualityTenderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("priceSourceRepo: tender: %w", err)
	}

	// 2. Строки + source-метаданные + display-имя одним запросом.
	rows, err := tx.Query(ctx, `
		SELECT bi.id::text, bi.client_position_id::text, bi.boq_item_type::text,
		       COALESCE(NULLIF(TRIM(bi.description), ''), mn.name, wn.name, ''),
		       COALESCE(bi.unit_code, ''),
		       bi.quantity, bi.unit_rate, bi.total_amount,
		       bi.quote_link,
		       to_char(bi.quote_price_date, 'YYYY-MM-DD'),
		       to_char(bi.quote_valid_until, 'YYYY-MM-DD')
		FROM public.boq_items bi
		LEFT JOIN public.material_names mn ON mn.id = bi.material_name_id
		LEFT JOIN public.work_names wn ON wn.id = bi.work_name_id
		WHERE bi.tender_id = $1::uuid
		ORDER BY bi.client_position_id ASC, bi.sort_number ASC, bi.id ASC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("priceSourceRepo: items: %w", err)
	}
	idx := 0
	for rows.Next() {
		var it ps.Item
		if err := rows.Scan(&it.ID, &it.ClientPositionID, &it.BoqItemType, &it.Name,
			&it.UnitCode, &it.Quantity, &it.UnitRate, &it.TotalAmount,
			&it.QuoteLink, &it.PriceDate, &it.ValidUntil); err != nil {
			rows.Close()
			return nil, fmt.Errorf("priceSourceRepo: item scan: %w", err)
		}
		it.SortIndex = idx
		idx++
		s.Items = append(s.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("priceSourceRepo: rows: %w", err)
	}
	return s, nil
}
