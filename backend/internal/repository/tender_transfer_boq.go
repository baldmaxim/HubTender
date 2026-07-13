package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// boqMappedRow carries the new id of a freshly-inserted BOQ item together with
// the (old) parent item id it referenced in the source tender. Used to resolve
// parent_work_item_id in one bulk UPDATE after a set-based insert.
type boqMappedRow struct {
	oldItemID       string
	newItemID       string
	parentOldItemID *string
	itemType        string
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
	oldItemTypes map[string]string,
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

	mapped, err := bulkCopyBoqItems(ctx, tx, newTenderID, oldPosIDs, newPosIDs, oldItemIDToNew, oldItemTypes)
	if err != nil {
		return 0, 0, nil, err
	}

	// Parents of matched items live within the matched set (parent_work_item_id
	// never crosses a position), so they must resolve — an unresolvable one is a
	// blocking error, not a silently cleared link.
	parentLinksRestored, err := restoreParentLinks(ctx, tx, mapped, oldItemIDToNew, oldItemTypes)
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
	accTypes map[string]string,
) ([]boqMappedRow, error) {
	// CLASS A (source inputs) ONLY. total_amount, commercial_markup and
	// total_commercial_* are CALCULATED values: they are deliberately absent from
	// both the SELECT and the INSERT column list, so they can never be carried over
	// from the source as authoritative. They stay NULL until the authoritative
	// recompute runs later in the SAME transaction (see ExecuteVersionTransfer:
	// RecomputeBoqTotalAmountsTx + MaterializeCommercialForTenderTx).
	const q = `
		WITH src AS (
			SELECT
				old_boq.id                              AS old_item_id,
				pairs.new_id                            AS new_position_id,
				old_boq.parent_work_item_id             AS parent_old_item_id,
				old_boq.boq_item_type                   AS item_type,
				old_boq.sort_number, old_boq.material_type,
				old_boq.material_name_id, old_boq.work_name_id, old_boq.unit_code,
				old_boq.quantity, old_boq.base_quantity,
				old_boq.consumption_coefficient, old_boq.conversion_coefficient,
				old_boq.delivery_price_type, old_boq.delivery_amount,
				old_boq.currency_type,
				old_boq.detail_cost_category_id, old_boq.quote_link,
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
				currency_type,
				detail_cost_category_id, quote_link,
				parent_work_item_id, description, unit_rate
			)
			SELECT
				gen.new_item_id, $1::uuid, gen.new_position_id, gen.sort_number,
				gen.item_type, gen.material_type, gen.material_name_id, gen.work_name_id,
				gen.unit_code, gen.quantity, gen.base_quantity,
				gen.consumption_coefficient, gen.conversion_coefficient,
				gen.delivery_price_type, gen.delivery_amount,
				gen.currency_type,
				gen.detail_cost_category_id, gen.quote_link,
				NULL, gen.description, gen.unit_rate
			FROM gen
		)
		SELECT
			gen.old_item_id::text,
			gen.new_item_id::text,
			gen.parent_old_item_id::text,
			gen.item_type::text
		FROM gen
	`

	rows, err := tx.Query(ctx, q, newTenderID, oldPosIDs, newPosIDs)
	if err != nil {
		return nil, fmt.Errorf("transferRepo: bulk insert BOQ items: %w", err)
	}
	var mapped []boqMappedRow
	for rows.Next() {
		var oldItemID, newItemID, itemType string
		var parentOldItemID *string
		if err := rows.Scan(&oldItemID, &newItemID, &parentOldItemID, &itemType); err != nil {
			rows.Close()
			return nil, fmt.Errorf("transferRepo: scan BOQ map row: %w", err)
		}
		accMap[oldItemID] = newItemID
		accTypes[oldItemID] = itemType
		mapped = append(mapped, boqMappedRow{
			oldItemID:       oldItemID,
			newItemID:       newItemID,
			parentOldItemID: parentOldItemID,
			itemType:        itemType,
		})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("transferRepo: iterate BOQ map rows: %w", err)
	}
	return mapped, nil
}

// restoreParentLinks resolves parent_work_item_id for the given items against
// resolveMap (old_item_id → new_item_id) and applies them in one bulk UPDATE.
//
// FAIL-CLOSED (stage 0.1.2.2a): a declared parent that cannot be remapped to a
// copied WORK row is a blocking InvalidBoqParentError. Previously such links were
// silently skipped, which left the target child as a standalone row — and calc
// would then apply its consumption coefficient, silently changing the money.
// A source parent UUID is never written into the target tender.
func restoreParentLinks(
	ctx context.Context,
	tx pgx.Tx,
	items []boqMappedRow,
	resolveMap map[string]string,
	typeByOldID map[string]string,
) (int, error) {
	childIDs := make([]string, 0, len(items))
	parentIDs := make([]string, 0, len(items))
	for _, it := range items {
		if it.parentOldItemID == nil {
			continue
		}
		pOld := *it.parentOldItemID

		if pOld == it.oldItemID {
			return 0, &InvalidBoqParentError{
				ItemID: it.oldItemID, ParentItemID: pOld, Reason: BoqSelfParentReference,
			}
		}
		newParent, ok := resolveMap[pOld]
		if !ok {
			return 0, &InvalidBoqParentError{
				ItemID: it.oldItemID, ParentItemID: pOld, Reason: BoqParentNotCopied,
			}
		}
		if pType, known := typeByOldID[pOld]; !known || !calc.IsWorkBoqType(pType) {
			return 0, &InvalidBoqParentError{
				ItemID: it.oldItemID, ParentItemID: pOld, Reason: BoqParentNotWorkItem,
				ParentItemType: pType,
			}
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
