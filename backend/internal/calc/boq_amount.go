// Package calc holds pure Go ports of frontend calculation utilities.
// Every function here must stay 1:1 with its TypeScript counterpart; any drift
// is a Phase 5 cutover blocker and must be caught by a dual-run script.
//
// This file ports src/utils/boq/calculateBoqAmount.ts.
package calc

// CurrencyRates mirrors the `{usd_rate, eur_rate, cny_rate}` partial of a tender row.
// Nullable rates → 0 in RUB terms (same as the TS `?? 0` fall-through).
type CurrencyRates struct {
	USDRate *float64
	EURRate *float64
	CNYRate *float64
}

// BOQ item type constants — Russian domain values as stored in public.boq_items.boq_item_type.
const (
	BoqRab        = "раб"
	BoqSubRab     = "суб-раб"
	BoqRabKomp    = "раб-комп."
	BoqMat        = "мат"
	BoqSubMat     = "суб-мат"
	BoqMatKomp    = "мат-комп."

	CurrencyRUB = "RUB"
	CurrencyUSD = "USD"
	CurrencyEUR = "EUR"
	CurrencyCNY = "CNY"

	DeliveryInPrice   = "в цене"
	DeliveryNotInPrice = "не в цене"
	DeliveryAmount    = "суммой"
)

// IsWorkBoqType returns true for work item types (раб / суб-раб / раб-комп.).
func IsWorkBoqType(t string) bool {
	return t == BoqRab || t == BoqSubRab || t == BoqRabKomp
}

// IsMaterialBoqType returns true for material item types (мат / суб-мат / мат-комп.).
func IsMaterialBoqType(t string) bool {
	return t == BoqMat || t == BoqSubMat || t == BoqMatKomp
}

// GetCurrencyRateFromTender returns the currency multiplier to convert unit_rate
// from the item's currency to RUB. RUB (or nil) → 1. Missing rate → 0 (matches
// the TS `|| 0` fallthrough).
func GetCurrencyRateFromTender(currency string, rates CurrencyRates) float64 {
	pickOrZero := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	switch currency {
	case CurrencyUSD:
		return pickOrZero(rates.USDRate)
	case CurrencyEUR:
		return pickOrZero(rates.EURRate)
	case CurrencyCNY:
		return pickOrZero(rates.CNYRate)
	default:
		return 1
	}
}

// BoqItemAmountInput is the subset of boq_items columns needed to compute total_amount.
// Pointers denote nullable numeric columns. Strings default to empty on NULL.
type BoqItemAmountInput struct {
	BoqItemType            string
	Quantity               *float64
	UnitRate               *float64
	CurrencyType           string
	DeliveryPriceType      string
	DeliveryAmount         *float64
	ConsumptionCoefficient *float64
	ParentWorkItemID       *string // non-nil ⇒ coefficient forced to 1 (subcontract group)
	TotalAmount            *float64 // fallback when item_type matches neither work nor material
}

// nz returns the dereferenced value, or 0 if nil.
func nz(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// CalculateDeliveryUnitCost returns the per-unit delivery add-on in RUB.
// Rule matrix (matches TS):
//   "в цене"      → 0           (delivery is bundled into unit_rate)
//   "не в цене"   → unit_rate * rate * 0.03  (implicit 3 % add-on)
//   "суммой"      → delivery_amount          (fixed RUB value per unit)
func CalculateDeliveryUnitCost(in BoqItemAmountInput, rates CurrencyRates) float64 {
	unitRate := nz(in.UnitRate)
	rate := GetCurrencyRateFromTender(in.CurrencyType, rates)

	switch in.DeliveryPriceType {
	case DeliveryNotInPrice:
		return unitRate * rate * 0.03
	case DeliveryAmount:
		return nz(in.DeliveryAmount)
	default:
		return 0
	}
}

// CalculateBoqItemTotalAmount returns the total RUB cost for a single BOQ item.
// Works:      quantity * unit_rate * rate.
// Materials:  quantity * consumption * (unit_rate * rate + delivery_per_unit),
//             where consumption = 1 when the item has a parent_work_item_id
//             (subcontract children inherit their parent's quantity semantics).
// Other:      fallback to existing total_amount (trigger-computed).
func CalculateBoqItemTotalAmount(in BoqItemAmountInput, rates CurrencyRates) float64 {
	quantity := nz(in.Quantity)
	unitRate := nz(in.UnitRate)
	rate := GetCurrencyRateFromTender(in.CurrencyType, rates)

	if IsWorkBoqType(in.BoqItemType) {
		return quantity * unitRate * rate
	}

	if IsMaterialBoqType(in.BoqItemType) {
		deliveryUnit := CalculateDeliveryUnitCost(in, rates)
		consumption := 1.0
		if in.ParentWorkItemID == nil {
			if c := nz(in.ConsumptionCoefficient); c != 0 {
				consumption = c
			}
		}
		return quantity * consumption * (unitRate*rate + deliveryUnit)
	}

	return nz(in.TotalAmount)
}
