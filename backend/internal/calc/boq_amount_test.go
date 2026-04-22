package calc

import (
	"math"
	"testing"
)

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

const eps = 1e-6

func almostEqual(a, b float64) bool { return math.Abs(a-b) < eps }

// These test cases mirror the exact math of
// src/utils/boq/calculateBoqAmount.ts. Any behaviour change in Go that makes
// one of these cases diverge is a Phase 5 cutover blocker.
func TestCalculateBoqItemTotalAmount(t *testing.T) {
	rubTender := CurrencyRates{}
	usdTender := CurrencyRates{USDRate: f(90), EURRate: f(100), CNYRate: f(12)}

	tests := []struct {
		name  string
		in    BoqItemAmountInput
		rates CurrencyRates
		want  float64
	}{
		// ─── Work types (раб / суб-раб / раб-комп.) ─────────────────────────
		{
			name: "work RUB — qty * unit_rate",
			in: BoqItemAmountInput{
				BoqItemType: BoqRab, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
			},
			rates: rubTender, want: 50,
		},
		{
			name: "suf-rab USD → converts with USD rate",
			in: BoqItemAmountInput{
				BoqItemType: BoqSubRab, Quantity: f(2), UnitRate: f(100), CurrencyType: CurrencyUSD,
			},
			rates: usdTender, want: 18000, // 2 * 100 * 90
		},
		{
			name: "rab-komp missing rate → 0 (TS `|| 0`)",
			in: BoqItemAmountInput{
				BoqItemType: BoqRabKomp, Quantity: f(5), UnitRate: f(10), CurrencyType: CurrencyCNY,
			},
			rates: CurrencyRates{}, want: 0,
		},

		// ─── Material types — delivery "в цене" (no add-on) ─────────────────
		{
			name: "material RUB, consumption 1, delivery in-price",
			in: BoqItemAmountInput{
				BoqItemType: BoqMat, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
				DeliveryPriceType: DeliveryInPrice, ConsumptionCoefficient: f(1),
			},
			rates: rubTender, want: 50, // 10 * 1 * (5*1 + 0)
		},
		{
			name: "material consumption 1.5 multiplies the whole unit cost",
			in: BoqItemAmountInput{
				BoqItemType: BoqMat, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
				DeliveryPriceType: DeliveryInPrice, ConsumptionCoefficient: f(1.5),
			},
			rates: rubTender, want: 75, // 10 * 1.5 * 5
		},

		// ─── Material — delivery "не в цене" (+3 %) ─────────────────────────
		{
			name: "material RUB with implicit 3% delivery",
			in: BoqItemAmountInput{
				BoqItemType: BoqMat, Quantity: f(10), UnitRate: f(100), CurrencyType: CurrencyRUB,
				DeliveryPriceType: DeliveryNotInPrice, ConsumptionCoefficient: f(1),
			},
			rates: rubTender, want: 1030, // 10 * 1 * (100 + 100*1*0.03)
		},

		// ─── Material — delivery "суммой" ───────────────────────────────────
		{
			name: "material RUB with fixed delivery amount per unit",
			in: BoqItemAmountInput{
				BoqItemType: BoqMat, Quantity: f(10), UnitRate: f(100), CurrencyType: CurrencyRUB,
				DeliveryPriceType: DeliveryAmount, DeliveryAmount: f(20), ConsumptionCoefficient: f(1),
			},
			rates: rubTender, want: 1200, // 10 * 1 * (100 + 20)
		},

		// ─── Subcontract child: parent_work_item_id non-nil ⇒ consumption=1 ─
		{
			name: "subcontract material child ignores consumption_coefficient",
			in: BoqItemAmountInput{
				BoqItemType: BoqSubMat, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
				DeliveryPriceType: DeliveryInPrice,
				ConsumptionCoefficient: f(9), // would yield 450 without the subcontract rule
				ParentWorkItemID:       s("00000000-0000-0000-0000-000000000001"),
			},
			rates: rubTender, want: 50, // 10 * 1 * 5
		},

		// ─── Fallback: unknown type returns TotalAmount as-is ───────────────
		{
			name: "unknown type falls back to trigger-computed total_amount",
			in: BoqItemAmountInput{
				BoqItemType: "", TotalAmount: f(777),
			},
			rates: rubTender, want: 777,
		},
		{
			name: "unknown type with nil total_amount → 0",
			in: BoqItemAmountInput{
				BoqItemType: "",
			},
			rates: rubTender, want: 0,
		},

		// ─── NULL handling ──────────────────────────────────────────────────
		{
			name: "work with nil quantity → 0",
			in: BoqItemAmountInput{
				BoqItemType: BoqRab, UnitRate: f(100), CurrencyType: CurrencyRUB,
			},
			rates: rubTender, want: 0,
		},
		{
			name: "material with nil consumption, no parent → defaults to 1",
			in: BoqItemAmountInput{
				BoqItemType: BoqMat, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
				DeliveryPriceType: DeliveryInPrice,
			},
			rates: rubTender, want: 50, // 10 * 1 * 5
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := CalculateBoqItemTotalAmount(tt.in, tt.rates)
			if !almostEqual(got, tt.want) {
				t.Errorf("CalculateBoqItemTotalAmount = %v, want %v", got, tt.want)
			}
		})
	}
}
