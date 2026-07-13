// Package calc holds pure Go ports of frontend calculation utilities.
// Every function here must stay 1:1 with its TypeScript counterpart; any drift
// is a Phase 5 cutover blocker and must be caught by a dual-run script.
//
// This file ports src/utils/boq/calculateBoqAmount.ts.
package calc

// CurrencyRates mirrors the `{usd_rate, eur_rate, cny_rate}` partial of a tender row.
// A nil (or non-positive) rate for a currency an item actually uses is a BLOCKING
// error (MissingFXRateError), never a silent 0 — see GetCurrencyRateFromTender.
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
// from the item's currency to RUB. RUB (and any non-foreign/empty currency) → 1
// and never errors. USD/EUR/CNY with a nil or non-positive rate → a blocking
// MissingFXRateError (never a silent 0).
func GetCurrencyRateFromTender(currency string, rates CurrencyRates) (float64, error) {
	pick := func(p *float64) (float64, error) {
		if p == nil || *p <= 0 {
			return 0, &MissingFXRateError{Currency: currency}
		}
		return *p, nil
	}
	switch currency {
	case CurrencyUSD:
		return pick(rates.USDRate)
	case CurrencyEUR:
		return pick(rates.EURRate)
	case CurrencyCNY:
		return pick(rates.CNYRate)
	default:
		return 1, nil
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
func CalculateDeliveryUnitCost(in BoqItemAmountInput, rates CurrencyRates) (float64, error) {
	unitRate := nz(in.UnitRate)
	rate, err := GetCurrencyRateFromTender(in.CurrencyType, rates)
	if err != nil {
		return 0, err
	}

	switch in.DeliveryPriceType {
	case DeliveryNotInPrice:
		return unitRate * rate * 0.03, nil
	case DeliveryAmount:
		return nz(in.DeliveryAmount), nil
	default:
		return 0, nil
	}
}

// CalculateBoqItemTotalAmount returns the total RUB cost for a single BOQ item.
// Works:      quantity * unit_rate * rate.
// Materials:  quantity * consumption * (unit_rate * rate + delivery_per_unit),
//             where consumption = 1 when the item has a parent_work_item_id
//             (subcontract children inherit their parent's quantity semantics).
// Other:      fallback to the stored total_amount. NOTE: total_amount is
//             app-computed only — no DB trigger or GENERATED column sets it
//             (verified in db/yandex/sql; see docs/CALCULATION_SOURCE_OF_TRUTH.md).
func CalculateBoqItemTotalAmount(in BoqItemAmountInput, rates CurrencyRates) (float64, error) {
	quantity := nz(in.Quantity)
	unitRate := nz(in.UnitRate)
	rate, err := GetCurrencyRateFromTender(in.CurrencyType, rates)
	if err != nil {
		return 0, err
	}

	if IsWorkBoqType(in.BoqItemType) {
		return quantity * unitRate * rate, nil
	}

	if IsMaterialBoqType(in.BoqItemType) {
		deliveryUnit, err := CalculateDeliveryUnitCost(in, rates)
		if err != nil {
			return 0, err
		}
		consumption := 1.0
		if in.ParentWorkItemID == nil {
			if c := nz(in.ConsumptionCoefficient); c != 0 {
				consumption = c
			}
		}
		return quantity * consumption * (unitRate*rate + deliveryUnit), nil
	}

	return nz(in.TotalAmount), nil
}
