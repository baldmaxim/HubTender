package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// additionalPositionRow holds one row from client_positions where is_additional=true.
type additionalPositionRow struct {
	id               string
	parentPositionID *string
	itemNo           *string
	workName         string
	unitCode         *string
	volume           *float64
	clientNote       *string
	hierarchyLevel   int
	manualVolume     *float64
	manualNote       *string
	positionNumber   float64
}

// copyAdditionalPositions copies is_additional=true positions from the source
// tender to the new tender, resolving parent references via oldToNew or by
// item_no fallback (verbatim behaviour from execute_version_transfer lines 817-1073).
// Returns (copied, skipped, boqCopied, parentLinksRestored, error).
func copyAdditionalPositions(
	ctx context.Context,
	tx pgx.Tx,
	sourceTenderID string,
	newTenderID string,
	oldToNew map[string]string,
	oldItemIDToNew map[string]string,
) (int, int, int, int, error) {
	copied := 0
	skipped := 0
	boqCopied := 0
	parentLinksRestored := 0

	rows, err := tx.Query(ctx, `
		SELECT
			id::text, parent_position_id::text,
			item_no, work_name, unit_code,
			volume, client_note, COALESCE(hierarchy_level, 0),
			manual_volume, manual_note, position_number
		FROM public.client_positions
		WHERE tender_id = $1::uuid AND is_additional = true
		ORDER BY position_number, id
	`, sourceTenderID)
	if err != nil {
		return 0, 0, 0, 0, fmt.Errorf("transferRepo: fetch additional positions: %w", err)
	}

	var additionals []additionalPositionRow
	for rows.Next() {
		var a additionalPositionRow
		if err := rows.Scan(
			&a.id, &a.parentPositionID, &a.itemNo, &a.workName, &a.unitCode,
			&a.volume, &a.clientNote, &a.hierarchyLevel,
			&a.manualVolume, &a.manualNote, &a.positionNumber,
		); err != nil {
			rows.Close()
			return 0, 0, 0, 0, fmt.Errorf("transferRepo: scan additional position: %w", err)
		}
		additionals = append(additionals, a)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, 0, 0, fmt.Errorf("transferRepo: iterate additional positions: %w", err)
	}

	for _, ap := range additionals {
		if ap.parentPositionID == nil {
			skipped++
			continue
		}

		targetParentID, err := resolveAdditionalParent(
			ctx, tx, ap, newTenderID, oldToNew,
		)
		if err != nil {
			return 0, 0, 0, 0, err
		}
		if targetParentID == "" {
			skipped++
			continue
		}

		newAddPosID, err := insertAdditionalPosition(
			ctx, tx, ap, newTenderID, targetParentID,
		)
		if err != nil {
			return 0, 0, 0, 0, err
		}
		copied++

		b, p, err := copyAdditionalBoqItems(
			ctx, tx, ap.id, newAddPosID, newTenderID, oldItemIDToNew,
		)
		if err != nil {
			return 0, 0, 0, 0, err
		}
		boqCopied += b
		parentLinksRestored += p

		// Update total_material / total_works on the new additional position.
		if _, err := tx.Exec(ctx, `
			UPDATE public.client_positions
			SET
				total_material = COALESCE((
					SELECT SUM(CASE
						WHEN boq_item_type IN ('мат', 'суб-мат', 'мат-комп.')
						THEN COALESCE(total_amount, 0) ELSE 0 END)
					FROM public.boq_items WHERE client_position_id = $1::uuid
				), 0),
				total_works = COALESCE((
					SELECT SUM(CASE
						WHEN boq_item_type IN ('раб', 'суб-раб', 'раб-комп.')
						THEN COALESCE(total_amount, 0) ELSE 0 END)
					FROM public.boq_items WHERE client_position_id = $1::uuid
				), 0)
			WHERE id = $1::uuid
		`, newAddPosID); err != nil {
			return 0, 0, 0, 0, fmt.Errorf("transferRepo: update additional position totals: %w", err)
		}
	}

	return copied, skipped, boqCopied, parentLinksRestored, nil
}

// resolveAdditionalParent finds the new target parent ID for an additional position.
// Priority: direct oldToNew match, then item_no fuzzy fallback.
func resolveAdditionalParent(
	ctx context.Context,
	tx pgx.Tx,
	ap additionalPositionRow,
	newTenderID string,
	oldToNew map[string]string,
) (string, error) {
	if ap.parentPositionID == nil {
		return "", nil
	}

	if id, ok := oldToNew[*ap.parentPositionID]; ok {
		return id, nil
	}

	// Fallback: look up the old parent's item_no and position_number,
	// then find the closest matching new position by item_no.
	var parentItemNo *string
	var parentPosNum float64
	err := tx.QueryRow(ctx,
		`SELECT item_no, position_number FROM public.client_positions WHERE id = $1::uuid`,
		*ap.parentPositionID,
	).Scan(&parentItemNo, &parentPosNum)
	if err != nil && err != pgx.ErrNoRows {
		return "", fmt.Errorf("transferRepo: lookup old parent: %w", err)
	}
	if parentItemNo == nil {
		return "", nil
	}

	var targetID string
	// Closest before.
	_ = tx.QueryRow(ctx, `
		SELECT id::text
		FROM public.client_positions
		WHERE tender_id = $1::uuid AND is_additional = false
		  AND item_no = $2 AND position_number < $3
		ORDER BY position_number DESC, id DESC
		LIMIT 1
	`, newTenderID, *parentItemNo, parentPosNum).Scan(&targetID)

	if targetID == "" {
		// Closest after.
		_ = tx.QueryRow(ctx, `
			SELECT id::text
			FROM public.client_positions
			WHERE tender_id = $1::uuid AND is_additional = false
			  AND item_no = $2 AND position_number > $3
			ORDER BY position_number ASC, id ASC
			LIMIT 1
		`, newTenderID, *parentItemNo, parentPosNum).Scan(&targetID)
	}

	return targetID, nil
}

// insertAdditionalPosition inserts one is_additional position and returns its new UUID.
func insertAdditionalPosition(
	ctx context.Context,
	tx pgx.Tx,
	ap additionalPositionRow,
	newTenderID string,
	targetParentID string,
) (string, error) {
	var targetParentPosNum float64
	if err := tx.QueryRow(ctx,
		`SELECT position_number FROM public.client_positions WHERE id = $1::uuid`,
		targetParentID,
	).Scan(&targetParentPosNum); err != nil {
		return "", fmt.Errorf("transferRepo: get target parent position_number: %w", err)
	}

	var newPosNum float64
	if err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(position_number), $1) + 0.1
		FROM public.client_positions
		WHERE parent_position_id = $2::uuid AND is_additional = true
	`, targetParentPosNum, targetParentID).Scan(&newPosNum); err != nil {
		return "", fmt.Errorf("transferRepo: compute additional position_number: %w", err)
	}

	var newPosID string
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.client_positions (
			tender_id, position_number, item_no, work_name,
			unit_code, volume, client_note, hierarchy_level,
			is_additional, parent_position_id, manual_volume, manual_note
		) VALUES (
			$1::uuid, $2, NULL, $3,
			$4, $5, $6, $7,
			true, $8::uuid, $9, $10
		) RETURNING id::text
	`,
		newTenderID, newPosNum, ap.workName,
		ap.unitCode, ap.volume, ap.clientNote, ap.hierarchyLevel,
		targetParentID, ap.manualVolume, ap.manualNote,
	).Scan(&newPosID); err != nil {
		return "", fmt.Errorf("transferRepo: insert additional position: %w", err)
	}

	return newPosID, nil
}

// copyAdditionalBoqItems copies BOQ items from one additional position to its
// new counterpart, restores parent links, and records new IDs into oldItemIDToNew.
func copyAdditionalBoqItems(
	ctx context.Context,
	tx pgx.Tx,
	oldPosID string,
	newPosID string,
	newTenderID string,
	oldItemIDToNew map[string]string,
) (int, int, error) {
	type addBoqRow struct {
		oldItemID                   string
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
	}

	rows, err := tx.Query(ctx, `
		SELECT
			id::text, sort_number,
			boq_item_type::text, material_type::text,
			material_name_id::text, work_name_id::text,
			unit_code, quantity, base_quantity,
			consumption_coefficient, conversion_coefficient,
			delivery_price_type::text, delivery_amount,
			currency_type::text, total_amount,
			detail_cost_category_id::text, quote_link,
			commercial_markup,
			total_commercial_material_cost, total_commercial_work_cost,
			description, unit_rate,
			parent_work_item_id::text
		FROM public.boq_items
		WHERE client_position_id = $1::uuid
		ORDER BY sort_number, id
	`, oldPosID)
	if err != nil {
		return 0, 0, fmt.Errorf("transferRepo: fetch additional BOQ: %w", err)
	}

	var sources []addBoqRow
	for rows.Next() {
		var s addBoqRow
		if err := rows.Scan(
			&s.oldItemID, &s.sortNumber,
			&s.boqItemType, &s.materialType,
			&s.materialNameID, &s.workNameID,
			&s.unitCode, &s.quantity, &s.baseQuantity,
			&s.consumptionCoeff, &s.conversionCoeff,
			&s.deliveryPriceType, &s.deliveryAmount,
			&s.currencyType, &s.totalAmount,
			&s.detailCostCategoryID, &s.quoteLink,
			&s.commercialMarkup,
			&s.totalCommercialMaterialCost, &s.totalCommercialWorkCost,
			&s.description, &s.unitRate, &s.parentWorkItemID,
		); err != nil {
			rows.Close()
			return 0, 0, fmt.Errorf("transferRepo: scan additional BOQ row: %w", err)
		}
		sources = append(sources, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("transferRepo: iterate additional BOQ rows: %w", err)
	}

	const insertQ = `
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

	localOldToNew := make(map[string]string, len(sources))
	newIDs := make([]string, len(sources))

	for i, s := range sources {
		var newItemID string
		if err := tx.QueryRow(ctx, insertQ,
			newTenderID, newPosID, s.sortNumber,
			s.boqItemType, s.materialType, s.materialNameID, s.workNameID,
			s.unitCode, s.quantity, s.baseQuantity,
			s.consumptionCoeff, s.conversionCoeff,
			s.deliveryPriceType, s.deliveryAmount,
			s.currencyType, s.totalAmount,
			s.detailCostCategoryID, s.quoteLink, s.commercialMarkup,
			s.totalCommercialMaterialCost, s.totalCommercialWorkCost,
			s.description, s.unitRate,
		).Scan(&newItemID); err != nil {
			return 0, 0, fmt.Errorf("transferRepo: insert additional BOQ item: %w", err)
		}
		localOldToNew[s.oldItemID] = newItemID
		oldItemIDToNew[s.oldItemID] = newItemID
		newIDs[i] = newItemID
	}

	parentLinksRestored := 0
	for i, s := range sources {
		if s.parentWorkItemID == nil {
			continue
		}
		newParentID, ok := localOldToNew[*s.parentWorkItemID]
		if !ok {
			continue
		}
		tag, err := tx.Exec(ctx, `
			UPDATE public.boq_items SET parent_work_item_id = $1::uuid WHERE id = $2::uuid
		`, newParentID, newIDs[i])
		if err != nil {
			return 0, 0, fmt.Errorf("transferRepo: restore additional parent link: %w", err)
		}
		parentLinksRestored += int(tag.RowsAffected())
	}

	return len(sources), parentLinksRestored, nil
}
