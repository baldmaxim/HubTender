package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// filterPosition mirrors the SectionPosition fields used by
// collectSectionDescendants on the frontend; rows are loaded ordered by
// (position_number, id) — the same order the table renders in.
type filterPosition struct {
	id               string
	hierarchyLevel   int
	isAdditional     bool
	parentPositionID *string
}

// collectSectionDescendants is a verbatim Go port of
// src/utils/positions/collectSectionDescendants.ts. Given the ordered position
// slice and a section id it returns that id plus every descendant in its
// hierarchy range, plus additional (ДОП) positions whose parent is in the set.
// Keeping it identical to the TS source guarantees the transferred filter
// matches what the user would get by toggling the section in the UI.
func collectSectionDescendants(positions []filterPosition, sectionID string) map[string]struct{} {
	result := make(map[string]struct{})

	clickedIndex := -1
	for i := range positions {
		if positions[i].id == sectionID {
			clickedIndex = i
			break
		}
	}
	if clickedIndex == -1 {
		return result
	}

	clickedLevel := positions[clickedIndex].hierarchyLevel
	result[sectionID] = struct{}{}

	for i := clickedIndex + 1; i < len(positions); i++ {
		pos := positions[i]
		if pos.isAdditional {
			continue
		}
		if pos.hierarchyLevel <= clickedLevel {
			break
		}
		result[pos.id] = struct{}{}
	}

	for _, pos := range positions {
		if pos.isAdditional && pos.parentPositionID != nil {
			if _, ok := result[*pos.parentPositionID]; ok {
				result[pos.id] = struct{}{}
			}
		}
	}

	return result
}

// transferUserPositionFilters copies every user's saved position filter from the
// source tender version onto the freshly-created version, in the same tx.
//
// Old position ids are mapped to new ones via oldToNew (matched normal
// positions); unmapped ids (deleted rows) are dropped. Each mapped id is then
// re-expanded with collectSectionDescendants over the NEW version's structure,
// so rows newly added inside a selected section are picked up automatically —
// the requirement: «в раздел добавилась строка → включить её в фильтр».
//
// Known limitation: an individually-selected ДОП row (is_additional=true, not
// selected through its section) is not carried over when oldToNew lacks it
// (Excel-matching path maps only normal positions). Selecting a whole section —
// the common case — restores its ДОП rows via the re-expansion above; the clone
// path maps ДОП rows directly, so they transfer there too.
func transferUserPositionFilters(
	ctx context.Context,
	tx pgx.Tx,
	oldTenderID, newTenderID string,
	oldToNew map[string]string,
) (int, error) {
	// Step 1: read every user's filter rows on the source version.
	filterRows, err := tx.Query(ctx, `
		SELECT user_id::text, position_id::text
		FROM public.user_position_filters
		WHERE tender_id = $1::uuid
	`, oldTenderID)
	if err != nil {
		return 0, fmt.Errorf("transferUserPositionFilters: query filters: %w", err)
	}
	byUser := make(map[string][]string)
	for filterRows.Next() {
		var userID, posID string
		if err := filterRows.Scan(&userID, &posID); err != nil {
			filterRows.Close()
			return 0, fmt.Errorf("transferUserPositionFilters: scan filter: %w", err)
		}
		byUser[userID] = append(byUser[userID], posID)
	}
	filterRows.Close()
	if err := filterRows.Err(); err != nil {
		return 0, fmt.Errorf("transferUserPositionFilters: iterate filters: %w", err)
	}
	if len(byUser) == 0 {
		return 0, nil
	}

	// Step 2: load the new version's positions in display order.
	posRows, err := tx.Query(ctx, `
		SELECT id::text, COALESCE(hierarchy_level, 0),
		       COALESCE(is_additional, false), parent_position_id::text
		FROM public.client_positions
		WHERE tender_id = $1::uuid
		ORDER BY position_number, id
	`, newTenderID)
	if err != nil {
		return 0, fmt.Errorf("transferUserPositionFilters: query new positions: %w", err)
	}
	var positions []filterPosition
	for posRows.Next() {
		var p filterPosition
		if err := posRows.Scan(&p.id, &p.hierarchyLevel, &p.isAdditional, &p.parentPositionID); err != nil {
			posRows.Close()
			return 0, fmt.Errorf("transferUserPositionFilters: scan position: %w", err)
		}
		positions = append(positions, p)
	}
	posRows.Close()
	if err := posRows.Err(); err != nil {
		return 0, fmt.Errorf("transferUserPositionFilters: iterate positions: %w", err)
	}

	// Step 3: build per-user new-version filter sets. Section expansions are
	// cached so a section header shared across users is computed once.
	expandCache := make(map[string]map[string]struct{})
	expand := func(id string) map[string]struct{} {
		if cached, ok := expandCache[id]; ok {
			return cached
		}
		res := collectSectionDescendants(positions, id)
		expandCache[id] = res
		return res
	}

	var userIDs, positionIDs []string
	for userID, oldPosIDs := range byUser {
		newSet := make(map[string]struct{})
		for _, oldID := range oldPosIDs {
			newID, ok := oldToNew[oldID]
			if !ok {
				continue // deleted row — drop
			}
			for id := range expand(newID) {
				newSet[id] = struct{}{}
			}
		}
		for id := range newSet {
			userIDs = append(userIDs, userID)
			positionIDs = append(positionIDs, id)
		}
	}
	if len(positionIDs) == 0 {
		return 0, nil
	}

	// Step 4: insert all (user, position) pairs in one statement.
	tag, err := tx.Exec(ctx, `
		INSERT INTO public.user_position_filters (user_id, tender_id, position_id)
		SELECT f.u, $2::uuid, f.p
		FROM UNNEST($1::uuid[], $3::uuid[]) AS f(u, p)
		ON CONFLICT (user_id, tender_id, position_id) DO NOTHING
	`, userIDs, newTenderID, positionIDs)
	if err != nil {
		return 0, fmt.Errorf("transferUserPositionFilters: insert: %w", err)
	}
	return int(tag.RowsAffected()), nil
}
