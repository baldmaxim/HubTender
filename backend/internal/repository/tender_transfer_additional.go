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

// addPosPair maps a source additional position id to its new counterpart.
type addPosPair struct {
	oldPosID string
	newPosID string
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

	var addPosPairs []addPosPair
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
		addPosPairs = append(addPosPairs, addPosPair{oldPosID: ap.id, newPosID: newAddPosID})
	}

	// Batched BOQ copy across all additional positions in one set-based insert +
	// one bulk parent UPDATE. Parents resolve against the global oldItemIDToNew
	// (matched-position items already merged), since an additional material's
	// parent work may live in a matched position.
	//
	// Per-position total_material/total_works updates are intentionally dropped:
	// Step 11 in ExecuteVersionTransfer recomputes totals for every position in
	// the new tender (additional included) in a single statement afterwards.
	bc, pl, err := copyAdditionalBoqItemsBatched(
		ctx, tx, newTenderID, addPosPairs, oldItemIDToNew,
	)
	if err != nil {
		return 0, 0, 0, 0, err
	}
	boqCopied = bc
	parentLinksRestored = pl

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

// copyAdditionalBoqItemsBatched copies BOQ items for ALL additional positions
// in one set-based insert (parents NULL) + one bulk parent UPDATE, instead of a
// per-position/per-row loop. addPosPairs maps each source additional position to
// its new counterpart.
//
// Parent links resolve against the global oldItemIDToNew, which already contains
// matched-position items (an additional material's parent work may live in a
// matched position) and is extended in-place with the additional items' own ids
// by bulkCopyBoqItems before parent resolution — so within-batch parents resolve
// too. Returns (boqCopied, parentLinksRestored, error).
func copyAdditionalBoqItemsBatched(
	ctx context.Context,
	tx pgx.Tx,
	newTenderID string,
	addPosPairs []addPosPair,
	oldItemIDToNew map[string]string,
) (int, int, error) {
	if len(addPosPairs) == 0 {
		return 0, 0, nil
	}

	oldPosIDs := make([]string, len(addPosPairs))
	newPosIDs := make([]string, len(addPosPairs))
	for i, p := range addPosPairs {
		oldPosIDs[i] = p.oldPosID
		newPosIDs[i] = p.newPosID
	}

	mapped, err := bulkCopyBoqItems(ctx, tx, newTenderID, oldPosIDs, newPosIDs, oldItemIDToNew)
	if err != nil {
		return 0, 0, err
	}

	parentLinksRestored, err := restoreParentLinks(ctx, tx, mapped, oldItemIDToNew)
	if err != nil {
		return 0, 0, err
	}

	return len(mapped), parentLinksRestored, nil
}
