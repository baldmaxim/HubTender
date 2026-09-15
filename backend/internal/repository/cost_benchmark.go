package repository

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/analytics/costbenchmark"
)

// CostBenchmarkRepo — удельные показатели тендеров для сравнения с эталонами.
type CostBenchmarkRepo struct {
	pool *pgxpool.Pool
}

func NewCostBenchmarkRepo(pool *pgxpool.Pool) *CostBenchmarkRepo {
	return &CostBenchmarkRepo{pool: pool}
}

// CostBenchmarkCurrent — показатели текущего тендера.
type CostBenchmarkCurrent struct {
	TenderNumber      string
	HousingClass      *string
	ConstructionScope *string
	AreaSP            *float64
	CalculationReady  bool
	Metrics           []costbenchmark.Metric
}

// HistoryTender — показатели одного исторического тендера.
type HistoryTender struct {
	TenderID     string
	TenderNumber string
	Observations []costbenchmark.Observation
}

// costMetricsSQL — коммерческие суммы по детализации, категории и тендеру целиком
// с объёмами из construction_cost_volumes. Коммерческие суммы материализованы
// пересчётом и верны только при актуальном расчёте — поэтому история берётся лишь
// из актуально рассчитанных тендеров, а у текущего проверяется готовность.
// Объём категории хранится группой 'category-<имя>' — так его заводит страница
// «Затраты на строительство». Итог тендера — сумма строк без страхования: так
// ₽/м² сопоставим между тендерами с разными настройками страхования.
const costMetricsSQL = `
WITH det AS (
	SELECT b.tender_id, dcc.cost_category_id AS cat_id, b.detail_cost_category_id AS det_id,
	       sum(COALESCE(b.total_commercial_material_cost, 0)
	         + COALESCE(b.total_commercial_work_cost, 0))::float8 AS commercial
	FROM public.boq_items b
	JOIN public.detail_cost_categories dcc ON dcc.id = b.detail_cost_category_id
	WHERE b.tender_id = ANY($1::uuid[])
	GROUP BY 1, 2, 3
),
cat AS (
	SELECT tender_id, cat_id, sum(commercial)::float8 AS commercial FROM det GROUP BY 1, 2
),
tot AS (
	SELECT b.tender_id,
	       sum(COALESCE(b.total_commercial_material_cost, 0)
	         + COALESCE(b.total_commercial_work_cost, 0))::float8 AS commercial
	FROM public.boq_items b
	WHERE b.tender_id = ANY($1::uuid[])
	GROUP BY 1
)
SELECT d.tender_id::text, 'detail', d.cat_id::text, d.det_id::text, d.commercial, v.volume::float8
FROM det d
LEFT JOIN public.construction_cost_volumes v
       ON v.tender_id = d.tender_id AND v.detail_cost_category_id = d.det_id
UNION ALL
SELECT c.tender_id::text, 'category', c.cat_id::text, '', c.commercial, v.volume::float8
FROM cat c
JOIN public.cost_categories cc ON cc.id = c.cat_id
LEFT JOIN public.construction_cost_volumes v
       ON v.tender_id = c.tender_id AND v.group_key = 'category-' || cc.name
UNION ALL
SELECT t.tender_id::text, 'total', '', '', t.commercial, NULL::float8
FROM tot t`

type metricRow struct {
	tenderID   string
	target     costbenchmark.Target
	commercial float64
	volume     *float64
}

func loadMetricRows(ctx context.Context, q rowQuerier, tenderIDs []string) ([]metricRow, error) {
	rows, err := q.Query(ctx, costMetricsSQL, tenderIDs)
	if err != nil {
		return nil, fmt.Errorf("удельные показатели: %w", err)
	}
	defer rows.Close()
	out := make([]metricRow, 0, 64)
	for rows.Next() {
		var m metricRow
		if err := rows.Scan(&m.tenderID, &m.target.Level, &m.target.CategoryID, &m.target.DetailID,
			&m.commercial, &m.volume); err != nil {
			return nil, fmt.Errorf("удельные показатели scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

type refName struct {
	name, location, unit, categoryID string
}

func loadCostReferenceNames(ctx context.Context, q rowQuerier) (cats, dets map[string]refName, err error) {
	cats, dets = make(map[string]refName), make(map[string]refName)
	rows, err := q.Query(ctx, `SELECT id::text, name, COALESCE(unit, '') FROM public.cost_categories`)
	if err != nil {
		return nil, nil, fmt.Errorf("категории: %w", err)
	}
	for rows.Next() {
		var id string
		var n refName
		if err := rows.Scan(&id, &n.name, &n.unit); err != nil {
			rows.Close()
			return nil, nil, err
		}
		cats[id] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	rows, err = q.Query(ctx, `SELECT id::text, name, COALESCE(location, ''), COALESCE(unit, ''),
		cost_category_id::text FROM public.detail_cost_categories`)
	if err != nil {
		return nil, nil, fmt.Errorf("детализации: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n refName
		if err := rows.Scan(&id, &n.name, &n.location, &n.unit, &n.categoryID); err != nil {
			return nil, nil, err
		}
		dets[id] = n
	}
	return cats, dets, rows.Err()
}

// LoadCurrent — показатели одного тендера в едином снимке. pgx.ErrNoRows — тендера нет.
func (r *CostBenchmarkRepo) LoadCurrent(ctx context.Context, tenderID string) (*CostBenchmarkCurrent, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.LoadCurrent: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	cur := &CostBenchmarkCurrent{}
	if err := tx.QueryRow(ctx, `
		SELECT tender_number, housing_class::text, construction_scope::text, area_sp::float8,
		       (financial_calculation_status = 'calculated'
		        AND financial_calculation_revision = financial_input_revision)
		FROM public.tenders WHERE id = $1`, tenderID).
		Scan(&cur.TenderNumber, &cur.HousingClass, &cur.ConstructionScope, &cur.AreaSP, &cur.CalculationReady); err != nil {
		return nil, err
	}

	rows, err := loadMetricRows(ctx, tx, []string{tenderID})
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.LoadCurrent: %w", err)
	}
	cats, dets, err := loadCostReferenceNames(ctx, tx)
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.LoadCurrent: %w", err)
	}

	for _, m := range rows {
		metric := costbenchmark.Metric{Target: m.target, Volume: m.volume, CommercialTotal: m.commercial}
		switch m.target.Level {
		case costbenchmark.LevelTotal:
			metric.Name = "Итого по тендеру"
		case costbenchmark.LevelCategory:
			metric.Name, metric.Unit = cats[m.target.CategoryID].name, cats[m.target.CategoryID].unit
		case costbenchmark.LevelDetail:
			d := dets[m.target.DetailID]
			metric.Name, metric.Location, metric.Unit = d.name, d.location, d.unit
		}
		cur.Metrics = append(cur.Metrics, metric)
	}
	sortMetrics(cur.Metrics, cats)
	return cur, nil
}

// sortMetrics: итог, затем категории по имени, за каждой — её детализации.
func sortMetrics(ms []costbenchmark.Metric, cats map[string]refName) {
	rank := func(m costbenchmark.Metric) int {
		switch m.Level {
		case costbenchmark.LevelTotal:
			return 0
		case costbenchmark.LevelCategory:
			return 1
		}
		return 2
	}
	sort.SliceStable(ms, func(i, j int) bool {
		a, b := ms[i], ms[j]
		if (a.Level == costbenchmark.LevelTotal) != (b.Level == costbenchmark.LevelTotal) {
			return a.Level == costbenchmark.LevelTotal
		}
		ca, cb := cats[a.CategoryID].name, cats[b.CategoryID].name
		if ca != cb {
			return ca < cb
		}
		if rank(a) != rank(b) {
			return rank(a) < rank(b)
		}
		if a.Name != b.Name {
			return a.Name < b.Name
		}
		return a.Location < b.Location
	})
}

// LoadHistory — показатели согласованных тендеров за период: последняя версия
// каждого номера, актуально рассчитанная. Отбор совпадает с pricebenchmark.
func (r *CostBenchmarkRepo) LoadHistory(ctx context.Context, periodMonths int) ([]HistoryTender, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.LoadHistory: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	rows, err := tx.Query(ctx, `
		SELECT DISTINCT ON (t.tender_number)
		       t.id::text, t.tender_number, t.housing_class::text, t.area_sp::float8
		FROM public.tenders t
		WHERE t.financial_approved = true
		  AND t.financial_calculation_status = 'calculated'
		  AND t.financial_calculation_revision = t.financial_input_revision
		  AND t.financial_approved_at IS NOT NULL
		  AND t.financial_approved_at >= NOW() - make_interval(months => $1::int)
		ORDER BY t.tender_number, COALESCE(t.version, 1) DESC, t.financial_approved_at DESC`, periodMonths)
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.LoadHistory: тендеры: %w", err)
	}
	type head struct {
		number string
		class  *string
		area   *float64
	}
	heads := make(map[string]head)
	ids := make([]string, 0, 64)
	for rows.Next() {
		var id string
		var h head
		if err := rows.Scan(&id, &h.number, &h.class, &h.area); err != nil {
			rows.Close()
			return nil, err
		}
		heads[id] = h
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return nil, nil
	}

	metrics, err := loadMetricRows(ctx, tx, ids)
	if err != nil {
		return nil, fmt.Errorf("costBenchmark.LoadHistory: %w", err)
	}
	byTender := make(map[string]*HistoryTender, len(ids))
	out := make([]HistoryTender, 0, len(ids))
	for _, id := range ids {
		out = append(out, HistoryTender{TenderID: id, TenderNumber: heads[id].number})
	}
	for i := range out {
		byTender[out[i].TenderID] = &out[i]
	}
	for _, m := range metrics {
		h := heads[m.tenderID]
		ht := byTender[m.tenderID]
		ht.Observations = append(ht.Observations, costbenchmark.Observation{
			TenderID: m.tenderID, TenderNumber: h.number, HousingClass: h.class,
			Target: m.target, Volume: m.volume, AreaSP: h.area, CommercialTotal: m.commercial,
		})
	}
	return out, nil
}

// IsNotFound — тендера нет.
func IsNotFound(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
