package repository

import (
	"context"
	"fmt"
	"time"
)

// ─── single position + tender rates ─────────────────────────────────────────

// PositionTenderRates holds the joined tender currency multipliers.
type PositionTenderRates struct {
	USDRate *float64 `json:"usd_rate"`
	EURRate *float64 `json:"eur_rate"`
	CNYRate *float64 `json:"cny_rate"`
}

// PositionWithTenderRow mirrors `client_positions.* + tenders(rates)`
// joined by client_positions.tender_id. Currency multipliers are required
// by the PositionItems page right after the position lookup.
type PositionWithTenderRow struct {
	ID                              string     `json:"id"`
	TenderID                        string     `json:"tender_id"`
	PositionNumber                  float64    `json:"position_number"`
	UnitCode                        *string    `json:"unit_code"`
	Volume                          *float64   `json:"volume"`
	ClientNote                      *string    `json:"client_note"`
	ItemNo                          *string    `json:"item_no"`
	WorkName                        string     `json:"work_name"`
	ManualVolume                    *float64   `json:"manual_volume"`
	ManualNote                      *string    `json:"manual_note"`
	HierarchyLevel                  *int       `json:"hierarchy_level"`
	IsAdditional                    *bool      `json:"is_additional"`
	ParentPositionID                *string    `json:"parent_position_id"`
	TotalMaterial                   *float64   `json:"total_material"`
	TotalWorks                      *float64   `json:"total_works"`
	MaterialCostPerUnit             *float64   `json:"material_cost_per_unit"`
	WorkCostPerUnit                 *float64   `json:"work_cost_per_unit"`
	TotalCommercialMaterial         *float64   `json:"total_commercial_material"`
	TotalCommercialWork             *float64   `json:"total_commercial_work"`
	TotalCommercialMaterialPerUnit  *float64   `json:"total_commercial_material_per_unit"`
	TotalCommercialWorkPerUnit      *float64   `json:"total_commercial_work_per_unit"`
	CreatedAt                       time.Time  `json:"created_at"`
	UpdatedAt                       time.Time  `json:"updated_at"`
	Tenders                         *PositionTenderRates `json:"tenders"`
}

// GetPositionWithTender returns one client_positions row + tenders rate embed.
func (r *PositionRepo) GetPositionWithTender(ctx context.Context, id string) (*PositionWithTenderRow, error) {
	const q = `
		SELECT cp.id::text, cp.tender_id::text, cp.position_number,
		       cp.unit_code, cp.volume, cp.client_note, cp.item_no, cp.work_name,
		       cp.manual_volume, cp.manual_note, cp.hierarchy_level, cp.is_additional,
		       cp.parent_position_id::text,
		       cp.total_material, cp.total_works,
		       cp.material_cost_per_unit, cp.work_cost_per_unit,
		       cp.total_commercial_material, cp.total_commercial_work,
		       cp.total_commercial_material_per_unit, cp.total_commercial_work_per_unit,
		       cp.created_at, cp.updated_at,
		       t.usd_rate, t.eur_rate, t.cny_rate
		FROM public.client_positions cp
		LEFT JOIN public.tenders t ON t.id = cp.tender_id
		WHERE cp.id = $1
	`
	var p PositionWithTenderRow
	var usd, eur, cny *float64
	if err := r.pool.QueryRow(ctx, q, id).Scan(
		&p.ID, &p.TenderID, &p.PositionNumber,
		&p.UnitCode, &p.Volume, &p.ClientNote, &p.ItemNo, &p.WorkName,
		&p.ManualVolume, &p.ManualNote, &p.HierarchyLevel, &p.IsAdditional,
		&p.ParentPositionID,
		&p.TotalMaterial, &p.TotalWorks,
		&p.MaterialCostPerUnit, &p.WorkCostPerUnit,
		&p.TotalCommercialMaterial, &p.TotalCommercialWork,
		&p.TotalCommercialMaterialPerUnit, &p.TotalCommercialWorkPerUnit,
		&p.CreatedAt, &p.UpdatedAt,
		&usd, &eur, &cny,
	); err != nil {
		return nil, fmt.Errorf("positionRepo.GetPositionWithTender: %w", err)
	}
	if usd != nil || eur != nil || cny != nil {
		p.Tenders = &PositionTenderRates{USDRate: usd, EURRate: eur, CNYRate: cny}
	}
	return &p, nil
}

// ─── boq_items with nested embeds (PositionItems page) ──────────────────────

// NameUnitEmbed mirrors {name, unit}.
type NameUnitEmbed struct {
	Name string  `json:"name"`
	Unit *string `json:"unit"`
}

// NameOnlyEmbed mirrors {name}.
type NameOnlyEmbed struct {
	Name string `json:"name"`
}

// ParentWorkEmbed mirrors parent_work:parent_work_item_id(work_names(name)).
type ParentWorkEmbed struct {
	WorkNames *NameOnlyEmbed `json:"work_names"`
}

// BoqItemDetailCat mirrors detail_cost_categories(name, location, cost_categories(name)).
type BoqItemDetailCat struct {
	Name           string         `json:"name"`
	Location       *string        `json:"location"`
	CostCategories *NameOnlyEmbed `json:"cost_categories"`
}

// BoqItemFullRow mirrors boq_items.* + nested name/category embeds used by
// the PositionItems page (`useBoqItems.fetchItems`).
type BoqItemFullRow struct {
	ID                          string            `json:"id"`
	TenderID                    string            `json:"tender_id"`
	ClientPositionID            string            `json:"client_position_id"`
	SortNumber                  *int              `json:"sort_number"`
	BoqItemType                 string            `json:"boq_item_type"`
	MaterialType                *string           `json:"material_type"`
	MaterialNameID              *string           `json:"material_name_id"`
	WorkNameID                  *string           `json:"work_name_id"`
	UnitCode                    *string           `json:"unit_code"`
	Quantity                    *float64          `json:"quantity"`
	BaseQuantity                *float64          `json:"base_quantity"`
	ConsumptionCoefficient      *float64          `json:"consumption_coefficient"`
	ConversionCoefficient       *float64          `json:"conversion_coefficient"`
	DeliveryPriceType           *string           `json:"delivery_price_type"`
	DeliveryAmount              *float64          `json:"delivery_amount"`
	CurrencyType                *string           `json:"currency_type"`
	TotalAmount                 *float64          `json:"total_amount"`
	DetailCostCategoryID        *string           `json:"detail_cost_category_id"`
	QuoteLink                   *string           `json:"quote_link"`
	CommercialMarkup            *float64          `json:"commercial_markup"`
	TotalCommercialMaterialCost *float64          `json:"total_commercial_material_cost"`
	TotalCommercialWorkCost     *float64          `json:"total_commercial_work_cost"`
	CreatedAt                   time.Time         `json:"created_at"`
	UpdatedAt                   time.Time         `json:"updated_at"`
	ParentWorkItemID            *string           `json:"parent_work_item_id"`
	Description                 *string           `json:"description"`
	UnitRate                    *float64          `json:"unit_rate"`
	ImportSessionID             *string           `json:"import_session_id"`
	WorkNames                   *NameUnitEmbed    `json:"work_names"`
	MaterialNames               *NameUnitEmbed    `json:"material_names"`
	ParentWork                  *ParentWorkEmbed  `json:"parent_work"`
	DetailCostCategories        *BoqItemDetailCat `json:"detail_cost_categories"`
}

const boqItemsFullSelect = `
	SELECT bi.id::text, bi.tender_id::text, bi.client_position_id::text,
	       bi.sort_number, bi.boq_item_type::text, bi.material_type::text,
	       bi.material_name_id::text, bi.work_name_id::text,
	       bi.unit_code, bi.quantity, bi.base_quantity,
	       bi.consumption_coefficient, bi.conversion_coefficient,
	       bi.delivery_price_type::text, bi.delivery_amount,
	       bi.currency_type::text, bi.total_amount,
	       bi.detail_cost_category_id::text, bi.quote_link,
	       bi.commercial_markup, bi.total_commercial_material_cost,
	       bi.total_commercial_work_cost, bi.created_at, bi.updated_at,
	       bi.parent_work_item_id::text, bi.description, bi.unit_rate,
	       bi.import_session_id::text,
	       wn.name, wn.unit, mn.name, mn.unit,
	       (pw.id IS NOT NULL), pwn.name,
	       (dcc.id IS NOT NULL), dcc.name, dcc.location, cc.name
	FROM public.boq_items bi
	LEFT JOIN public.work_names wn ON wn.id = bi.work_name_id
	LEFT JOIN public.material_names mn ON mn.id = bi.material_name_id
	LEFT JOIN public.boq_items pw ON pw.id = bi.parent_work_item_id
	LEFT JOIN public.work_names pwn ON pwn.id = pw.work_name_id
	LEFT JOIN public.detail_cost_categories dcc ON dcc.id = bi.detail_cost_category_id
	LEFT JOIN public.cost_categories cc ON cc.id = dcc.cost_category_id
`

func scanBoqItemsFullRows(rows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}) ([]BoqItemFullRow, error) {
	defer rows.Close()
	out := make([]BoqItemFullRow, 0)
	for rows.Next() {
		var b BoqItemFullRow
		var wnName, wnUnit, mnName, mnUnit *string
		var hasPW bool
		var pwnName *string
		var hasDCC bool
		var dccName, dccLoc, ccName *string
		if err := rows.Scan(
			&b.ID, &b.TenderID, &b.ClientPositionID,
			&b.SortNumber, &b.BoqItemType, &b.MaterialType,
			&b.MaterialNameID, &b.WorkNameID,
			&b.UnitCode, &b.Quantity, &b.BaseQuantity,
			&b.ConsumptionCoefficient, &b.ConversionCoefficient,
			&b.DeliveryPriceType, &b.DeliveryAmount,
			&b.CurrencyType, &b.TotalAmount,
			&b.DetailCostCategoryID, &b.QuoteLink,
			&b.CommercialMarkup, &b.TotalCommercialMaterialCost,
			&b.TotalCommercialWorkCost, &b.CreatedAt, &b.UpdatedAt,
			&b.ParentWorkItemID, &b.Description, &b.UnitRate,
			&b.ImportSessionID,
			&wnName, &wnUnit, &mnName, &mnUnit,
			&hasPW, &pwnName,
			&hasDCC, &dccName, &dccLoc, &ccName,
		); err != nil {
			return nil, fmt.Errorf("scanBoqItemsFullRows scan: %w", err)
		}
		if wnName != nil {
			b.WorkNames = &NameUnitEmbed{Name: *wnName, Unit: wnUnit}
		}
		if mnName != nil {
			b.MaterialNames = &NameUnitEmbed{Name: *mnName, Unit: mnUnit}
		}
		if hasPW {
			pw := &ParentWorkEmbed{}
			if pwnName != nil {
				pw.WorkNames = &NameOnlyEmbed{Name: *pwnName}
			}
			b.ParentWork = pw
		}
		if hasDCC {
			dc := &BoqItemDetailCat{Name: derefStr(dccName), Location: dccLoc}
			if ccName != nil {
				dc.CostCategories = &NameOnlyEmbed{Name: *ccName}
			}
			b.DetailCostCategories = dc
		}
		out = append(out, b)
	}
	return out, rows.Err()
}

// ListBoqItemsFullByPosition returns boq_items + nested embeds for a position.
func (r *PositionRepo) ListBoqItemsFullByPosition(ctx context.Context, positionID string) ([]BoqItemFullRow, error) {
	rows, err := r.pool.Query(ctx, boqItemsFullSelect+`
		WHERE bi.client_position_id = $1
		ORDER BY bi.sort_number
	`, positionID)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.ListBoqItemsFullByPosition: %w", err)
	}
	return scanBoqItemsFullRows(rows)
}

// ListBoqItemsFullByTender returns boq_items + nested embeds for an entire
// tender. Used by the positions Excel export which loads everything once.
func (r *PositionRepo) ListBoqItemsFullByTender(ctx context.Context, tenderID string) ([]BoqItemFullRow, error) {
	rows, err := r.pool.Query(ctx, boqItemsFullSelect+`
		WHERE bi.tender_id = $1
		ORDER BY bi.sort_number, bi.id
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.ListBoqItemsFullByTender: %w", err)
	}
	return scanBoqItemsFullRows(rows)
}
