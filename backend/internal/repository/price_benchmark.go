package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
)

// PriceBenchmarkRepo — read-only загрузка данных ценового бенчмарка.
type PriceBenchmarkRepo struct {
	pool *pgxpool.Pool
}

// NewPriceBenchmarkRepo creates a PriceBenchmarkRepo.
func NewPriceBenchmarkRepo(pool *pgxpool.Pool) *PriceBenchmarkRepo {
	return &PriceBenchmarkRepo{pool: pool}
}

// BenchmarkSnapshot — всё для pure-движка: состояние тендера, текущие строки
// и per-logical-tender observations по ключам текущего тендера.
type BenchmarkSnapshot struct {
	TenderID     string
	InputRev     int64
	CalcRev      int64
	CalcStatus   string
	GeneratedAt  string
	Items        []pb.CurrentItem
	Observations map[pb.Key][]pb.Observation
}

// historicalObservationsSQL — set-based агрегация (§12): исключает текущий
// тендер; только согласованные (approved) тендеры с АКТУАЛЬНЫМ расчётом
// (status=calculated, calc_rev=input_rev) в периоде; одна АКТУАЛЬНАЯ
// согласованная версия логического тендера (DISTINCT ON tender_number,
// version DESC); representative = медиана direct unit costs строк тендера по
// ключу (крупный тендер не доминирует). Ключ повторяет BuildPriceBenchmarkKey:
// boq_item_type + COALESCE(material_name_id, work_name_id) + unit_code +
// (parent IS NOT NULL). Строки истории: quantity>0, total_amount>0 —
// authoritative total (клиентские значения в БД не живут после этапа 0).
const historicalObservationsSQL = `
WITH current_keys AS (
    SELECT DISTINCT bi.boq_item_type::text                              AS item_type,
           COALESCE(bi.material_name_id, bi.work_name_id)::text        AS name_id,
           bi.unit_code                                                AS unit_code,
           (bi.parent_work_item_id IS NOT NULL)                        AS has_parent
    FROM public.boq_items bi
    WHERE bi.tender_id = $1::uuid
      AND bi.quantity > 0 AND bi.total_amount > 0
      AND COALESCE(bi.material_name_id, bi.work_name_id) IS NOT NULL
      AND bi.unit_code IS NOT NULL
),
latest_versions AS (
    SELECT DISTINCT ON (t.tender_number)
           t.id, t.tender_number, COALESCE(t.version, 1) AS version,
           t.financial_approved_at
    FROM public.tenders t
    WHERE t.id <> $1::uuid
      AND t.financial_approved = true
      AND t.financial_calculation_status = 'calculated'
      AND t.financial_calculation_revision = t.financial_input_revision
      AND t.financial_approved_at IS NOT NULL
      AND t.financial_approved_at >= NOW() - make_interval(months => $2::int)
    ORDER BY t.tender_number, COALESCE(t.version, 1) DESC, t.financial_approved_at DESC
)
SELECT bi.boq_item_type::text,
       COALESCE(bi.material_name_id, bi.work_name_id)::text,
       bi.unit_code,
       (bi.parent_work_item_id IS NOT NULL),
       lv.id::text, lv.tender_number, lv.version,
       to_char(lv.financial_approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       (percentile_cont(0.5) WITHIN GROUP (ORDER BY (bi.total_amount / bi.quantity)::float8))::float8,
       count(*)::int,
       COALESCE(SUM(bi.quantity), 0)::float8
FROM latest_versions lv
JOIN public.boq_items bi ON bi.tender_id = lv.id
JOIN current_keys ck
  ON ck.item_type  = bi.boq_item_type::text
 AND ck.name_id    = COALESCE(bi.material_name_id, bi.work_name_id)::text
 AND ck.unit_code  = bi.unit_code
 AND ck.has_parent = (bi.parent_work_item_id IS NOT NULL)
WHERE bi.quantity > 0 AND bi.total_amount > 0
GROUP BY bi.boq_item_type, COALESCE(bi.material_name_id, bi.work_name_id),
         bi.unit_code, (bi.parent_work_item_id IS NOT NULL),
         lv.id, lv.tender_number, lv.version, lv.financial_approved_at
`

// LoadSnapshot — три фиксированных запроса в одной REPEATABLE READ READ ONLY
// транзакции (никакого N+1 по строкам/ключам): tender-состояние, текущие
// строки (+display-имя одним JOIN'ом), historical observations set-based SQL.
func (r *PriceBenchmarkRepo) LoadSnapshot(ctx context.Context, tenderID string, periodMonths int) (*BenchmarkSnapshot, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	s, err := loadBenchmarkSnapshotTx(ctx, tx, tenderID, periodMonths)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: commit: %w", err)
	}
	return s, nil
}

// loadBenchmarkSnapshotTx — тело загрузки в уже открытой транзакции
// (переиспользуется Action Plan этапа 1.4 для общего снапшота).
func loadBenchmarkSnapshotTx(ctx context.Context, tx pgx.Tx, tenderID string, periodMonths int) (*BenchmarkSnapshot, error) {
	s := &BenchmarkSnapshot{TenderID: tenderID, Observations: map[pb.Key][]pb.Observation{}}

	// 1. Tender state (+generated_at из snapshot).
	err := tx.QueryRow(ctx, `
		SELECT financial_input_revision, financial_calculation_revision,
		       financial_calculation_status,
		       to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.tenders WHERE id = $1::uuid
	`, tenderID).Scan(&s.InputRev, &s.CalcRev, &s.CalcStatus, &s.GeneratedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQualityTenderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: tender: %w", err)
	}

	// 2. Текущие строки + display-имя (номенклатура одним JOIN'ом).
	rows, err := tx.Query(ctx, `
		SELECT bi.id::text, bi.client_position_id::text, bi.boq_item_type::text,
		       COALESCE(NULLIF(TRIM(bi.description), ''), mn.name, wn.name, ''),
		       COALESCE(bi.material_name_id, bi.work_name_id)::text,
		       bi.unit_code, bi.quantity, bi.total_amount,
		       (bi.parent_work_item_id IS NOT NULL)
		FROM public.boq_items bi
		LEFT JOIN public.material_names mn ON mn.id = bi.material_name_id
		LEFT JOIN public.work_names wn ON wn.id = bi.work_name_id
		WHERE bi.tender_id = $1::uuid
		ORDER BY bi.client_position_id ASC, bi.sort_number ASC, bi.id ASC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: items: %w", err)
	}
	idx := 0
	for rows.Next() {
		var it pb.CurrentItem
		if err := rows.Scan(&it.ID, &it.ClientPositionID, &it.BoqItemType, &it.Name,
			&it.NameID, &it.UnitCode, &it.Quantity, &it.StoredTotalAmount, &it.HasParent); err != nil {
			rows.Close()
			return nil, fmt.Errorf("priceBenchmarkRepo: item scan: %w", err)
		}
		it.SortIndex = idx
		idx++
		s.Items = append(s.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: items rows: %w", err)
	}

	// 3. Historical observations (set-based, один запрос).
	rows, err = tx.Query(ctx, historicalObservationsSQL, tenderID, periodMonths)
	if err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: history: %w", err)
	}
	for rows.Next() {
		var (
			k        pb.Key
			o        pb.Observation
			tenderNo string
		)
		if err := rows.Scan(&k.BoqItemType, &k.NameID, &k.UnitCode, &k.HasParent,
			&o.TenderID, &tenderNo, &o.Version, &o.ApprovedAt,
			&o.RepresentativeUnitCost, &o.MatchedRowsCount, &o.QuantitySum); err != nil {
			rows.Close()
			return nil, fmt.Errorf("priceBenchmarkRepo: history scan: %w", err)
		}
		o.TenderLabel = tenderNo
		s.Observations[k] = append(s.Observations[k], o)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("priceBenchmarkRepo: history rows: %w", err)
	}

	return s, nil
}
