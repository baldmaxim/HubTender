package repository

import "github.com/su10/hubtender/backend/internal/calc"

// templateParentMarker is a non-empty placeholder passed to calc as
// ParentWorkItemID.
//
// Why a marker and not the real UUID: template rows are INSERTed with a NULL
// parent_work_item_id and the links are restored afterwards (step 7), so the
// real parent UUID does not exist yet at calc time. calc only uses the
// nil / non-nil SEMANTICS of this field (a child material inherits its parent's
// quantity semantics ⇒ consumption is forced to 1). We therefore pass the marker
// IFF the parent link WILL actually be restored, so calc's view of the row is
// identical to the row's final persisted state — never "calc says parent, DB
// says NULL" (or the reverse).
const templateParentMarker = "template-parent-marker"

// tmplAmountFields are the FINAL, normalized values that will be written to
// public.boq_items for one template row. calc must see exactly these values —
// not the raw nullable template/library columns.
type tmplAmountFields struct {
	ItemType          string   // boq_item_type as persisted (раб / мат / …)
	Currency          string   // currency_type as persisted (RUB / USD / …)
	Quantity          float64  // quantity as persisted
	UnitRate          float64  // unit_rate as persisted
	DeliveryPriceType string   // delivery_price_type as persisted ("" for works)
	DeliveryAmount    float64  // delivery_amount as persisted
	ConsumptionCoeff  *float64 // consumption_coefficient as persisted (nil for works)

	// HasEffectiveParent is true iff this row's parent_work_item_id will really
	// be set after INSERT (parent exists in the same template and its link is
	// restored). See templateParentMarker.
	HasEffectiveParent bool
}

// amountInput projects the normalized row into calc's input shape.
func (f tmplAmountFields) amountInput() calc.BoqItemAmountInput {
	qty := f.Quantity
	rate := f.UnitRate
	deliv := f.DeliveryAmount

	in := calc.BoqItemAmountInput{
		BoqItemType:            f.ItemType,
		Quantity:               &qty,
		UnitRate:               &rate,
		CurrencyType:           f.Currency,
		DeliveryPriceType:      f.DeliveryPriceType,
		DeliveryAmount:         &deliv,
		ConsumptionCoefficient: f.ConsumptionCoeff,
	}
	if f.HasEffectiveParent {
		marker := templateParentMarker
		in.ParentWorkItemID = &marker
	}
	return in
}

// templateItemTotalAmount is the ONLY place the template-insert path derives
// money. It delegates to the authoritative kernel — identical rules to
// CreateBoqItem, including the blocking MissingFXRateError when a foreign
// currency has no positive rate (no FX fallback to 1.0).
func templateItemTotalAmount(f tmplAmountFields, rates calc.CurrencyRates) (float64, error) {
	return calc.CalculateBoqItemTotalAmount(f.amountInput(), rates)
}
