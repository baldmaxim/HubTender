package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
)

// ChangeImpactBaselineNotReadyError — выбранный baseline не годится (§2/§3).
type ChangeImpactBaselineNotReadyError struct {
	TenderID string
	Reason   string
}

func (e *ChangeImpactBaselineNotReadyError) Error() string {
	return "CHANGE_IMPACT_BASELINE_NOT_READY: " + e.TenderID + ": " + e.Reason
}

// ChangeImpactRepo — read-only загрузка сравнения версий (этап 1.5).
type ChangeImpactRepo struct {
	pool *pgxpool.Pool
}

// NewChangeImpactRepo creates a ChangeImpactRepo.
func NewChangeImpactRepo(pool *pgxpool.Pool) *ChangeImpactRepo {
	return &ChangeImpactRepo{pool: pool}
}

// ChangeImpactSnapshot — согласованный срез обеих версий из одной транзакции.
type ChangeImpactSnapshot struct {
	Current     ci.VersionData
	Baseline    *ci.VersionData // nil → BASELINE_NOT_AVAILABLE
	Candidates  []ci.Candidate
	GeneratedAt string
}

const tenderStateSQL = `
	SELECT t.id::text, t.tender_number, COALESCE(t.version, 1),
	       COALESCE(to_char(t.financial_approved_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), ''),
	       t.financial_approved,
	       t.financial_input_revision, t.financial_calculation_revision,
	       t.financial_calculation_status,
	       COALESCE(t.cached_grand_total, 0)::text,
	       t.usd_rate, t.eur_rate, t.cny_rate,
	       t.markup_tactic_id::text, COALESCE(mt.name, ''),
	       COALESCE(t.apply_subcontract_works_growth, true),
	       COALESCE(t.apply_subcontract_materials_growth, true),
	       (ti.id IS NOT NULL),
	       COALESCE(ti.judicial_pct, 0)::text, COALESCE(ti.total_pct, 0)::text,
	       COALESCE(ti.apt_price_m2, 0)::text, COALESCE(ti.apt_area, 0)::text,
	       COALESCE(ti.parking_price_m2, 0)::text, COALESCE(ti.parking_area, 0)::text,
	       COALESCE(ti.storage_price_m2, 0)::text, COALESCE(ti.storage_area, 0)::text
	FROM public.tenders t
	LEFT JOIN public.markup_tactics mt ON mt.id = t.markup_tactic_id
	LEFT JOIN public.tender_insurance ti ON ti.tender_id = t.id
`

func scanTenderState(row pgx.Row) (ci.TenderState, error) {
	var s ci.TenderState
	err := row.Scan(
		&s.ID, &s.TenderNumber, &s.Version, &s.ApprovedAt, &s.Approved,
		&s.InputRev, &s.CalcRev, &s.CalcStatus, &s.CachedGrandTotal,
		&s.USDRate, &s.EURRate, &s.CNYRate,
		&s.TacticID, &s.TacticLabel, &s.ApplySubW, &s.ApplySubM,
		&s.Insurance.Present,
		&s.Insurance.JudicialPct, &s.Insurance.TotalPct,
		&s.Insurance.AptPriceM2, &s.Insurance.AptArea,
		&s.Insurance.ParkingPriceM2, &s.Insurance.ParkingA,
		&s.Insurance.StoragePriceM2, &s.Insurance.StorageA,
	)
	return s, err
}

// LoadSnapshot — фиксированное число set-based запросов в одной REPEATABLE
// READ READ ONLY транзакции (§16): current, версии-кандидаты, позиции и BOQ
// обеих версий, конфиг обеих версий. Baseline выбирается ЗДЕСЬ (pure-политика
// §2) — чтобы обе версии читались из одного снапшота.
func (r *ChangeImpactRepo) LoadSnapshot(
	ctx context.Context, tenderID, baselineID string,
) (*ChangeImpactSnapshot, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, fmt.Errorf("changeImpactRepo: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	out := &ChangeImpactSnapshot{}

	// 1. Текущая версия (+generated_at).
	cur, err := scanTenderState(tx.QueryRow(ctx, tenderStateSQL+` WHERE t.id = $1::uuid`, tenderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQualityTenderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("changeImpactRepo: current: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
	).Scan(&out.GeneratedAt); err != nil {
		return nil, fmt.Errorf("changeImpactRepo: now: %w", err)
	}
	out.Current.Tender = cur

	// 2. Все прочие версии того же tender_number (кандидаты + валидация выбора).
	rows, err := tx.Query(ctx, tenderStateSQL+`
		WHERE t.tender_number = $1 AND t.id <> $2::uuid
		ORDER BY COALESCE(t.version, 1) DESC, t.id ASC`, cur.TenderNumber, tenderID)
	if err != nil {
		return nil, fmt.Errorf("changeImpactRepo: versions: %w", err)
	}
	var versions []ci.TenderState
	for rows.Next() {
		s, err := scanTenderState(rows)
		if err != nil {
			rows.Close()
			return nil, fmt.Errorf("changeImpactRepo: version scan: %w", err)
		}
		versions = append(versions, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("changeImpactRepo: versions rows: %w", err)
	}
	out.Candidates = ci.CandidatesOf(&cur, versions)

	// Выбор baseline: явный параметр либо политика по умолчанию (§2).
	var baseState *ci.TenderState
	if baselineID != "" {
		for i := range versions {
			if versions[i].ID == baselineID {
				baseState = &versions[i]
				break
			}
		}
		if baseState == nil {
			return nil, &ChangeImpactBaselineNotReadyError{TenderID: baselineID, Reason: "BASELINE_NOT_FOUND_FOR_TENDER"}
		}
		if reason := ci.BaselineEligible(&cur, baseState); reason != "" {
			return nil, &ChangeImpactBaselineNotReadyError{TenderID: baselineID, Reason: reason}
		}
	} else {
		baseState = ci.PickDefaultBaseline(&cur, versions)
	}
	if baseState == nil {
		return out, tx.Commit(ctx) // BASELINE_NOT_AVAILABLE — не ошибка (§12)
	}
	base := ci.VersionData{Tender: *baseState}

	// 3. Позиции обеих версий (один запрос).
	if err := r.loadPositions(ctx, tx, tenderID, baseState.ID, &out.Current, &base); err != nil {
		return nil, err
	}
	// 4. BOQ обеих версий (один запрос).
	if err := r.loadItems(ctx, tx, tenderID, baseState.ID, &out.Current, &base); err != nil {
		return nil, err
	}
	// 5-7. Конфигурация обеих версий (set-based).
	if err := r.loadConfig(ctx, tx, tenderID, baseState.ID, &out.Current.Tender, &base.Tender); err != nil {
		return nil, err
	}

	out.Baseline = &base
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("changeImpactRepo: commit: %w", err)
	}
	return out, nil
}

func (r *ChangeImpactRepo) loadPositions(ctx context.Context, tx pgx.Tx, curID, baseID string, cur, base *ci.VersionData) error {
	rows, err := tx.Query(ctx, `
		SELECT tender_id::text, id::text, position_number,
		       COALESCE(item_no, ''), COALESCE(work_name, ''), COALESCE(unit_code, '')
		FROM public.client_positions
		WHERE tender_id = $1::uuid OR tender_id = $2::uuid
		ORDER BY tender_id, position_number ASC, id ASC`, curID, baseID)
	if err != nil {
		return fmt.Errorf("changeImpactRepo: positions: %w", err)
	}
	defer rows.Close()
	idx := map[string]int{}
	for rows.Next() {
		var tid string
		var p ci.Position
		if err := rows.Scan(&tid, &p.ID, &p.PositionNumber, &p.ItemNo, &p.WorkName, &p.UnitCode); err != nil {
			return fmt.Errorf("changeImpactRepo: position scan: %w", err)
		}
		p.SortIndex = idx[tid]
		idx[tid]++
		if tid == curID {
			cur.Positions = append(cur.Positions, p)
		} else {
			base.Positions = append(base.Positions, p)
		}
	}
	return rows.Err()
}

func (r *ChangeImpactRepo) loadItems(ctx context.Context, tx pgx.Tx, curID, baseID string, cur, base *ci.VersionData) error {
	rows, err := tx.Query(ctx, `
		SELECT bi.tender_id::text, bi.id::text, bi.client_position_id::text,
		       bi.boq_item_type::text, bi.material_type::text,
		       COALESCE(bi.material_name_id, bi.work_name_id)::text,
		       COALESCE(NULLIF(TRIM(bi.description), ''), mn.name, wn.name, ''),
		       bi.unit_code, bi.detail_cost_category_id::text,
		       bi.parent_work_item_id::text, bi.description,
		       COALESCE(bi.currency_type::text, ''), bi.delivery_price_type::text,
		       bi.quantity, bi.unit_rate, bi.base_quantity,
		       bi.consumption_coefficient, bi.conversion_coefficient, bi.delivery_amount,
		       bi.quote_link,
		       to_char(bi.quote_price_date, 'YYYY-MM-DD'),
		       to_char(bi.quote_valid_until, 'YYYY-MM-DD'),
		       COALESCE(bi.total_amount, 0)::text,
		       COALESCE(bi.total_commercial_material_cost, 0)::text,
		       COALESCE(bi.total_commercial_work_cost, 0)::text
		FROM public.boq_items bi
		LEFT JOIN public.material_names mn ON mn.id = bi.material_name_id
		LEFT JOIN public.work_names wn ON wn.id = bi.work_name_id
		WHERE bi.tender_id = $1::uuid OR bi.tender_id = $2::uuid
		ORDER BY bi.tender_id, bi.client_position_id ASC, bi.sort_number ASC, bi.id ASC`, curID, baseID)
	if err != nil {
		return fmt.Errorf("changeImpactRepo: items: %w", err)
	}
	defer rows.Close()
	idx := map[string]int{}
	for rows.Next() {
		var tid string
		var it ci.Item
		if err := rows.Scan(&tid, &it.ID, &it.ClientPositionID,
			&it.BoqItemType, &it.MaterialType, &it.NameID, &it.Name,
			&it.UnitCode, &it.DetailCategoryID, &it.ParentWorkItemID, &it.Description,
			&it.CurrencyType, &it.DeliveryType,
			&it.Quantity, &it.UnitRate, &it.BaseQuantity,
			&it.ConsumptionCoef, &it.ConversionCoef, &it.DeliveryAmount,
			&it.QuoteLink, &it.QuotePriceDate, &it.QuoteValidUntil,
			&it.TotalAmountText, &it.CommercialMaterialText, &it.CommercialWorkText,
		); err != nil {
			return fmt.Errorf("changeImpactRepo: item scan: %w", err)
		}
		it.SortIndex = idx[tid]
		idx[tid]++
		if tid == curID {
			cur.Items = append(cur.Items, it)
		} else {
			base.Items = append(base.Items, it)
		}
	}
	return rows.Err()
}

func (r *ChangeImpactRepo) loadConfig(ctx context.Context, tx pgx.Tx, curID, baseID string, cur, base *ci.TenderState) error {
	// Проценты наценок (label из markup_parameters).
	rows, err := tx.Query(ctx, `
		SELECT tmp.tender_id::text, COALESCE(mp.label, tmp.markup_parameter_id::text), tmp.value::text
		FROM public.tender_markup_percentage tmp
		LEFT JOIN public.markup_parameters mp ON mp.id = tmp.markup_parameter_id
		WHERE tmp.tender_id = $1::uuid OR tmp.tender_id = $2::uuid
		ORDER BY 2, 1`, curID, baseID)
	if err != nil {
		return fmt.Errorf("changeImpactRepo: percentages: %w", err)
	}
	for rows.Next() {
		var tid string
		var p ci.Percentage
		if err := rows.Scan(&tid, &p.Label, &p.Value); err != nil {
			rows.Close()
			return fmt.Errorf("changeImpactRepo: percentage scan: %w", err)
		}
		if tid == curID {
			cur.Percentages = append(cur.Percentages, p)
		} else {
			base.Percentages = append(base.Percentages, p)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// Pricing distribution.
	rows, err = tx.Query(ctx, `
		SELECT tender_id::text,
		       basic_material_base_target, basic_material_markup_target,
		       auxiliary_material_base_target, auxiliary_material_markup_target,
		       work_base_target, work_markup_target
		FROM public.tender_pricing_distribution
		WHERE tender_id = $1::uuid OR tender_id = $2::uuid
		ORDER BY tender_id, created_at ASC`, curID, baseID)
	if err != nil {
		return fmt.Errorf("changeImpactRepo: distribution: %w", err)
	}
	for rows.Next() {
		var tid string
		var d ci.Distribution
		if err := rows.Scan(&tid, &d.BasicMaterialBase, &d.BasicMaterialMarkup,
			&d.AuxiliaryMaterialBase, &d.AuxiliaryMaterialMark, &d.WorkBase, &d.WorkMarkup); err != nil {
			rows.Close()
			return fmt.Errorf("changeImpactRepo: distribution scan: %w", err)
		}
		if tid == curID && cur.Distribution == nil {
			cur.Distribution = &d
		} else if tid == baseID && base.Distribution == nil {
			base.Distribution = &d
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	// Subcontract exclusions (canonical label|type, отсортированы SQL'ем).
	rows, err = tx.Query(ctx, `
		SELECT sge.tender_id::text,
		       COALESCE(dcc.name, sge.detail_cost_category_id::text) || '|' || sge.exclusion_type
		FROM public.subcontract_growth_exclusions sge
		LEFT JOIN public.detail_cost_categories dcc ON dcc.id = sge.detail_cost_category_id
		WHERE sge.tender_id = $1::uuid OR sge.tender_id = $2::uuid
		ORDER BY 2, 1`, curID, baseID)
	if err != nil {
		return fmt.Errorf("changeImpactRepo: exclusions: %w", err)
	}
	for rows.Next() {
		var tid, v string
		if err := rows.Scan(&tid, &v); err != nil {
			rows.Close()
			return fmt.Errorf("changeImpactRepo: exclusion scan: %w", err)
		}
		if tid == curID {
			cur.Exclusions = append(cur.Exclusions, v)
		} else {
			base.Exclusions = append(base.Exclusions, v)
		}
	}
	rows.Close()
	return rows.Err()
}
