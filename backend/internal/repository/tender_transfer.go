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
	CostVolumesCopied      int    `json:"costVolumesCopied"`
	InsuranceRowsCopied    int    `json:"insuranceRowsCopied"`
	AdditionalWorksCopied  int    `json:"additionalWorksCopied"`
	AdditionalWorksSkipped int    `json:"additionalWorksSkipped"`
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

	// Step 14: Commit.
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("transferRepo.ExecuteVersionTransfer: commit: %w", err)
	}

	return &TransferResult{
		TenderID:               newTenderID,
		Version:                newVersion,
		PositionsInserted:      positionsInserted,
		ManualTransferred:      manualTransferred,
		BoqItemsCopied:         boqItemsCopied,
		ParentLinksRestored:    parentLinksRestored,
		CostVolumesCopied:      int(costVolumesTag.RowsAffected()),
		InsuranceRowsCopied:    int(insuranceTag.RowsAffected()),
		AdditionalWorksCopied:  addCopied,
		AdditionalWorksSkipped: addSkipped,
	}, nil
}

// copyMatchedBoqItems copies BOQ items from matched positions.
// Returns (boqCopied, parentLinksRestored, oldItemIDToNew, error).
func copyMatchedBoqItems(
	ctx context.Context,
	tx pgx.Tx,
	newTenderID string,
	oldToNew map[string]string,
) (int, int, map[string]string, error) {
	oldItemIDToNew := make(map[string]string)
	boqCopied := 0
	parentLinksRestored := 0

	if len(oldToNew) == 0 {
		return 0, 0, oldItemIDToNew, nil
	}

	oldIDs := make([]string, 0, len(oldToNew))
	newIDs := make([]string, 0, len(oldToNew))
	for old, nw := range oldToNew {
		oldIDs = append(oldIDs, old)
		newIDs = append(newIDs, nw)
	}

	type boqSourceRow struct {
		oldItemID                   string
		newPositionID               string
		sortNumber                  int
		boqItemType                 string
		materialType                *string
		materialNameID              *string
		workNameID                  *string
		unitCode                    *string
		quantity                    *float64
		baseQuantity                *float64
		consumptionCoeff            *float64
		conversionCoeff             *float64
		deliveryPriceType           *string
		deliveryAmount              *float64
		currencyType                *string
		totalAmount                 *float64
		detailCostCategoryID        *string
		quoteLink                   *string
		commercialMarkup            *float64
		totalCommercialMaterialCost *float64
		totalCommercialWorkCost     *float64
		description                 *string
		unitRate                    *float64
		parentWorkItemID            *string
		sourceSeq                   int64
	}

	boqRows, err := tx.Query(ctx, `
		SELECT
			old_boq.id::text, pairs.new_id::text,
			old_boq.sort_number,
			old_boq.boq_item_type::text, old_boq.material_type::text,
			old_boq.material_name_id::text, old_boq.work_name_id::text,
			old_boq.unit_code, old_boq.quantity, old_boq.base_quantity,
			old_boq.consumption_coefficient, old_boq.conversion_coefficient,
			old_boq.delivery_price_type::text, old_boq.delivery_amount,
			old_boq.currency_type::text, old_boq.total_amount,
			old_boq.detail_cost_category_id::text, old_boq.quote_link,
			old_boq.commercial_markup,
			old_boq.total_commercial_material_cost, old_boq.total_commercial_work_cost,
			old_boq.description, old_boq.unit_rate,
			old_boq.parent_work_item_id::text,
			ROW_NUMBER() OVER (
				PARTITION BY old_boq.client_position_id
				ORDER BY old_boq.sort_number, old_boq.id
			) AS source_seq
		FROM UNNEST($1::uuid[], $2::uuid[]) AS pairs(old_id, new_id)
		JOIN public.boq_items old_boq ON old_boq.client_position_id = pairs.old_id
		ORDER BY pairs.new_id, source_seq
	`, oldIDs, newIDs)
	if err != nil {
		return 0, 0, nil, fmt.Errorf("transferRepo: fetch BOQ source rows: %w", err)
	}

	var sources []boqSourceRow
	for boqRows.Next() {
		var s boqSourceRow
		if err := boqRows.Scan(
			&s.oldItemID, &s.newPositionID, &s.sortNumber,
			&s.boqItemType, &s.materialType, &s.materialNameID, &s.workNameID,
			&s.unitCode, &s.quantity, &s.baseQuantity,
			&s.consumptionCoeff, &s.conversionCoeff,
			&s.deliveryPriceType, &s.deliveryAmount,
			&s.currencyType, &s.totalAmount,
			&s.detailCostCategoryID, &s.quoteLink,
			&s.commercialMarkup,
			&s.totalCommercialMaterialCost, &s.totalCommercialWorkCost,
			&s.description, &s.unitRate, &s.parentWorkItemID, &s.sourceSeq,
		); err != nil {
			boqRows.Close()
			return 0, 0, nil, fmt.Errorf("transferRepo: scan BOQ source row: %w", err)
		}
		sources = append(sources, s)
	}
	boqRows.Close()
	if err := boqRows.Err(); err != nil {
		return 0, 0, nil, fmt.Errorf("transferRepo: iterate BOQ source rows: %w", err)
	}

	newItemIDs := make([]string, len(sources))
	const insertBoqQ = `
		INSERT INTO public.boq_items (
			tender_id, client_position_id, sort_number,
			boq_item_type, material_type, material_name_id, work_name_id,
			unit_code, quantity, base_quantity,
			consumption_coefficient, conversion_coefficient,
			delivery_price_type, delivery_amount,
			currency_type, total_amount,
			detail_cost_category_id, quote_link, commercial_markup,
			total_commercial_material_cost, total_commercial_work_cost,
			parent_work_item_id, description, unit_rate
		) VALUES (
			$1::uuid, $2::uuid, $3,
			$4::public.boq_item_type, $5::public.material_type, $6::uuid, $7::uuid,
			$8, $9, $10, $11, $12,
			$13::public.delivery_price_type, $14,
			$15::public.currency_type, $16,
			$17::uuid, $18, $19, $20, $21,
			NULL, $22, $23
		)
		RETURNING id::text
	`

	for i, s := range sources {
		var newItemID string
		if err := tx.QueryRow(ctx, insertBoqQ,
			newTenderID, s.newPositionID, s.sortNumber,
			s.boqItemType, s.materialType, s.materialNameID, s.workNameID,
			s.unitCode, s.quantity, s.baseQuantity,
			s.consumptionCoeff, s.conversionCoeff,
			s.deliveryPriceType, s.deliveryAmount,
			s.currencyType, s.totalAmount,
			s.detailCostCategoryID, s.quoteLink, s.commercialMarkup,
			s.totalCommercialMaterialCost, s.totalCommercialWorkCost,
			s.description, s.unitRate,
		).Scan(&newItemID); err != nil {
			return 0, 0, nil, fmt.Errorf("transferRepo: insert BOQ item: %w", err)
		}
		boqCopied++
		oldItemIDToNew[s.oldItemID] = newItemID
		newItemIDs[i] = newItemID
	}

	// Restore parent_work_item_id links.
	for i, s := range sources {
		if s.parentWorkItemID == nil {
			continue
		}
		newParentID, ok := oldItemIDToNew[*s.parentWorkItemID]
		if !ok {
			continue
		}
		tag, err := tx.Exec(ctx, `
			UPDATE public.boq_items SET parent_work_item_id = $1::uuid WHERE id = $2::uuid
		`, newParentID, newItemIDs[i])
		if err != nil {
			return 0, 0, nil, fmt.Errorf("transferRepo: restore parent link: %w", err)
		}
		parentLinksRestored += int(tag.RowsAffected())
	}

	return boqCopied, parentLinksRestored, oldItemIDToNew, nil
}
