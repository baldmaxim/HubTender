package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ---------------------------------------------------------------------------
// Write input types
// ---------------------------------------------------------------------------

// CreateBoqItemInput holds validated fields for inserting a boq_item.
type CreateBoqItemInput struct {
	ClientPositionID     string
	TenderID             string
	BoqItemType          string
	MaterialType         *string
	Description          *string
	UnitCode             *string
	Quantity             *float64
	UnitRate             *float64
	CurrencyType         *string
	DeliveryPriceType    *string
	DeliveryAmount       *float64
	DetailCostCategoryID *string
	MaterialNameID       *string
	WorkNameID           *string
	ParentWorkItemID     *string
	SortNumber           *int
	CreatedBy            string // auth.users UUID for audit
}

// UpdateBoqItemInput holds validated patch fields for a boq_item.
type UpdateBoqItemInput struct {
	BoqItemType          *string
	MaterialType         *string
	Description          *string
	UnitCode             *string
	Quantity             *float64
	UnitRate             *float64
	CurrencyType         *string
	DeliveryPriceType    *string
	DeliveryAmount       *float64
	DetailCostCategoryID *string
	MaterialNameID       *string
	WorkNameID           *string
	ParentWorkItemID     *string
	SortNumber           *int
	ChangedBy            string // auth.users UUID for audit
}

// ---------------------------------------------------------------------------
// boq SELECT column list (must match BoqItemRow Scan order)
// ---------------------------------------------------------------------------

const boqScanCols = `
	id::text, client_position_id::text, tender_id::text,
	boq_item_type::text, material_type::text, description,
	unit_code, quantity, unit_rate,
	currency_type::text, delivery_price_type::text, delivery_amount,
	total_amount, sort_number,
	detail_cost_category_id::text, parent_work_item_id::text,
	material_name_id::text, work_name_id::text,
	COALESCE(created_at,NOW()), COALESCE(updated_at,NOW())
`

// GetBoqItemByID fetches a single BoqItemRow by primary key.
func (r *BoqRepo) GetBoqItemByID(ctx context.Context, id string) (*BoqItemRow, error) {
	q := "SELECT " + boqScanCols + " FROM public.boq_items WHERE id = $1"
	row := r.pool.QueryRow(ctx, q, id)
	item, err := scanBoqItemRow(row)
	if err != nil {
		return nil, fmt.Errorf("boqRepo.GetBoqItemByID: scan: %w", err)
	}
	return item, nil
}

func scanBoqItemRow(row interface{ Scan(...any) error }) (*BoqItemRow, error) {
	var b BoqItemRow
	if err := row.Scan(
		&b.ID, &b.ClientPositionID, &b.TenderID,
		&b.BoqItemType, &b.MaterialType, &b.Description,
		&b.UnitCode, &b.Quantity, &b.UnitRate,
		&b.CurrencyType, &b.DeliveryPriceType, &b.DeliveryAmount,
		&b.TotalAmount, &b.SortNumber,
		&b.DetailCostCategoryID, &b.ParentWorkItemID,
		&b.MaterialNameID, &b.WorkNameID,
		&b.CreatedAt, &b.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &b, nil
}

// boqRowJSON marshals a BoqItemRow to a JSON-compatible map.
func boqRowJSON(b *BoqItemRow) ([]byte, error) {
	return json.Marshal(b)
}

// changedFields computes which top-level fields differ between old and new row
// by comparing their JSON representations.
func changedFields(old, new *BoqItemRow) []string {
	type pair struct {
		name string
		o, n any
	}
	pairs := []pair{
		{"boq_item_type", old.BoqItemType, new.BoqItemType},
		{"material_type", old.MaterialType, new.MaterialType},
		{"description", old.Description, new.Description},
		{"unit_code", old.UnitCode, new.UnitCode},
		{"quantity", old.Quantity, new.Quantity},
		{"unit_rate", old.UnitRate, new.UnitRate},
		{"currency_type", old.CurrencyType, new.CurrencyType},
		{"delivery_price_type", old.DeliveryPriceType, new.DeliveryPriceType},
		{"delivery_amount", old.DeliveryAmount, new.DeliveryAmount},
		{"total_amount", old.TotalAmount, new.TotalAmount},
		{"sort_number", old.SortNumber, new.SortNumber},
		{"detail_cost_category_id", old.DetailCostCategoryID, new.DetailCostCategoryID},
		{"parent_work_item_id", old.ParentWorkItemID, new.ParentWorkItemID},
		{"material_name_id", old.MaterialNameID, new.MaterialNameID},
		{"work_name_id", old.WorkNameID, new.WorkNameID},
	}
	var out []string
	for _, p := range pairs {
		oj, _ := json.Marshal(p.o)
		nj, _ := json.Marshal(p.n)
		if string(oj) != string(nj) {
			out = append(out, p.name)
		}
	}
	return out
}

// insertAudit writes a single row to public.boq_items_audit inside an
// already-open transaction. Nil []byte values are sent as SQL NULL.
func insertAudit(
	ctx context.Context,
	tx pgx.Tx,
	boqItemID, operation, changedBy string,
	changedFlds []string,
	oldData, newData []byte,
) error {
	const q = `
		INSERT INTO public.boq_items_audit
		    (boq_item_id, operation_type, changed_by, changed_fields, old_data, new_data, changed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7)
	`
	var changedByParam any
	if changedBy != "" {
		changedByParam = changedBy
	}
	// pgx v5 sends nil []byte as SQL NULL for jsonb columns.
	var oldParam, newParam any
	if len(oldData) > 0 {
		oldParam = oldData
	}
	if len(newData) > 0 {
		newParam = newData
	}
	_, err := tx.Exec(ctx, q,
		boqItemID, operation, changedByParam, changedFlds, oldParam, newParam, time.Now().UTC(),
	)
	return err
}

// CreateBoqItem inserts a new boq_item and writes an INSERT audit row, all in
// one transaction.
func (r *BoqRepo) CreateBoqItem(ctx context.Context, in CreateBoqItemInput) (*BoqItemRow, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("boqRepo.CreateBoqItem: begin tx: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	sortNum := 0
	if in.SortNumber != nil {
		sortNum = *in.SortNumber
	}

	q := `
		INSERT INTO public.boq_items
		    (client_position_id, tender_id, boq_item_type, material_type, description,
		     unit_code, quantity, unit_rate, currency_type, delivery_price_type,
		     delivery_amount, detail_cost_category_id, material_name_id, work_name_id,
		     parent_work_item_id, sort_number, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
		RETURNING ` + boqScanCols
	row := tx.QueryRow(ctx, q,
		in.ClientPositionID, in.TenderID, in.BoqItemType,
		in.MaterialType, in.Description,
		in.UnitCode, in.Quantity, in.UnitRate,
		in.CurrencyType, in.DeliveryPriceType,
		in.DeliveryAmount, in.DetailCostCategoryID,
		in.MaterialNameID, in.WorkNameID,
		in.ParentWorkItemID, sortNum, in.CreatedBy,
	)
	item, err := scanBoqItemRow(row)
	if err != nil {
		return nil, fmt.Errorf("boqRepo.CreateBoqItem: scan: %w", err)
	}

	newJSON, _ := boqRowJSON(item)
	if err := insertAudit(ctx, tx, item.ID, "INSERT", in.CreatedBy, nil, nil, newJSON); err != nil {
		return nil, fmt.Errorf("boqRepo.CreateBoqItem: audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("boqRepo.CreateBoqItem: commit: %w", err)
	}
	return item, nil
}

