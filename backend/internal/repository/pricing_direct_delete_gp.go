package repository

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/pricing"
)

// ErrPositionGPUnchanged — the requested Количество ГП / note equal the current values.
var ErrPositionGPUnchanged = errors.New("DIRECT_GP_UNCHANGED: Количество ГП и примечание уже такие; изменений нет")

// DirectDeleteCommit deletes one VOR row through MCP. Deleting a work deletes
// its linked materials too (FK cascade), so all of them must be the caller's.
type DirectDeleteCommit struct {
	Preview          bool
	TenderID         string
	ActorID          string
	RequestKey       string
	RequestHash      string
	ExpectedRevision int64
	ItemID           string
	ExpectedETag     string
}

// ApplyDirectDelete deletes the row in one transaction with revision/ETag
// checks, curated DELETE audit for every removed row and recalculated totals.
// Preview runs the same path and rolls back.
func (r *PricingRepo) ApplyDirectDelete(ctx context.Context, in DirectDeleteCommit) (result *pricing.DirectDeleteResult, err error) {
	defer mapDirectPricingBusy(&err)
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := setAuditUser(ctx, tx, in.ActorID); err != nil {
		return nil, err
	}
	if !in.Preview {
		raw, err := claimDirectReceiptTx(ctx, tx, in.ActorID, in.RequestKey, in.RequestHash, in.TenderID)
		if err != nil {
			return nil, err
		}
		if raw != nil {
			var prior pricing.DirectDeleteResult
			if err := json.Unmarshal(raw, &prior); err != nil {
				return nil, err
			}
			prior.Replayed = true
			return &prior, nil
		}
	}
	if err := lockDirectRevisionTx(ctx, tx, in.TenderID, in.ExpectedRevision); err != nil {
		return nil, err
	}
	item, err := scanBoqItemRow(tx.QueryRow(ctx, "SELECT "+boqScanCols+" FROM public.boq_items WHERE id=$1 FOR UPDATE NOWAIT", in.ItemID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDirectPricingStale
		}
		return nil, err
	}
	if item.TenderID != in.TenderID || pricingETag(item.ID, item.UpdatedAt) != in.ExpectedETag {
		return nil, ErrDirectPricingStale
	}
	if _, err := tx.Exec(ctx, `SELECT 1 FROM public.client_positions WHERE id=$1 FOR UPDATE NOWAIT`, item.ClientPositionID); err != nil {
		return nil, err
	}
	changeCtx, _, err := changeContextTx(ctx, tx, item.ClientPositionID)
	if err != nil {
		return nil, err
	}
	children := []*BoqItemRow{}
	if calc.IsWorkBoqType(item.BoqItemType) {
		children, err = lockLinkedMaterialsTx(ctx, tx, item.ID)
		if err != nil {
			return nil, err
		}
	}
	ids := []string{item.ID}
	for _, child := range children {
		ids = append(ids, child.ID)
	}
	rows, err := boqRowAuthorsTx(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	if err := requireMCPRowAuthors(in.ActorID, rows); err != nil {
		return nil, err
	}
	changeCtx.RowAuthor = rows[0].Author
	if changeCtx.Category, err = categoryNameTx(ctx, tx, item.DetailCostCategoryID); err != nil {
		return nil, err
	}
	deleted := make([]pricing.RowChange, 0, len(rows))
	for _, row := range rows {
		deleted = append(deleted, row.RowChange)
	}

	// Curated DELETE audit for the row and every cascaded material.
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, err
	}
	newRevision, err := MarkTenderFinancialInputsChangedTx(ctx, tx, in.TenderID, "mcp_direct_delete")
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM public.boq_items WHERE id=$1`, item.ID); err != nil {
		return nil, err
	}
	positionIDs := []string{item.ClientPositionID}
	for _, removed := range append([]*BoqItemRow{item}, children...) {
		oldJSON, _ := boqRowJSON(removed)
		if err := insertAudit(ctx, tx, removed.ID, "DELETE", in.ActorID, nil, oldJSON, nil); err != nil {
			return nil, err
		}
		if removed.ClientPositionID != item.ClientPositionID {
			positionIDs = append(positionIDs, removed.ClientPositionID)
		}
	}
	if err := recomputePositionTotalsByIDsTx(ctx, tx, positionIDs); err != nil {
		return nil, err
	}
	if _, err := RecalculateTenderGrandTotalTx(ctx, tx, in.TenderID); err != nil {
		return nil, err
	}
	result = &pricing.DirectDeleteResult{
		RequestKey: in.RequestKey, TenderID: in.TenderID, PositionID: item.ClientPositionID,
		ItemID: item.ID, Deleted: deleted, FinancialInputRevision: newRevision, Context: changeCtx,
	}
	if err := tx.QueryRow(ctx, `SELECT COALESCE(total_material,0)+COALESCE(total_works,0)
		FROM public.client_positions WHERE id=$1`, item.ClientPositionID).Scan(&result.PositionTotal); err != nil {
		return nil, err
	}
	if in.Preview {
		return result, nil
	}
	if err := storeDirectReceiptTx(ctx, tx, in.ActorID, in.RequestKey, result); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// PositionGPCommit changes Количество ГП and/or its note through MCP. Nil
// leaves a field unchanged; an empty note clears it.
type PositionGPCommit struct {
	Preview          bool
	TenderID         string
	ActorID          string
	RequestKey       string
	RequestHash      string
	ExpectedRevision int64
	PositionID       string
	Quantity         *float64
	Note             *string
}

// ApplyPositionGP writes GP values of a leaf position. An empty value may be
// filled by anyone with pricing:write; a filled one only by its last author
// (client_position_gp_audit). The journal trigger records old/new values with
// the actor and the MCP request key.
func (r *PricingRepo) ApplyPositionGP(ctx context.Context, in PositionGPCommit) (result *pricing.PositionGPResult, err error) {
	defer mapDirectPricingBusy(&err)
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := setAuditUser(ctx, tx, in.ActorID); err != nil {
		return nil, err
	}
	if !in.Preview {
		raw, err := claimDirectReceiptTx(ctx, tx, in.ActorID, in.RequestKey, in.RequestHash, in.TenderID)
		if err != nil {
			return nil, err
		}
		if raw != nil {
			var prior pricing.PositionGPResult
			if err := json.Unmarshal(raw, &prior); err != nil {
				return nil, err
			}
			prior.Replayed = true
			return &prior, nil
		}
	}
	if err := lockDirectRevisionTx(ctx, tx, in.TenderID, in.ExpectedRevision); err != nil {
		return nil, err
	}
	var positionTender string
	var previousQuantity *float64
	var previousNote *string
	var leaf bool
	err = tx.QueryRow(ctx, `SELECT tender_id::text,manual_volume,manual_note FROM public.client_positions
		WHERE id=$1 FOR UPDATE NOWAIT`, in.PositionID).Scan(&positionTender, &previousQuantity, &previousNote)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrDirectTargetInvalid
		}
		return nil, err
	}
	if positionTender != in.TenderID {
		return nil, ErrDirectTargetInvalid
	}
	if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (
		SELECT 1 FROM public.client_positions WHERE parent_position_id=$1
	)`, in.PositionID).Scan(&leaf); err != nil {
		return nil, err
	}
	if !leaf {
		return nil, ErrDirectTargetInvalid
	}
	changeCtx, positionLabel, err := changeContextTx(ctx, tx, in.PositionID)
	if err != nil {
		return nil, err
	}
	quantityChanged := in.Quantity != nil && !sameFloat(previousQuantity, in.Quantity)
	noteChanged := in.Note != nil && deref(previousNote) != *in.Note
	if !quantityChanged && !noteChanged {
		return nil, ErrPositionGPUnchanged
	}
	if quantityChanged && previousQuantity != nil {
		if err := requireMCPGPAuthorTx(ctx, tx, in.ActorID, in.PositionID, "volume", "количество ГП позиции "+positionLabel); err != nil {
			return nil, err
		}
	}
	if noteChanged && deref(previousNote) != "" {
		if err := requireMCPGPAuthorTx(ctx, tx, in.ActorID, in.PositionID, "note", "примечание ГП позиции "+positionLabel); err != nil {
			return nil, err
		}
	}
	if _, err := tx.Exec(ctx, `SELECT set_config('app.pricing_request_key',$1,true)`, in.RequestKey); err != nil {
		return nil, err
	}
	newRevision, err := MarkTenderFinancialInputsChangedTx(ctx, tx, in.TenderID, "mcp_position_gp")
	if err != nil {
		return nil, err
	}
	result = &pricing.PositionGPResult{
		RequestKey: in.RequestKey, TenderID: in.TenderID, PositionID: in.PositionID,
		PreviousQuantity: previousQuantity, Quantity: previousQuantity,
		PreviousNote: previousNote, Note: previousNote,
		FinancialInputRevision: newRevision, Context: changeCtx,
	}
	if quantityChanged {
		result.Quantity = in.Quantity
	}
	if noteChanged {
		result.Note = nil
		if *in.Note != "" {
			result.Note = in.Note
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE public.client_positions
		SET manual_volume=$2, manual_note=$3, updated_at=now() WHERE id=$1`,
		in.PositionID, result.Quantity, result.Note); err != nil {
		return nil, err
	}
	if in.Preview {
		return result, nil
	}
	if err := storeDirectReceiptTx(ctx, tx, in.ActorID, in.RequestKey, result); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return result, nil
}

// lockDirectRevisionTx serializes MCP writes on the tender and rejects a stale
// financial_input_revision.
func lockDirectRevisionTx(ctx context.Context, tx pgx.Tx, tenderID string, expected int64) error {
	var revision int64
	if err := tx.QueryRow(ctx, `SELECT financial_input_revision FROM public.tenders
		WHERE id=$1 FOR NO KEY UPDATE`, tenderID).Scan(&revision); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDirectTargetInvalid
		}
		return err
	}
	if revision != expected {
		return ErrDirectPricingStale
	}
	return nil
}

func lockLinkedMaterialsTx(ctx context.Context, tx pgx.Tx, workID string) ([]*BoqItemRow, error) {
	rows, err := tx.Query(ctx, "SELECT "+boqScanCols+
		" FROM public.boq_items WHERE parent_work_item_id=$1 ORDER BY id FOR UPDATE NOWAIT", workID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	children := []*BoqItemRow{}
	for rows.Next() {
		child, err := scanBoqItemRow(rows)
		if err != nil {
			return nil, err
		}
		children = append(children, child)
	}
	return children, rows.Err()
}

// mapDirectPricingBusy turns a NOWAIT lock conflict into a retryable error.
func mapDirectPricingBusy(err *error) {
	var pgErr *pgconn.PgError
	if errors.As(*err, &pgErr) && pgErr.Code == "55P03" {
		*err = ErrDirectPricingBusy
	}
}
