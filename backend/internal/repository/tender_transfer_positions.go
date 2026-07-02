package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// insertNewPositions bulk-inserts the incoming position list into the new
// tender (Step 5). LEFT JOIN units preserved — NULL inserted when unit_code
// is absent from the units table. Returns the number of rows inserted.
func insertNewPositions(
	ctx context.Context,
	tx pgx.Tx,
	newTenderID string,
	positions []NewPositionInput,
) (int, error) {
	if len(positions) == 0 {
		return 0, nil
	}

	rowIndexes := make([]int, len(positions))
	itemNos := make([]*string, len(positions))
	hierarchyLevels := make([]int, len(positions))
	workNames := make([]string, len(positions))
	unitCodes := make([]*string, len(positions))
	volumes := make([]*float64, len(positions))
	clientNotes := make([]*string, len(positions))

	for i, p := range positions {
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
		return 0, fmt.Errorf("transferRepo: insert positions: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// buildNewPosMap reads the freshly-inserted positions back and maps
// row_index → new position id (Step 6).
func buildNewPosMap(ctx context.Context, tx pgx.Tx, newTenderID string) (map[int]string, error) {
	newPosMap := make(map[int]string)
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
	return newPosMap, nil
}

// buildOldToNewMap resolves the old→new position mapping from the incoming
// matches (Step 7). Pure function, no DB access.
func buildOldToNewMap(matches []MatchInput, newPosMap map[int]string) map[string]string {
	oldToNew := make(map[string]string, len(matches))
	for _, m := range matches {
		if newID, ok := newPosMap[m.NewRowIndex]; ok {
			oldToNew[m.OldPositionID] = newID
		}
	}
	return oldToNew
}

// transferManualFields copies manual_volume / manual_note from matched old
// positions onto their new counterparts (Step 8). Returns rows updated.
func transferManualFields(ctx context.Context, tx pgx.Tx, oldToNew map[string]string) (int, error) {
	if len(oldToNew) == 0 {
		return 0, nil
	}
	oldIDs := make([]string, 0, len(oldToNew))
	newIDs := make([]string, 0, len(oldToNew))
	for old, nw := range oldToNew {
		oldIDs = append(oldIDs, old)
		newIDs = append(newIDs, nw)
	}

	tag, err := tx.Exec(ctx, `
		UPDATE public.client_positions new_cp
		SET
			manual_volume = old_cp.manual_volume,
			manual_note   = old_cp.manual_note
		FROM UNNEST($1::uuid[], $2::uuid[]) AS pairs(old_id, new_id)
		JOIN public.client_positions old_cp ON old_cp.id = pairs.old_id
		WHERE new_cp.id = pairs.new_id
	`, oldIDs, newIDs)
	if err != nil {
		return 0, fmt.Errorf("transferRepo: transfer manual fields: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
