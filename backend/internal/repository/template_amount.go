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

// templateRowPlan is one fully-normalized, priced row produced by the PLANNING
// phase. Every row is planned (and every parent link validated) BEFORE the first
// INSERT, so a bad template never causes a partial write.
type templateRowPlan struct {
	IsWork         bool
	ItemType       string
	Currency       string
	UnitRate       float64
	Quantity       float64
	UnitCode       *string
	MatType        *string
	DPT            *string
	WorkNameID     *string
	MaterialNameID *string
	BaseQty        *float64
	ConsCoef       *float64
	ConvCoef       *float64
	DeliveryAmount float64
	TotalAmount    float64

	// ParentIdx is the index of the effective parent inside the insertion set,
	// or -1 for a standalone row. Already validated by resolveTemplateParent.
	ParentIdx int
}

// planTemplateRow normalizes one template row into the EXACT values that will be
// persisted and prices it through the authoritative calc kernel. Pure — no DB
// access — so the whole batch can be validated and priced before any mutation.
//
// quantity приходит предрассчитанным из шага 4c (merge 6e8ea39): у привязанного
// материала — от родительской РАБОТЫ (work.quantity × перевод × расход), объём
// позиции применяется только к непривязанным. base_quantity держим только у
// НЕпривязанного материала; у привязанного он NULL (инвариант, как в
// useMaterialEditForm/boqFieldPatch).
func planTemplateRow(
	t tmplItemRow,
	parentIdx int,
	quantity float64,
	rates calc.CurrencyRates,
) (templateRowPlan, error) {
	isWork := t.Kind == "work"

	p := templateRowPlan{IsWork: isWork, ParentIdx: parentIdx}

	if isWork {
		p.ItemType = strOrEmpty(t.WItemType)
		p.Currency = strOr(t.WCur, "RUB")
		p.UnitRate = orZero(t.WUnitRate)
		p.UnitCode = t.WUnit
		p.WorkNameID = t.WNameID
	} else {
		p.ItemType = strOrEmpty(t.MItemType)
		p.Currency = strOr(t.MCur, "RUB")
		p.UnitRate = orZero(t.MUnitRate)
		p.UnitCode = t.MUnit
		p.MaterialNameID = t.MNameID
		p.MatType = t.MMatType
		p.DPT = t.MDPT
		if parentIdx < 0 {
			one := 1.0
			p.BaseQty = &one
		}
		cc := orOne(t.MConsCoef)
		p.ConsCoef = &cc
		p.DeliveryAmount = orZero(t.MDelivAmt)
	}

	p.Quantity = quantity
	if !isWork && t.ConvCoeff != nil && *t.ConvCoeff != 0 {
		p.ConvCoef = t.ConvCoeff // перевод сохраняем независимо от ветки количества
	}

	// Money is derived ONLY by the authoritative kernel, from exactly the values
	// this row will persist. Delivery, consumption and FX rules all live in calc.
	total, err := templateItemTotalAmount(tmplAmountFields{
		ItemType:           p.ItemType,
		Currency:           p.Currency,
		Quantity:           p.Quantity,
		UnitRate:           p.UnitRate,
		DeliveryPriceType:  strOrEmpty(p.DPT),
		DeliveryAmount:     p.DeliveryAmount,
		ConsumptionCoeff:   p.ConsCoef,
		HasEffectiveParent: parentIdx >= 0,
	}, rates)
	if err != nil {
		return templateRowPlan{}, err
	}
	p.TotalAmount = total

	return p, nil
}
