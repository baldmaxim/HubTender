package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FIRepo handles the heavy reads consumed by the Financial Indicators page:
// tender row by id and the flat list of boq_items joined with client_positions
// (so the page can filter by tender_id directly).
type FIRepo struct {
	pool *pgxpool.Pool
}

// NewFIRepo creates an FIRepo.
func NewFIRepo(pool *pgxpool.Pool) *FIRepo {
	return &FIRepo{pool: pool}
}

// TenderRow mirrors the public.tenders columns surfaced by the FI page.
type FITenderRow struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	TenderNumber       *string  `json:"tender_number,omitempty"`
	ClientName         *string  `json:"client_name,omitempty"`
	Version            *int     `json:"version,omitempty"`
	IsArchived         *bool    `json:"is_archived,omitempty"`
	USDRate            *float64 `json:"usd_rate,omitempty"`
	EURRate            *float64 `json:"eur_rate,omitempty"`
	CNYRate            *float64 `json:"cny_rate,omitempty"`
	MarkupTacticID     *string  `json:"markup_tactic_id,omitempty"`
	CachedGrandTotal   *float64 `json:"cached_grand_total,omitempty"`
	HousingClass       *string  `json:"housing_class,omitempty"`
	ConstructionScope  *string  `json:"construction_scope,omitempty"`
}

func (r *FIRepo) GetTenderByID(ctx context.Context, id string) (*FITenderRow, error) {
	var t FITenderRow
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, COALESCE(title, ''),
		       tender_number, client_name, version, is_archived,
		       usd_rate, eur_rate, cny_rate,
		       markup_tactic_id::text, cached_grand_total,
		       housing_class::text, construction_scope::text
		FROM public.tenders
		WHERE id = $1
	`, id).Scan(&t.ID, &t.Title, &t.TenderNumber, &t.ClientName, &t.Version, &t.IsArchived,
		&t.USDRate, &t.EURRate, &t.CNYRate, &t.MarkupTacticID, &t.CachedGrandTotal,
		&t.HousingClass, &t.ConstructionScope)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("fiRepo.GetTenderByID: %w", err)
	}
	return &t, nil
}

// FIBoqItemRow is the projection FI needs for cost-aggregation.
type FIBoqItemRow struct {
	ID                          string   `json:"id"`
	TenderID                    string   `json:"tender_id"`
	ClientPositionID            string   `json:"client_position_id"`
	BoqItemType                 string   `json:"boq_item_type"`
	MaterialType                *string  `json:"material_type,omitempty"`
	MaterialNameID              *string  `json:"material_name_id,omitempty"`
	WorkNameID                  *string  `json:"work_name_id,omitempty"`
	ParentWorkItemID            *string  `json:"parent_work_item_id,omitempty"`
	DetailCostCategoryID        *string  `json:"detail_cost_category_id,omitempty"`
	Quantity                    *float64 `json:"quantity,omitempty"`
	UnitRate                    *float64 `json:"unit_rate,omitempty"`
	CurrencyType                *string  `json:"currency_type,omitempty"`
	DeliveryPriceType           *string  `json:"delivery_price_type,omitempty"`
	DeliveryAmount              *float64 `json:"delivery_amount,omitempty"`
	ConsumptionCoefficient      *float64 `json:"consumption_coefficient,omitempty"`
	TotalAmount                 *float64 `json:"total_amount,omitempty"`
	TotalCommercialMaterialCost *float64 `json:"total_commercial_material_cost,omitempty"`
	TotalCommercialWorkCost     *float64 `json:"total_commercial_work_cost,omitempty"`
	ClientPosition              *struct {
		TenderID string `json:"tender_id"`
	} `json:"client_position,omitempty"`
}

// ListAllBoqItemsForTender streams every boq_items row whose client_position
// belongs to the tender. Returns a flat slice.
func (r *FIRepo) ListAllBoqItemsForTender(ctx context.Context, tenderID string) ([]FIBoqItemRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT bi.id::text, cp.tender_id::text, bi.client_position_id::text,
		       bi.boq_item_type::text,
		       bi.material_type::text,
		       bi.material_name_id::text,
		       bi.work_name_id::text,
		       bi.parent_work_item_id::text,
		       bi.detail_cost_category_id::text,
		       bi.quantity, bi.unit_rate, bi.currency_type::text,
		       bi.delivery_price_type::text, bi.delivery_amount, bi.consumption_coefficient,
		       bi.total_amount,
		       bi.total_commercial_material_cost,
		       bi.total_commercial_work_cost
		FROM public.boq_items bi
		INNER JOIN public.client_positions cp ON cp.id = bi.client_position_id
		WHERE cp.tender_id = $1
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("fiRepo.ListAllBoqItemsForTender: %w", err)
	}
	defer rows.Close()
	out := make([]FIBoqItemRow, 0)
	for rows.Next() {
		var rec FIBoqItemRow
		if err := rows.Scan(&rec.ID, &rec.TenderID, &rec.ClientPositionID,
			&rec.BoqItemType, &rec.MaterialType,
			&rec.MaterialNameID, &rec.WorkNameID, &rec.ParentWorkItemID, &rec.DetailCostCategoryID,
			&rec.Quantity, &rec.UnitRate, &rec.CurrencyType,
			&rec.DeliveryPriceType, &rec.DeliveryAmount, &rec.ConsumptionCoefficient,
			&rec.TotalAmount, &rec.TotalCommercialMaterialCost, &rec.TotalCommercialWorkCost); err != nil {
			return nil, fmt.Errorf("fiRepo.ListAllBoqItemsForTender scan: %w", err)
		}
		// Embed client_position object for compatibility with the page's existing shape.
		rec.ClientPosition = &struct {
			TenderID string `json:"tender_id"`
		}{TenderID: rec.TenderID}
		out = append(out, rec)
	}
	return out, rows.Err()
}
