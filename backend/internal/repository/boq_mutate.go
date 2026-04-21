package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// UpdateBoqItem applies non-nil fields from in, writes an UPDATE audit row,
// all in one transaction. Returns the updated row.
func (r *BoqRepo) UpdateBoqItem(ctx context.Context, id string, in UpdateBoqItemInput) (*BoqItemRow, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lock and fetch current row inside the transaction.
	lockQ := "SELECT " + boqScanCols + " FROM public.boq_items WHERE id = $1 FOR UPDATE"
	oldItem, err := scanBoqItemRow(tx.QueryRow(ctx, lockQ, id))
	if err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: lock row: %w", err)
	}

	args := []any{}
	argN := 1
	setClauses := ""

	set := func(col string, val any) {
		if setClauses != "" {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", col, argN)
		args = append(args, val)
		argN++
	}

	if in.BoqItemType != nil {
		set("boq_item_type", *in.BoqItemType)
	}
	if in.MaterialType != nil {
		set("material_type", *in.MaterialType)
	}
	if in.Description != nil {
		set("description", *in.Description)
	}
	if in.UnitCode != nil {
		set("unit_code", *in.UnitCode)
	}
	if in.Quantity != nil {
		set("quantity", *in.Quantity)
	}
	if in.UnitRate != nil {
		set("unit_rate", *in.UnitRate)
	}
	if in.CurrencyType != nil {
		set("currency_type", *in.CurrencyType)
	}
	if in.DeliveryPriceType != nil {
		set("delivery_price_type", *in.DeliveryPriceType)
	}
	if in.DeliveryAmount != nil {
		set("delivery_amount", *in.DeliveryAmount)
	}
	if in.DetailCostCategoryID != nil {
		set("detail_cost_category_id", *in.DetailCostCategoryID)
	}
	if in.MaterialNameID != nil {
		set("material_name_id", *in.MaterialNameID)
	}
	if in.WorkNameID != nil {
		set("work_name_id", *in.WorkNameID)
	}
	if in.ParentWorkItemID != nil {
		set("parent_work_item_id", *in.ParentWorkItemID)
	}
	if in.SortNumber != nil {
		set("sort_number", *in.SortNumber)
	}

	var newItem *BoqItemRow
	if setClauses == "" {
		newItem = oldItem
	} else {
		setClauses += ", updated_at = NOW()"
		args = append(args, id)
		updQ := fmt.Sprintf("UPDATE public.boq_items SET %s WHERE id = $%d RETURNING "+boqScanCols,
			setClauses, argN)
		newItem, err = scanBoqItemRow(tx.QueryRow(ctx, updQ, args...))
		if err != nil {
			return nil, fmt.Errorf("boqRepo.UpdateBoqItem: update scan: %w", err)
		}
	}

	oldJSON, _ := boqRowJSON(oldItem)
	newJSON, _ := boqRowJSON(newItem)
	fields := changedFields(oldItem, newItem)

	if err := insertAudit(ctx, tx, id, "UPDATE", in.ChangedBy, fields, oldJSON, newJSON); err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("boqRepo.UpdateBoqItem: commit: %w", err)
	}
	return newItem, nil
}

// DeleteBoqItem deletes a boq_item and writes a DELETE audit row, all in one
// transaction. Returns the deleted row so the caller can include it in the
// response body.
func (r *BoqRepo) DeleteBoqItem(ctx context.Context, id, changedBy string) (*BoqItemRow, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Lock the row first so we capture a stable snapshot for the audit.
	lockQ := "SELECT " + boqScanCols + " FROM public.boq_items WHERE id = $1 FOR UPDATE"
	item, err := scanBoqItemRow(tx.QueryRow(ctx, lockQ, id))
	if err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: lock row: %w", err)
	}

	if _, err := tx.Exec(ctx, "DELETE FROM public.boq_items WHERE id = $1", id); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: delete: %w", err)
	}

	oldJSON, _ := boqRowJSON(item)
	if err := insertAudit(ctx, tx, id, "DELETE", changedBy, nil, oldJSON, nil); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("boqRepo.DeleteBoqItem: commit: %w", err)
	}
	return item, nil
}
