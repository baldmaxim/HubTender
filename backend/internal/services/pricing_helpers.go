package services

import (
	"errors"
	"strings"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
)

func proposedFromExisting(b *repository.BoqItemRow) pricing.ProposedItem {
	return pricing.ProposedItem{BoqItemType: b.BoqItemType, MaterialType: b.MaterialType, Description: b.Description, UnitCode: b.UnitCode, Quantity: b.Quantity, BaseQuantity: b.BaseQuantity, ConversionCoefficient: b.ConversionCoefficient, UnitRate: b.UnitRate, CurrencyType: b.CurrencyType, DeliveryPriceType: b.DeliveryPriceType, DeliveryAmount: b.DeliveryAmount, ConsumptionCoefficient: b.ConsumptionCoefficient, DetailCostCategoryID: b.DetailCostCategoryID, MaterialNameID: b.MaterialNameID, WorkNameID: b.WorkNameID, QuoteLink: b.QuoteLink, QuotePriceDate: b.QuotePriceDate, QuoteValidUntil: b.QuoteValidUntil, SortNumber: &b.SortNumber}
}

func validateProposed(p pricing.ProposedItem) error {
	if !calc.IsWorkBoqType(p.BoqItemType) && !calc.IsMaterialBoqType(p.BoqItemType) {
		return errors.New("недопустимый boq_item_type")
	}
	if p.Quantity == nil {
		return errors.New("quantity обязателен")
	}
	if p.UnitRate == nil {
		return errors.New("unit_rate обязателен")
	}
	if p.UnitCode == nil || strings.TrimSpace(*p.UnitCode) == "" {
		return errors.New("unit_code обязателен")
	}
	if calc.IsWorkBoqType(p.BoqItemType) && p.WorkNameID == nil {
		return errors.New("work_name_id обязателен")
	}
	if calc.IsMaterialBoqType(p.BoqItemType) && p.MaterialNameID == nil {
		return errors.New("material_name_id обязателен")
	}
	return nil
}

func effectiveVolume(p *repository.TargetPosition) *float64 {
	if p.ManualVolume != nil {
		return p.ManualVolume
	}
	return p.Volume
}
func value(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func stringPtr(v string) *string { return &v }
func defaultText(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func normalizePage(limit, offset, def int) (int, int) {
	if limit <= 0 {
		limit = def
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

func buildPage(limit, offset, total, count int) pricing.Page {
	p := pricing.Page{Limit: limit, Offset: offset, TotalCount: total, HasMore: offset+count < total}
	if p.HasMore {
		n := offset + count
		p.NextOffset = &n
	}
	return p
}
