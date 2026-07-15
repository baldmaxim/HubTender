package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/quality"
)

// ErrQualityTenderNotFound — тендер не существует (404 в handler).
var ErrQualityTenderNotFound = errors.New("тендер не найден")

// QualityRepo грузит read-only snapshot для движка качества.
type QualityRepo struct {
	pool *pgxpool.Pool
}

// NewQualityRepo creates a QualityRepo.
func NewQualityRepo(pool *pgxpool.Pool) *QualityRepo {
	return &QualityRepo{pool: pool}
}

// LoadSnapshot собирает согласованный срез тендера ФИКСИРОВАННЫМ числом
// запросов (5) в одной REPEATABLE READ READ ONLY транзакции: tender+insurance
// агрегаты, позиции, BOQ, redistribution metadata. Никаких мутаций, никакого
// N+1 (parent-валидация выполняется движком по загруженной карте).
func (r *QualityRepo) LoadSnapshot(ctx context.Context, tenderID string) (*quality.Snapshot, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{
		IsoLevel:   pgx.RepeatableRead,
		AccessMode: pgx.ReadOnly,
	})
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	s, err := loadQualitySnapshotTx(ctx, tx, tenderID)
	if err != nil {
		return nil, err
	}

	// READ ONLY tx: commit == rollback; закрываем явно.
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: commit: %w", err)
	}
	return s, nil
}

// loadQualitySnapshotTx — тело загрузки в УЖЕ открытой транзакции. Позволяет
// Action Plan (этап 1.4) читать все три аналитики в одном REPEATABLE READ
// READ ONLY снапшоте без дублирования SQL.
func loadQualitySnapshotTx(ctx context.Context, tx pgx.Tx, tenderID string) (*quality.Snapshot, error) {
	s := &quality.Snapshot{}

	// 1. Tender: конфигурация + revision-состояние + generated_at из snapshot.
	err := tx.QueryRow(ctx, `
		SELECT id::text, usd_rate, eur_rate, cny_rate,
		       COALESCE(cached_grand_total, 0)::text,
		       markup_tactic_id::text,
		       financial_approved,
		       financial_input_revision, financial_calculation_revision,
		       financial_calculation_status, financial_calculation_error_code,
		       to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.tenders WHERE id = $1::uuid
	`, tenderID).Scan(
		&s.Tender.ID, &s.Tender.USDRate, &s.Tender.EURRate, &s.Tender.CNYRate,
		&s.Tender.CachedGrandTotal, &s.Tender.MarkupTacticID,
		&s.Tender.FinancialApproved,
		&s.Tender.FinancialInputRevision, &s.Tender.FinancialCalculationRevision,
		&s.Tender.FinancialCalculationStatus, &s.Tender.FinancialCalculationError,
		&s.GeneratedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrQualityTenderNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: tender: %w", err)
	}

	// 2. Positions (детерминированный порядок).
	rows, err := tx.Query(ctx, `
		SELECT id::text, position_number, COALESCE(work_name, ''),
		       COALESCE(total_material, 0), COALESCE(total_works, 0)
		FROM public.client_positions
		WHERE tender_id = $1::uuid
		ORDER BY position_number ASC, id ASC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: positions: %w", err)
	}
	idx := 0
	for rows.Next() {
		var p quality.SnapshotPosition
		if err := rows.Scan(&p.ID, &p.PositionNumber, &p.WorkName, &p.TotalMaterial, &p.TotalWorks); err != nil {
			rows.Close()
			return nil, fmt.Errorf("qualityRepo.LoadSnapshot: position scan: %w", err)
		}
		p.SortIndex = idx
		idx++
		s.Positions = append(s.Positions, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: positions rows: %w", err)
	}

	// 3. BOQ items: входы + persisted derived (для consistency-проверок).
	rows, err = tx.Query(ctx, `
		SELECT bi.id::text, bi.client_position_id::text, bi.boq_item_type::text,
		       bi.material_type::text, bi.description,
		       COALESCE(bi.material_name_id, bi.work_name_id)::text,
		       bi.unit_code, bi.quantity, bi.unit_rate,
		       COALESCE(bi.currency_type::text, ''),
		       bi.delivery_price_type::text, bi.delivery_amount,
		       bi.consumption_coefficient, bi.parent_work_item_id::text,
		       bi.detail_cost_category_id::text, bi.quote_link,
		       bi.total_amount,
		       bi.total_commercial_material_cost, bi.total_commercial_work_cost
		FROM public.boq_items bi
		WHERE bi.tender_id = $1::uuid
		ORDER BY bi.client_position_id ASC, bi.sort_number ASC, bi.id ASC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: items: %w", err)
	}
	for rows.Next() {
		var it quality.SnapshotItem
		if err := rows.Scan(
			&it.ID, &it.ClientPositionID, &it.BoqItemType,
			&it.MaterialType, &it.Description, &it.NameID,
			&it.UnitCode, &it.Quantity, &it.UnitRate,
			&it.CurrencyType,
			&it.DeliveryPriceType, &it.DeliveryAmount,
			&it.ConsumptionCoefficient, &it.ParentWorkItemID,
			&it.DetailCostCategoryID, &it.QuoteLink,
			&it.StoredTotalAmount,
			&it.TotalCommercialMaterialCost, &it.TotalCommercialWorkCost,
		); err != nil {
			rows.Close()
			return nil, fmt.Errorf("qualityRepo.LoadSnapshot: item scan: %w", err)
		}
		it.CommercialMaterialCostPresent = it.TotalCommercialMaterialCost != nil
		it.CommercialWorkCostPresent = it.TotalCommercialWorkCost != nil
		s.Items = append(s.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: items rows: %w", err)
	}

	// 4. Redistribution metadata (лёгкая проверка снапшота; полные prepared-
	// проверки живут на странице «Перераспределение»).
	if s.Tender.MarkupTacticID != nil {
		var rawRules []byte
		var rowCount int
		err = tx.QueryRow(ctx, `
			SELECT COALESCE((
			         SELECT redistribution_rules
			         FROM public.cost_redistribution_results
			         WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid
			           AND redistribution_rules IS NOT NULL
			         ORDER BY created_at ASC LIMIT 1
			       ), 'null'::jsonb),
			       (SELECT count(*) FROM public.cost_redistribution_results
			        WHERE tender_id = $1::uuid AND markup_tactic_id = $2::uuid)
		`, tenderID, *s.Tender.MarkupTacticID).Scan(&rawRules, &rowCount)
		if err != nil {
			return nil, fmt.Errorf("qualityRepo.LoadSnapshot: redistribution: %w", err)
		}
		if rowCount > 0 {
			s.Redistribution.Configured = true
			s.Redistribution.RowCount = rowCount
			var meta rulesServerMetadata
			if json.Unmarshal(rawRules, &meta) == nil {
				s.Redistribution.SchemaVersion = meta.SchemaVersion
				s.Redistribution.CalculationSource = meta.CalculationSource
				s.Redistribution.FinancialInputRevision = meta.FinancialInputRevision
			}
		}
	}

	// 5. Insurance + commercial агрегаты как EXACT decimal-строки — для
	// пересчёта cached_grand_total существующим decimal-ядром calc.
	err = tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.tender_insurance WHERE tender_id = $1::uuid),
		       COALESCE((SELECT COALESCE(judicial_pct,0)::text     FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(total_pct,0)::text        FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(apt_price_m2,0)::text     FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(apt_area,0)::text         FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(parking_price_m2,0)::text FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(parking_area,0)::text     FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(storage_price_m2,0)::text FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE((SELECT COALESCE(storage_area,0)::text     FROM public.tender_insurance WHERE tender_id = $1::uuid), '0'),
		       COALESCE(SUM(COALESCE(bi.total_commercial_material_cost, 0)), 0)::text,
		       COALESCE(SUM(COALESCE(bi.total_commercial_work_cost, 0)), 0)::text
		FROM public.boq_items bi
		WHERE bi.tender_id = $1::uuid
	`, tenderID).Scan(
		&s.Insurance.Present,
		&s.Insurance.JudicialPct, &s.Insurance.TotalPct,
		&s.Insurance.AptPriceM2, &s.Insurance.AptArea,
		&s.Insurance.ParkingPriceM2, &s.Insurance.ParkingArea,
		&s.Insurance.StoragePriceM2, &s.Insurance.StorageArea,
		&s.Insurance.CommercialMaterialTotalText, &s.Insurance.CommercialWorkTotalText,
	)
	if err != nil {
		return nil, fmt.Errorf("qualityRepo.LoadSnapshot: insurance/aggregates: %w", err)
	}

	return s, nil
}
