package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Input / Output types
// ---------------------------------------------------------------------------

// NewPositionInput describes one row of the incoming position list.
type NewPositionInput struct {
	RowIndex       int      `json:"row_index"`
	ItemNo         *string  `json:"item_no"`
	UnitCode       *string  `json:"unit_code"`
	ClientNote     *string  `json:"client_note"`
	WorkName       string   `json:"work_name"`
	Volume         *float64 `json:"volume"`
	HierarchyLevel *int     `json:"hierarchy_level"`
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
}

// TransferResult mirrors the JSONB returned by execute_version_transfer.
// JSON field names are verbatim from the SQL function spec.
type TransferResult struct {
	TenderID               string `json:"tenderId"`
	Version                int    `json:"version"`
	PositionsInserted      int    `json:"positionsInserted"`
	ManualTransferred      int    `json:"manualTransferred"`
	BoqItemsCopied         int    `json:"boqItemsCopied"`
	ParentLinksRestored    int    `json:"parentLinksRestored"`
	CostVolumesCopied            int `json:"costVolumesCopied"`
	InsuranceRowsCopied          int `json:"insuranceRowsCopied"`
	SubcontractExclusionsCopied  int `json:"subcontractExclusionsCopied"`
	AdditionalWorksCopied        int `json:"additionalWorksCopied"`
	AdditionalWorksSkipped       int `json:"additionalWorksSkipped"`
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

type sourceTenderRow struct {
	ID, Title, ClientName, TenderNumber string
	Description, SubmissionDeadline     *string
	Version                             *int
	AreaClient, AreaSP                  *float64
	USDRate, EURRate, CNYRate           *float64
	UploadFolder, BSMLink               *string
	TZLink, QAFormLink                  *string
	MarkupTacticID                      *string
	ApplySubcontractWorksGrowth         *bool
	ApplySubcontractMatsGrowth          *bool
	HousingClass, ConstructionScope     *string
	ProjectFolderLink, VolumeTitle      *string
	IsArchived                          bool
}

// ExecuteVersionTransfer replicates execute_version_transfer from
// 00000000000005_baseline_functions.sql (lines 457-1162) in Go.
// All steps execute inside a single pgx.Tx; rollback is deferred on any error.
// Additional-works logic is in tender_transfer_additional.go.
func (r *TransferRepo) ExecuteVersionTransfer(
	ctx context.Context,
	in TransferInput,
) (*TransferResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Suppress the per-row grand-total recompute (O(N²) over boq_items) during
	// the bulk copy; recomputed once before commit (Step 13c). SET LOCAL is
	// transaction-scoped, so it cannot leak across PgBouncer-pooled connections.
	if _, err := tx.Exec(ctx, `SET LOCAL app.skip_grand_total = 'on'`); err != nil {
		return nil, fmt.Errorf("transferRepo: set skip_grand_total: %w", err)
	}

	// Step 2: Fetch source tender — 404 if missing.
	const fetchSourceQ = `
		SELECT
			id::text, title, description, client_name, tender_number,
			submission_deadline::text, version,
			area_client, area_sp, usd_rate, eur_rate, cny_rate,
			upload_folder, bsm_link, tz_link, qa_form_link,
			markup_tactic_id::text,
			apply_subcontract_works_growth, apply_subcontract_materials_growth,
			housing_class::text, construction_scope::text, project_folder_link,
			is_archived, volume_title
		FROM public.tenders
		WHERE id = $1::uuid
	`

	var src sourceTenderRow
	if err := tx.QueryRow(ctx, fetchSourceQ, in.SourceTenderID).Scan(
		&src.ID, &src.Title, &src.Description, &src.ClientName, &src.TenderNumber,
		&src.SubmissionDeadline, &src.Version,
		&src.AreaClient, &src.AreaSP, &src.USDRate, &src.EURRate, &src.CNYRate,
		&src.UploadFolder, &src.BSMLink, &src.TZLink, &src.QAFormLink,
		&src.MarkupTacticID,
		&src.ApplySubcontractWorksGrowth, &src.ApplySubcontractMatsGrowth,
		&src.HousingClass, &src.ConstructionScope, &src.ProjectFolderLink,
		&src.IsArchived, &src.VolumeTitle,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, &ErrVersionTransfer{
				HTTPStatus: 404,
				Message:    fmt.Sprintf("source tender %s not found", in.SourceTenderID),
			}
		}
		return nil, fmt.Errorf("transferRepo: fetch source tender: %w", err)
	}

	// Step 3: Compute next version — 409 if already exists.
	currentVersion := 0
	if src.Version != nil {
		currentVersion = *src.Version
	}
	newVersion := currentVersion + 1

	var versionExists bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM public.tenders
			WHERE tender_number = $1 AND version = $2
		)
	`, src.TenderNumber, newVersion).Scan(&versionExists); err != nil {
		return nil, fmt.Errorf("transferRepo: check version existence: %w", err)
	}
	if versionExists {
		return nil, &ErrVersionTransfer{
			HTTPStatus: 409,
			Message: fmt.Sprintf(
				"tender %s version %d already exists", src.TenderNumber, newVersion,
			),
		}
	}

	// Step 4: Insert new tender (copy of source, incremented version).
	const insertTenderQ = `
		INSERT INTO public.tenders (
			title, description, client_name, tender_number,
			submission_deadline, version, area_client, area_sp,
			usd_rate, eur_rate, cny_rate,
			upload_folder, bsm_link, tz_link, qa_form_link,
			markup_tactic_id,
			apply_subcontract_works_growth, apply_subcontract_materials_growth,
			housing_class, construction_scope, project_folder_link,
			is_archived, volume_title
		) VALUES (
			$1, $2, $3, $4,
			$5::timestamptz, $6, $7, $8,
			$9, $10, $11,
			$12, $13, $14, $15,
			$16::uuid,
			$17, $18,
			$19::public.housing_class_type, $20::public.construction_scope_type, $21,
			$22, $23
		)
		RETURNING id::text
	`

	var newTenderID string
	if err := tx.QueryRow(ctx, insertTenderQ,
		src.Title, src.Description, src.ClientName, src.TenderNumber,
		src.SubmissionDeadline, newVersion, src.AreaClient, src.AreaSP,
		src.USDRate, src.EURRate, src.CNYRate,
		src.UploadFolder, src.BSMLink, src.TZLink, src.QAFormLink,
		src.MarkupTacticID,
		src.ApplySubcontractWorksGrowth, src.ApplySubcontractMatsGrowth,
		src.HousingClass, src.ConstructionScope, src.ProjectFolderLink,
		src.IsArchived, src.VolumeTitle,
	).Scan(&newTenderID); err != nil {
		return nil, fmt.Errorf("transferRepo: insert new tender: %w", err)
	}

	// Step 5: Bulk-insert new client_positions.
	// LEFT JOIN units preserved — NULL inserted when unit_code absent from units table.
	positionsInserted := 0
	if len(in.NewPositions) > 0 {
		rowIndexes := make([]int, len(in.NewPositions))
		itemNos := make([]*string, len(in.NewPositions))
		hierarchyLevels := make([]int, len(in.NewPositions))
		workNames := make([]string, len(in.NewPositions))
		unitCodes := make([]*string, len(in.NewPositions))
		volumes := make([]*float64, len(in.NewPositions))
		clientNotes := make([]*string, len(in.NewPositions))

		for i, p := range in.NewPositions {
			rowIndexes[i] = p.RowIndex
			itemNos[i] = p.ItemNo
			if p.HierarchyLevel != nil {
				hierarchyLevels[i] = *p.HierarchyLevel
			}
			workNames[i] = p.WorkName
			unitCodes[i] = p.UnitCode
			volumes[i] = p.Volume
			clientNotes[i] = p.ClientNote
		}

		tag, err := tx.Exec(ctx, `
			INSERT INTO public.client_positions (
				tender_id, position_number, item_no, work_name,
				unit_code, volume, client_note, hierarchy_level,
				is_additional, parent_position_id, manual_volume, manual_note
			)
			SELECT
				$1::uuid, inp.row_index + 1, NULLIF(inp.item_no, ''), inp.work_name,
				u.code, inp.volume, NULLIF(inp.client_note, ''), inp.hierarchy_level,
				false, NULL, NULL, NULL
			FROM UNNEST(
				$2::integer[], $3::text[], $4::integer[], $5::text[],
				$6::text[], $7::numeric[], $8::text[]
			) AS inp(row_index, item_no, hierarchy_level, work_name, unit_code, volume, client_note)
			LEFT JOIN public.units u ON u.code = inp.unit_code
			ORDER BY inp.row_index
		`, newTenderID,
			rowIndexes, itemNos, hierarchyLevels, workNames, unitCodes, volumes, clientNotes,
		)
		if err != nil {
			return nil, fmt.Errorf("transferRepo: insert positions: %w", err)
		}
		positionsInserted = int(tag.RowsAffected())
	}

	// Step 6: Build new-position map: row_index → new_position_id.
	newPosMap := make(map[int]string)
	{
		rows, err := tx.Query(ctx, `
			SELECT cp.id::text, (cp.position_number::integer - 1) AS new_row_index
			FROM public.client_positions cp
			WHERE cp.tender_id = $1::uuid AND cp.is_additional = false
		`, newTenderID)
		if err != nil {
			return nil, fmt.Errorf("transferRepo: query new position map: %w", err)
		}
		for rows.Next() {
			var posID string
			var rowIdx int
			if err := rows.Scan(&posID, &rowIdx); err != nil {
				rows.Close()
				return nil, fmt.Errorf("transferRepo: scan new position map: %w", err)
			}
			newPosMap[rowIdx] = posID
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("transferRepo: iterate new position map: %w", err)
		}
	}

	// Step 7: Build old→new position mapping from matches.
	oldToNew := make(map[string]string, len(in.Matches))
	for _, m := range in.Matches {
		if newID, ok := newPosMap[m.NewRowIndex]; ok {
			oldToNew[m.OldPositionID] = newID
		}
	}

	// Step 8: Transfer manual_volume / manual_note for matched positions.
	manualTransferred := 0
	if len(oldToNew) > 0 {
		oldIDs := make([]string, 0, len(oldToNew))
		newIDs := make([]string, 0, len(oldToNew))
		for old, nw := range oldToNew {
			oldIDs = append(oldIDs, old)
			newIDs = append(newIDs, nw)
		}

		var tag pgconn.CommandTag
		tag, err = tx.Exec(ctx, `
			UPDATE public.client_positions new_cp
			SET
				manual_volume = old_cp.manual_volume,
				manual_note   = old_cp.manual_note
			FROM UNNEST($1::uuid[], $2::uuid[]) AS pairs(old_id, new_id)
			JOIN public.client_positions old_cp ON old_cp.id = pairs.old_id
			WHERE new_cp.id = pairs.new_id
		`, oldIDs, newIDs)
		if err != nil {
			return nil, fmt.Errorf("transferRepo: transfer manual fields: %w", err)
		}
		manualTransferred = int(tag.RowsAffected())
	}

	// Step 9: Copy BOQ items for matched positions.
	boqItemsCopied, parentLinksRestored, oldItemIDToNew, err :=
		copyMatchedBoqItems(ctx, tx, newTenderID, oldToNew)
	if err != nil {
		return nil, err
	}

	// Step 10: Copy additional positions — see tender_transfer_additional.go.
	addCopied, addSkipped, addBoqCopied, addParentRestored, err :=
		copyAdditionalPositions(ctx, tx, in.SourceTenderID, newTenderID, oldToNew, oldItemIDToNew)
	if err != nil {
		return nil, err
	}
	boqItemsCopied += addBoqCopied
	parentLinksRestored += addParentRestored

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

	// Step 13c: Recompute cached_grand_total once — the per-row trigger was
	// skipped via app.skip_grand_total. Runs unconditionally so the value is
	// correct regardless of which copy paths executed.
	if _, err := tx.Exec(ctx,
		`SELECT public.recalculate_tender_grand_total($1::uuid)`, newTenderID,
	); err != nil {
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
		AdditionalWorksCopied:       addCopied,
		AdditionalWorksSkipped:      addSkipped,
	}, nil
}

// boqMappedRow carries the new id of a freshly-inserted BOQ item together with
// the (old) parent item id it referenced in the source tender. Used to resolve
// parent_work_item_id in one bulk UPDATE after a set-based insert.
type boqMappedRow struct {
	newItemID       string
	parentOldItemID *string
}

// copyMatchedBoqItems copies BOQ items from matched positions using set-based
// SQL: one CTE INSERT (parents NULL) returning the old→new id mapping, then one
// bulk UPDATE to restore parent_work_item_id. Replaces the former per-row loop
// (~1 round-trip per item + per-item parent UPDATE) that caused 504 timeouts on
// large tenders. Returns (boqCopied, parentLinksRestored, oldItemIDToNew, error).
func copyMatchedBoqItems(
	ctx context.Context,
	tx pgx.Tx,
	newTenderID string,
	oldToNew map[string]string,
) (int, int, map[string]string, error) {
	oldItemIDToNew := make(map[string]string)

	if len(oldToNew) == 0 {
		return 0, 0, oldItemIDToNew, nil
	}

	oldPosIDs := make([]string, 0, len(oldToNew))
	newPosIDs := make([]string, 0, len(oldToNew))
	for old, nw := range oldToNew {
		oldPosIDs = append(oldPosIDs, old)
		newPosIDs = append(newPosIDs, nw)
	}

	mapped, err := bulkCopyBoqItems(ctx, tx, newTenderID, oldPosIDs, newPosIDs, oldItemIDToNew)
	if err != nil {
		return 0, 0, nil, err
	}

	// Parents of matched items always live within the matched set, so they are
	// resolvable against the freshly built oldItemIDToNew.
	parentLinksRestored, err := restoreParentLinks(ctx, tx, mapped, oldItemIDToNew)
	if err != nil {
		return 0, 0, nil, err
	}

	return len(mapped), parentLinksRestored, oldItemIDToNew, nil
}

// bulkCopyBoqItems inserts, in a single statement, all BOQ items of the source
// positions named by (oldPosIDs[i] → newPosIDs[i]) into newTenderID with
// parent_work_item_id = NULL. The `gen` CTE is MATERIALIZED so gen_random_uuid()
// runs exactly once per row and the same id feeds both the INSERT and the
// returned mapping. Each returned row is also recorded into accMap
// (old_item_id → new_item_id) so callers can resolve cross-position parents.
func bulkCopyBoqItems(
	ctx context.Context,
	tx pgx.Tx,
	newTenderID string,
	oldPosIDs []string,
	newPosIDs []string,
	accMap map[string]string,
) ([]boqMappedRow, error) {
	const q = `
		WITH src AS (
			SELECT
				old_boq.id                              AS old_item_id,
				pairs.new_id                            AS new_position_id,
				old_boq.parent_work_item_id             AS parent_old_item_id,
				old_boq.sort_number, old_boq.boq_item_type, old_boq.material_type,
				old_boq.material_name_id, old_boq.work_name_id, old_boq.unit_code,
				old_boq.quantity, old_boq.base_quantity,
				old_boq.consumption_coefficient, old_boq.conversion_coefficient,
				old_boq.delivery_price_type, old_boq.delivery_amount,
				old_boq.currency_type, old_boq.total_amount,
				old_boq.detail_cost_category_id, old_boq.quote_link, old_boq.commercial_markup,
				old_boq.total_commercial_material_cost, old_boq.total_commercial_work_cost,
				old_boq.description, old_boq.unit_rate
			FROM UNNEST($2::uuid[], $3::uuid[]) AS pairs(old_id, new_id)
			JOIN public.boq_items old_boq ON old_boq.client_position_id = pairs.old_id
		),
		gen AS MATERIALIZED (
			SELECT src.*, gen_random_uuid() AS new_item_id FROM src
		),
		ins AS (
			INSERT INTO public.boq_items (
				id, tender_id, client_position_id, sort_number,
				boq_item_type, material_type, material_name_id, work_name_id,
				unit_code, quantity, base_quantity,
				consumption_coefficient, conversion_coefficient,
				delivery_price_type, delivery_amount,
				currency_type, total_amount,
				detail_cost_category_id, quote_link, commercial_markup,
				total_commercial_material_cost, total_commercial_work_cost,
				parent_work_item_id, description, unit_rate
			)
			SELECT
				gen.new_item_id, $1::uuid, gen.new_position_id, gen.sort_number,
				gen.boq_item_type, gen.material_type, gen.material_name_id, gen.work_name_id,
				gen.unit_code, gen.quantity, gen.base_quantity,
				gen.consumption_coefficient, gen.conversion_coefficient,
				gen.delivery_price_type, gen.delivery_amount,
				gen.currency_type, gen.total_amount,
				gen.detail_cost_category_id, gen.quote_link, gen.commercial_markup,
				gen.total_commercial_material_cost, gen.total_commercial_work_cost,
				NULL, gen.description, gen.unit_rate
			FROM gen
		)
		SELECT
			gen.old_item_id::text,
			gen.new_item_id::text,
			gen.parent_old_item_id::text
		FROM gen
	`

	rows, err := tx.Query(ctx, q, newTenderID, oldPosIDs, newPosIDs)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: bulk insert BOQ items: %w", err)
	}
	var mapped []boqMappedRow
	for rows.Next() {
		var oldItemID, newItemID string
		var parentOldItemID *string
		if err := rows.Scan(&oldItemID, &newItemID, &parentOldItemID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("transferRepo: scan BOQ map row: %w", err)
		}
		accMap[oldItemID] = newItemID
		mapped = append(mapped, boqMappedRow{newItemID: newItemID, parentOldItemID: parentOldItemID})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("transferRepo: iterate BOQ map rows: %w", err)
	}
	return mapped, nil
}

// restoreParentLinks resolves parent_work_item_id for the given items against
// resolveMap (old_item_id → new_item_id) and applies them in one bulk UPDATE.
// Items whose parent is absent from resolveMap (parent in an unmatched position)
// are silently skipped. Returns the number of rows updated.
func restoreParentLinks(
	ctx context.Context,
	tx pgx.Tx,
	items []boqMappedRow,
	resolveMap map[string]string,
) (int, error) {
	childIDs := make([]string, 0, len(items))
	parentIDs := make([]string, 0, len(items))
	for _, it := range items {
		if it.parentOldItemID == nil {
			continue
		}
		newParent, ok := resolveMap[*it.parentOldItemID]
		if !ok {
			continue
		}
		childIDs = append(childIDs, it.newItemID)
		parentIDs = append(parentIDs, newParent)
	}
	if len(childIDs) == 0 {
		return 0, nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.boq_items b
		SET parent_work_item_id = u.new_parent
		FROM UNNEST($1::uuid[], $2::uuid[]) AS u(child_id, new_parent)
		WHERE b.id = u.child_id
	`, childIDs, parentIDs)
	if err != nil {
		return 0, fmt.Errorf("transferRepo: bulk restore parent links: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
