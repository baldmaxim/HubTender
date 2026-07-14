package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

// NewPositionInput describes one row of the incoming position list.
type NewPositionInput struct {
	RowIndex       int             `json:"row_index"`
	ItemNo         *string         `json:"item_no"`
	UnitCode       *string         `json:"unit_code"`
	ClientNote     *string         `json:"client_note"`
	WorkName       string          `json:"work_name"`
	Volume         *float64        `json:"volume"`
	HierarchyLevel *int            `json:"hierarchy_level"`
	RichRuns       json.RawMessage `json:"rich_runs"` // зачёркивание из Excel; NULL если нет
}

// MatchInput pairs an old client_position.id with the new row_index it maps to.
type MatchInput struct {
	OldPositionID string `json:"old_position_id"`
	NewRowIndex   int    `json:"new_row_index"`
}

// TransferInput is the full payload passed from the service to the repo.
type TransferInput struct {
	SourceTenderID string
	NewPositions   []NewPositionInput
	Matches        []MatchInput
	ChangedBy      string // app users UUID for audit attribution (app.user_id)
}

// TransferResult mirrors the JSONB returned by execute_version_transfer.
// JSON field names are verbatim from the SQL function spec.
type TransferResult struct {
	TenderID                    string `json:"tenderId"`
	Version                     int    `json:"version"`
	PositionsInserted           int    `json:"positionsInserted"`
	ManualTransferred           int    `json:"manualTransferred"`
	BoqItemsCopied              int    `json:"boqItemsCopied"`
	ParentLinksRestored         int    `json:"parentLinksRestored"`
	CostVolumesCopied           int    `json:"costVolumesCopied"`
	InsuranceRowsCopied         int    `json:"insuranceRowsCopied"`
	SubcontractExclusionsCopied int    `json:"subcontractExclusionsCopied"`
	PricingDistributionCopied   int    `json:"pricingDistributionCopied"`
	MarkupPercentageCopied      int    `json:"markupPercentageCopied"`
	AdditionalWorksCopied       int    `json:"additionalWorksCopied"`
	AdditionalWorksSkipped      int    `json:"additionalWorksSkipped"`
	UserFiltersTransferred      int    `json:"userFiltersTransferred"`
}

// ErrVersionTransfer is a typed error carrying an HTTP status so the handler
// can dispatch 404 vs 409 vs 500 without string matching.
type ErrVersionTransfer struct {
	HTTPStatus int
	Message    string
}

func (e *ErrVersionTransfer) Error() string { return e.Message }

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// TransferRepo runs execute_version_transfer logic in a single pgx.Tx.
type TransferRepo struct {
	pool *pgxpool.Pool
}

// NewTransferRepo creates a TransferRepo.
func NewTransferRepo(pool *pgxpool.Pool) *TransferRepo {
	return &TransferRepo{pool: pool}
}

// ExecuteVersionTransfer replicates execute_version_transfer from
// 00000000000005_baseline_functions.sql (lines 457-1162) in Go.
// All steps execute inside a single pgx.Tx; rollback is deferred on any error.
// Stage helpers live in sibling files: tender_transfer_tender.go (Steps 2-4),
// tender_transfer_positions.go (Steps 5-8), tender_transfer_boq.go (BOQ copy),
// tender_transfer_additional.go (additional works + user filters).
func (r *TransferRepo) ExecuteVersionTransfer(
	ctx context.Context,
	in TransferInput,
) (*TransferResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Атрибутируем создаваемые/обновляемые boq_items пользователю, выполнившему
	// перенос версии (иначе триггерный аудит запишет «Системную операцию»).
	if err := setAuditUser(ctx, tx, in.ChangedBy); err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: %w", err)
	}

	// Suppress the per-row grand-total recompute (O(N²) over boq_items) during
	// the bulk copy; recomputed once before commit (Step 13c). SET LOCAL is
	// transaction-scoped, so it cannot leak across PgBouncer-pooled connections.

	// Steps 2-4: fetch source tender, version check, insert new tender.
	newTenderID, newVersion, err := createNextTenderVersion(ctx, tx, in.SourceTenderID)
	if err != nil {
		return nil, err
	}

	// Step 5: Bulk-insert new client_positions.
	positionsInserted, err := insertNewPositions(ctx, tx, newTenderID, in.NewPositions)
	if err != nil {
		return nil, err
	}

	// Step 6: Build new-position map: row_index → new_position_id.
	newPosMap, err := buildNewPosMap(ctx, tx, newTenderID)
	if err != nil {
		return nil, err
	}

	// Step 7: Build old→new position mapping from matches.
	oldToNew := buildOldToNewMap(in.Matches, newPosMap)

	// Step 8: Transfer manual_volume / manual_note for matched positions.
	manualTransferred, err := transferManualFields(ctx, tx, oldToNew)
	if err != nil {
		return nil, err
	}

	// Step 9: Copy BOQ items for matched positions. oldItemTypes accumulates
	// old_item_id → boq_item_type so parent links can be validated (a parent must
	// be a WORK item) without an extra query.
	oldItemTypes := make(map[string]string)
	boqItemsCopied, parentLinksRestored, oldItemIDToNew, err :=
		copyMatchedBoqItems(ctx, tx, newTenderID, oldToNew, oldItemTypes)
	if err != nil {
		return nil, err
	}

	// Step 10: Copy additional positions — see tender_transfer_additional.go.
	addCopied, addSkipped, addBoqCopied, addParentRestored, err :=
		copyAdditionalPositions(ctx, tx, in.SourceTenderID, newTenderID, oldToNew, oldItemIDToNew, oldItemTypes)
	if err != nil {
		return nil, err
	}
	boqItemsCopied += addBoqCopied
	parentLinksRestored += addParentRestored

	// Step 10b (stage 0.1.2.2a): AUTHORITATIVE total_amount for every copied row.
	// The copy carried ONLY source inputs — total_amount/commercial_* were never
	// selected. Here each new row's total_amount is recomputed by
	// calc.CalculateBoqItemTotalAmount from its PERSISTED inputs and the TARGET
	// tender's FX rates (parent links are already restored, so calc sees the same
	// effective parent the row keeps). Rates are read ONCE; one bulk UPDATE.
	// Fail-closed: a missing target FX rate aborts and rolls the whole transfer back.
	newItemIDs := make([]string, 0, len(oldItemIDToNew))
	for _, newID := range oldItemIDToNew {
		newItemIDs = append(newItemIDs, newID)
	}
	if err := RecomputeBoqTotalAmountsTx(ctx, tx, newTenderID, newItemIDs); err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: %w", err)
	}

	// Step 11: Update total_material / total_works for all new positions.
	if _, err := tx.Exec(ctx, `
		UPDATE public.client_positions target_cp
		SET
			total_material = totals.total_material,
			total_works    = totals.total_works
		FROM (
			SELECT
				client_position_id,
				COALESCE(SUM(CASE
					WHEN boq_item_type IN ('мат', 'суб-мат', 'мат-комп.')
					THEN COALESCE(total_amount, 0) ELSE 0 END), 0) AS total_material,
				COALESCE(SUM(CASE
					WHEN boq_item_type IN ('раб', 'суб-раб', 'раб-комп.')
					THEN COALESCE(total_amount, 0) ELSE 0 END), 0) AS total_works
			FROM public.boq_items
			WHERE tender_id = $1::uuid
			GROUP BY client_position_id
		) totals
		WHERE target_cp.id = totals.client_position_id
	`, newTenderID); err != nil {
		return nil, fmt.Errorf("transferRepo: update position totals: %w", err)
	}

	// Step 12: Copy construction_cost_volumes.
	costVolumesTag, err := tx.Exec(ctx, `
		INSERT INTO public.construction_cost_volumes (
			tender_id, detail_cost_category_id, volume, group_key
		)
		SELECT $1::uuid, detail_cost_category_id, volume, group_key
		FROM public.construction_cost_volumes
		WHERE tender_id = $2::uuid
	`, newTenderID, in.SourceTenderID)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: copy cost volumes: %w", err)
	}

	// Step 13: Copy tender_insurance (ON CONFLICT DO UPDATE).
	insuranceTag, err := tx.Exec(ctx, `
		INSERT INTO public.tender_insurance (
			tender_id,
			judicial_pct, total_pct,
			apt_price_m2, apt_area,
			parking_price_m2, parking_area,
			storage_price_m2, storage_area
		)
		SELECT
			$1::uuid,
			judicial_pct, total_pct,
			apt_price_m2, apt_area,
			parking_price_m2, parking_area,
			storage_price_m2, storage_area
		FROM public.tender_insurance
		WHERE tender_id = $2::uuid
		ON CONFLICT (tender_id) DO UPDATE SET
			judicial_pct     = EXCLUDED.judicial_pct,
			total_pct        = EXCLUDED.total_pct,
			apt_price_m2     = EXCLUDED.apt_price_m2,
			apt_area         = EXCLUDED.apt_area,
			parking_price_m2 = EXCLUDED.parking_price_m2,
			parking_area     = EXCLUDED.parking_area,
			storage_price_m2 = EXCLUDED.storage_price_m2,
			storage_area     = EXCLUDED.storage_area
	`, newTenderID, in.SourceTenderID)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: copy tender insurance: %w", err)
	}

	// Step 13b: Copy subcontract_growth_exclusions (per-tender selections from
	// "Рост субподряда" tab in markup percentages page).
	subcontractExclusionsTag, err := tx.Exec(ctx, `
		INSERT INTO public.subcontract_growth_exclusions (
			tender_id, detail_cost_category_id, exclusion_type
		)
		SELECT $1::uuid, detail_cost_category_id, exclusion_type
		FROM public.subcontract_growth_exclusions
		WHERE tender_id = $2::uuid
		ON CONFLICT (tender_id, detail_cost_category_id, exclusion_type) DO NOTHING
	`, newTenderID, in.SourceTenderID)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: copy subcontract growth exclusions: %w", err)
	}

	// Step 13b': Copy tender_pricing_distribution (распределение наценки по столбцам
	// материалов/работ). Мирроринг clone_tender_as_new_version — паритет с «Дублировать».
	pricingDistTag, err := tx.Exec(ctx, `
		INSERT INTO public.tender_pricing_distribution (
			tender_id, markup_tactic_id,
			basic_material_base_target, basic_material_markup_target,
			auxiliary_material_base_target, auxiliary_material_markup_target,
			work_base_target, work_markup_target,
			subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
			subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
			component_material_base_target, component_material_markup_target,
			component_work_base_target, component_work_markup_target
		)
		SELECT
			$1::uuid, markup_tactic_id,
			basic_material_base_target, basic_material_markup_target,
			auxiliary_material_base_target, auxiliary_material_markup_target,
			work_base_target, work_markup_target,
			subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
			subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
			component_material_base_target, component_material_markup_target,
			component_work_base_target, component_work_markup_target
		FROM public.tender_pricing_distribution
		WHERE tender_id = $2::uuid
		ON CONFLICT (tender_id, markup_tactic_id) DO NOTHING
	`, newTenderID, in.SourceTenderID)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: copy pricing distribution: %w", err)
	}

	// Step 13b'': Copy tender_markup_percentage (значения процентов наценок со страницы
	// «Проценты наценок»). Должно лечь до Step 13c, чтобы grand total учёл наценки.
	markupPctTag, err := tx.Exec(ctx, `
		INSERT INTO public.tender_markup_percentage (tender_id, markup_parameter_id, value)
		SELECT $1::uuid, markup_parameter_id, value
		FROM public.tender_markup_percentage
		WHERE tender_id = $2::uuid
		ON CONFLICT (tender_id, markup_parameter_id) DO NOTHING
	`, newTenderID, in.SourceTenderID)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: copy markup percentages: %w", err)
	}

	// Step 13d: Carry every user's saved position filter onto the new version.
	// oldToNew maps matched normal positions (incl. section headers); the helper
	// re-expands selected sections over the new structure so rows added to a
	// selected section in this version are included and deleted rows are dropped.
	filtersTransferred, err := transferUserPositionFilters(ctx, tx, in.SourceTenderID, newTenderID, oldToNew)
	if err != nil {
		return nil, err
	}

	// Step 13b-bis (stage 0.1.2.2a): AUTHORITATIVE commercial values for the NEW
	// tender. Nothing commercial was copied from the source. They are computed by
	// the server (calc.CalculateBoqItemCost) from the TARGET tender's own
	// configuration — markup tactic, percentages, pricing distribution, exclusions —
	// and written through the internal writer, inside THIS transaction. The async
	// recalc queue is not the source of correctness.
	if err := MaterializeCommercialForTenderTx(ctx, tx, newTenderID); err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: %w", err)
	}

	// Step 13c: Recompute cached_grand_total once for the ONE tender this operation
	// created, via the canonical Go/calc helper (stage 0.1.2.4a). The source
	// tender is not modified (this is a copy, not a move), so it is not recomputed.
	if _, err := RecalculateTenderGrandTotalTx(ctx, tx, newTenderID); err != nil {
		return nil, fmt.Errorf("transferRepo: recompute grand total: %w", err)
	}

	// Step 14: Commit.
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: commit: %w", err)
	}

	return &TransferResult{
		TenderID:                    newTenderID,
		Version:                     newVersion,
		PositionsInserted:           positionsInserted,
		ManualTransferred:           manualTransferred,
		BoqItemsCopied:              boqItemsCopied,
		ParentLinksRestored:         parentLinksRestored,
		CostVolumesCopied:           int(costVolumesTag.RowsAffected()),
		InsuranceRowsCopied:         int(insuranceTag.RowsAffected()),
		SubcontractExclusionsCopied: int(subcontractExclusionsTag.RowsAffected()),
		PricingDistributionCopied:   int(pricingDistTag.RowsAffected()),
		MarkupPercentageCopied:      int(markupPctTag.RowsAffected()),
		AdditionalWorksCopied:       addCopied,
		AdditionalWorksSkipped:      addSkipped,
		UserFiltersTransferred:      filtersTransferred,
	}, nil
}
