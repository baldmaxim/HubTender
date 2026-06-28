package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// CopyResult is the outcome of CopyPositionItems.
type CopyResult struct {
	WorksCount     int `json:"works_count"`
	MaterialsCount int `json:"materials_count"`
	TotalCopied    int `json:"total_copied"`
}

// ErrCopyTenderMismatch is returned when source/target positions belong to
// different tenders.
var ErrCopyTenderMismatch = errors.New("positions belong to different tenders")

// CopyPositionItems copies every boq_item from sourcePositionID into
// targetPositionID in one transaction, preserving parent_work_item_id
// relationships via index mapping. It also refreshes total_material /
// total_works on the target position and writes one INSERT audit row per
// new item. Returns a per-row count summary.
func (r *BoqRepo) CopyPositionItems(
	ctx context.Context, sourcePositionID, targetPositionID, changedBy string,
) (*CopyResult, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: %w", err)
	}

	// Validate positions + same-tender constraint inside the tx.
	var srcTender, tgtTender string
	if err := tx.QueryRow(ctx,
		`SELECT tender_id::text FROM public.client_positions WHERE id = $1`, sourcePositionID,
	).Scan(&srcTender); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("boqRepo.CopyPositionItems: source not found")
		}
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: source lookup: %w", err)
	}
	if err := tx.QueryRow(ctx,
		`SELECT tender_id::text FROM public.client_positions WHERE id = $1`, targetPositionID,
	).Scan(&tgtTender); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("boqRepo.CopyPositionItems: target not found")
		}
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: target lookup: %w", err)
	}
	if srcTender != tgtTender {
		return nil, ErrCopyTenderMismatch
	}

	// Read source items in stable order. We need IDs to build the
	// parent-mapping table.
	type srcRow struct {
		ID                          string
		SortNumber                  *int
		BoqItemType                 string
		MaterialType                *string
		MaterialNameID              *string
		WorkNameID                  *string
		UnitCode                    *string
		Quantity                    *float64
		BaseQuantity                *float64
		ConsumptionCoefficient      *float64
		ConversionCoefficient       *float64
		ParentWorkItemID            *string
		DeliveryPriceType           *string
		DeliveryAmount              *float64
		CurrencyType                *string
		UnitRate                    *float64
		TotalAmount                 *float64
		DetailCostCategoryID        *string
		QuoteLink                   *string
		Description                 *string
		CommercialMarkup            *float64
		TotalCommercialMaterialCost *float64
		TotalCommercialWorkCost     *float64
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text, sort_number, boq_item_type::text, material_type::text,
		       material_name_id::text, work_name_id::text, unit_code,
		       quantity, base_quantity, consumption_coefficient, conversion_coefficient,
		       parent_work_item_id::text, delivery_price_type::text, delivery_amount,
		       currency_type::text, unit_rate, total_amount,
		       detail_cost_category_id::text, quote_link, description,
		       commercial_markup, total_commercial_material_cost, total_commercial_work_cost
		FROM public.boq_items
		WHERE client_position_id = $1
		ORDER BY sort_number ASC, id ASC
	`, sourcePositionID)
	if err != nil {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: source items: %w", err)
	}
	var src []srcRow
	func() {
		defer rows.Close()
		for rows.Next() {
			var s srcRow
			if err = rows.Scan(
				&s.ID, &s.SortNumber, &s.BoqItemType, &s.MaterialType,
				&s.MaterialNameID, &s.WorkNameID, &s.UnitCode,
				&s.Quantity, &s.BaseQuantity, &s.ConsumptionCoefficient, &s.ConversionCoefficient,
				&s.ParentWorkItemID, &s.DeliveryPriceType, &s.DeliveryAmount,
				&s.CurrencyType, &s.UnitRate, &s.TotalAmount,
				&s.DetailCostCategoryID, &s.QuoteLink, &s.Description,
				&s.CommercialMarkup, &s.TotalCommercialMaterialCost, &s.TotalCommercialWorkCost,
			); err != nil {
				return
			}
			src = append(src, s)
		}
		err = rows.Err()
	}()
	if err != nil {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: source scan: %w", err)
	}
	if len(src) == 0 {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: source has no items")
	}

	// Insert clones (parent_work_item_id = NULL), keep source-order new IDs.
	newIDs := make([]string, len(src))
	insertQ := `
		INSERT INTO public.boq_items (
		    tender_id, client_position_id, sort_number,
		    boq_item_type, material_type, material_name_id, work_name_id,
		    unit_code, quantity, base_quantity,
		    consumption_coefficient, conversion_coefficient,
		    parent_work_item_id, delivery_price_type, delivery_amount,
		    currency_type, unit_rate, total_amount,
		    detail_cost_category_id, quote_link, description,
		    commercial_markup, total_commercial_material_cost, total_commercial_work_cost
		) VALUES (
		    $1, $2, $3,
		    $4::boq_item_type, $5::material_type, $6, $7,
		    $8, $9, $10,
		    $11, $12,
		    NULL, $13::delivery_price_type, $14,
		    $15::currency_type, $16, $17,
		    $18, $19, $20,
		    $21, $22, $23
		)
		RETURNING id::text
	`
	for i, s := range src {
		sortNum := i + 1
		if err := tx.QueryRow(ctx, insertQ,
			tgtTender, targetPositionID, sortNum,
			s.BoqItemType, s.MaterialType, s.MaterialNameID, s.WorkNameID,
			s.UnitCode, s.Quantity, s.BaseQuantity,
			s.ConsumptionCoefficient, s.ConversionCoefficient,
			s.DeliveryPriceType, s.DeliveryAmount,
			s.CurrencyType, s.UnitRate, s.TotalAmount,
			s.DetailCostCategoryID, s.QuoteLink, s.Description,
			s.CommercialMarkup, s.TotalCommercialMaterialCost, s.TotalCommercialWorkCost,
		).Scan(&newIDs[i]); err != nil {
			return nil, fmt.Errorf("boqRepo.CopyPositionItems: insert %d: %w", i, err)
		}
	}

	// Rebuild parent_work_item_id via sourceID → newID mapping.
	idxByID := make(map[string]int, len(src))
	for i, s := range src {
		idxByID[s.ID] = i
	}
	for i, s := range src {
		if s.ParentWorkItemID == nil {
			continue
		}
		parentIdx, ok := idxByID[*s.ParentWorkItemID]
		if !ok {
			continue
		}
		if _, err := tx.Exec(ctx,
			`UPDATE public.boq_items SET parent_work_item_id = $1 WHERE id = $2`,
			newIDs[parentIdx], newIDs[i],
		); err != nil {
			return nil, fmt.Errorf("boqRepo.CopyPositionItems: link parent %d: %w", i, err)
		}
	}

	// Recompute target position totals.
	if _, err := tx.Exec(ctx, `
		UPDATE public.client_positions cp
		   SET total_material = COALESCE(agg.mat, 0),
		       total_works    = COALESCE(agg.wrk, 0),
		       updated_at     = NOW()
		  FROM (
		    SELECT
		      SUM(CASE WHEN bi.boq_item_type::text IN ('мат','суб-мат','мат-комп.')
		               THEN COALESCE(bi.total_amount, 0) ELSE 0 END) AS mat,
		      SUM(CASE WHEN bi.boq_item_type::text IN ('раб','суб-раб','раб-комп.')
		               THEN COALESCE(bi.total_amount, 0) ELSE 0 END) AS wrk
		    FROM public.boq_items bi
		    WHERE bi.client_position_id = $1
		  ) agg
		 WHERE cp.id = $1
	`, targetPositionID); err != nil {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: recompute totals: %w", err)
	}

	// Audit: one INSERT row per new boq_item. Best-effort — capture a minimal
	// payload identifying the source for traceability.
	for i, newID := range newIDs {
		payload := []byte(fmt.Sprintf(
			`{"id":"%s","client_position_id":"%s","tender_id":"%s","source_item_id":"%s","boq_item_type":"%s"}`,
			newID, targetPositionID, tgtTender, src[i].ID, src[i].BoqItemType,
		))
		if err := insertAudit(ctx, tx, newID, "INSERT", changedBy, nil, nil, payload); err != nil {
			return nil, fmt.Errorf("boqRepo.CopyPositionItems: audit: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("boqRepo.CopyPositionItems: commit: %w", err)
	}

	res := &CopyResult{TotalCopied: len(newIDs)}
	for _, s := range src {
		if s.WorkNameID != nil && *s.WorkNameID != "" {
			res.WorksCount++
		}
		if s.MaterialNameID != nil && *s.MaterialNameID != "" {
			res.MaterialsCount++
		}
	}
	return res, nil
}
