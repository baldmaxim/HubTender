package repository

import (
	"errors"
	"math"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Regression suite for stage 0.1.2.1: the template-insert path must derive
// total_amount EXCLUSIVELY through calc.CalculateBoqItemTotalAmount, with the
// same rules as CreateBoqItem.
//
// The LEGACY formula that was removed from template_insert.go was:
//
//	cRate         = orOne(rate)                     // nil/0 → 1.0 (FX bypass)
//	deliveryPrice = unitRate*cRate*0.03 | deliveryAmount
//	totalAmount   = quantity * (unitRate*cRate + deliveryPrice)   // NO consumption
//
// It is reproduced below ONLY to prove the divergence it caused is now gone.
func legacyTemplateTotal(quantity, unitRate, cRate, deliveryPrice float64) float64 {
	return quantity * (unitRate*cRate + deliveryPrice)
}

func eq(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func fp(v float64) *float64 { return &v }

// direct call to the authoritative kernel — the oracle every template row must match.
func oracle(t *testing.T, in calc.BoqItemAmountInput, rates calc.CurrencyRates) float64 {
	t.Helper()
	got, err := calc.CalculateBoqItemTotalAmount(in, rates)
	if err != nil {
		t.Fatalf("oracle calc error: %v", err)
	}
	return got
}

// ─── 1. Standalone material applies consumption_coefficient (legacy did NOT) ──
func TestTemplateAmount_StandaloneMaterial_AppliesConsumption(t *testing.T) {
	f := tmplAmountFields{
		ItemType: calc.BoqMat, Currency: calc.CurrencyRUB,
		Quantity: 10, UnitRate: 100,
		DeliveryPriceType:  calc.DeliveryInPrice,
		ConsumptionCoeff:   fp(1.2),
		HasEffectiveParent: false,
	}
	got, err := templateItemTotalAmount(f, calc.CurrencyRates{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !eq(got, 1200) {
		t.Fatalf("standalone material total = %v, want 1200 (10 × 1.2 × 100)", got)
	}
	// Proof the bug is fixed: the removed legacy formula produced 1000.
	if legacy := legacyTemplateTotal(10, 100, 1.0, 0); eq(legacy, got) {
		t.Fatalf("legacy formula still in effect (%v)", legacy)
	}
}

// ─── 2. Child material: consumption forced to 1 by calc ──────────────────────
func TestTemplateAmount_ChildMaterial_ConsumptionForcedToOne(t *testing.T) {
	f := tmplAmountFields{
		ItemType: calc.BoqMat, Currency: calc.CurrencyRUB,
		Quantity: 10, UnitRate: 100,
		DeliveryPriceType:  calc.DeliveryInPrice,
		ConsumptionCoeff:   fp(1.2), // stored, but must NOT be applied for a child
		HasEffectiveParent: true,
	}
	got, err := templateItemTotalAmount(f, calc.CurrencyRates{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !eq(got, 1000) {
		t.Fatalf("child material total = %v, want 1000 (10 × 1 × 100)", got)
	}
}

// ─── 3/4. Delivery rules come from calc, not a local formula ─────────────────
func TestTemplateAmount_DeliveryRulesMatchCalc(t *testing.T) {
	cases := []struct {
		name string
		dpt  string
		amt  float64
		want float64
	}{
		// 10 × 1.2 × (100 + 100*0.03) = 1236
		{"не в цене → implicit 3%", calc.DeliveryNotInPrice, 0, 1236},
		// 10 × 1.2 × (100 + 20) = 1440
		{"суммой → fixed per-unit amount", calc.DeliveryAmount, 20, 1440},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := tmplAmountFields{
				ItemType: calc.BoqMat, Currency: calc.CurrencyRUB,
				Quantity: 10, UnitRate: 100,
				DeliveryPriceType: c.dpt, DeliveryAmount: c.amt,
				ConsumptionCoeff: fp(1.2),
			}
			got, err := templateItemTotalAmount(f, calc.CurrencyRates{})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if !eq(got, c.want) {
				t.Fatalf("%s: total = %v, want %v", c.name, got, c.want)
			}
			// Must equal the oracle exactly.
			if !eq(got, oracle(t, f.amountInput(), calc.CurrencyRates{})) {
				t.Fatalf("%s: diverges from calc oracle", c.name)
			}
		})
	}
}

// ─── 5. Work: quantity × unit_rate (no consumption, no delivery) ─────────────
func TestTemplateAmount_Work(t *testing.T) {
	f := tmplAmountFields{
		ItemType: calc.BoqRab, Currency: calc.CurrencyRUB,
		Quantity: 10, UnitRate: 100,
	}
	got, err := templateItemTotalAmount(f, calc.CurrencyRates{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !eq(got, 1000) {
		t.Fatalf("work total = %v, want 1000", got)
	}
}

// ─── 6. USD with a positive rate == direct calc call ─────────────────────────
func TestTemplateAmount_USD_MatchesCalcOracle(t *testing.T) {
	rates := calc.CurrencyRates{USDRate: fp(90)}
	f := tmplAmountFields{
		ItemType: calc.BoqMat, Currency: calc.CurrencyUSD,
		Quantity: 2, UnitRate: 100,
		DeliveryPriceType: calc.DeliveryInPrice,
		ConsumptionCoeff:  fp(1.5),
	}
	got, err := templateItemTotalAmount(f, rates)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// 2 × 1.5 × (100 × 90) = 27000
	if !eq(got, 27000) {
		t.Fatalf("USD total = %v, want 27000", got)
	}
	if !eq(got, oracle(t, f.amountInput(), rates)) {
		t.Fatalf("template path diverges from calc oracle")
	}
}

// ─── 7/8/9. Missing or zero FX rate → blocking MissingFXRateError ────────────
func TestTemplateAmount_MissingFXRate_Blocks(t *testing.T) {
	cases := []struct {
		name     string
		currency string
		rates    calc.CurrencyRates
	}{
		{"USD nil rate", calc.CurrencyUSD, calc.CurrencyRates{}},
		{"USD zero rate", calc.CurrencyUSD, calc.CurrencyRates{USDRate: fp(0)}},
		{"EUR nil rate", calc.CurrencyEUR, calc.CurrencyRates{}},
		{"CNY nil rate", calc.CurrencyCNY, calc.CurrencyRates{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := tmplAmountFields{
				ItemType: calc.BoqRab, Currency: c.currency,
				Quantity: 10, UnitRate: 100,
			}
			got, err := templateItemTotalAmount(f, c.rates)

			var fx *calc.MissingFXRateError
			if !errors.As(err, &fx) {
				t.Fatalf("expected MissingFXRateError, got err=%v total=%v", err, got)
			}
			if fx.Currency != c.currency {
				t.Fatalf("MissingFXRateError.Currency = %q, want %q", fx.Currency, c.currency)
			}
			// Must NOT fall back to rate 1.0 (legacy orOne) or a successful 0.
			if err == nil {
				t.Fatal("missing FX rate must never produce a successful result")
			}
			if legacy := legacyTemplateTotal(10, 100, 1.0, 0); eq(got, legacy) {
				t.Fatalf("FX fallback to 1.0 still in effect (got %v)", got)
			}
		})
	}
}

// ─── 10. RUB computes with no currency rates at all ──────────────────────────
func TestTemplateAmount_RUB_NoRatesNeeded(t *testing.T) {
	f := tmplAmountFields{
		ItemType: calc.BoqRab, Currency: calc.CurrencyRUB,
		Quantity: 10, UnitRate: 5,
	}
	got, err := templateItemTotalAmount(f, calc.CurrencyRates{})
	if err != nil {
		t.Fatalf("RUB must not require a rate: %v", err)
	}
	if !eq(got, 50) {
		t.Fatalf("RUB total = %v, want 50", got)
	}
}

// ─── Parent marker semantics: non-nil iff the link will really be restored ───
func TestTemplateAmount_ParentMarkerSemantics(t *testing.T) {
	base := tmplAmountFields{
		ItemType: calc.BoqMat, Currency: calc.CurrencyRUB,
		Quantity: 1, UnitRate: 1, ConsumptionCoeff: fp(2),
		DeliveryPriceType: calc.DeliveryInPrice,
	}

	noParent := base
	noParent.HasEffectiveParent = false
	if in := noParent.amountInput(); in.ParentWorkItemID != nil {
		t.Fatal("no effective parent must map to a nil ParentWorkItemID")
	}

	withParent := base
	withParent.HasEffectiveParent = true
	in := withParent.amountInput()
	if in.ParentWorkItemID == nil || *in.ParentWorkItemID != templateParentMarker {
		t.Fatal("effective parent must map to the non-nil parent marker")
	}
}
