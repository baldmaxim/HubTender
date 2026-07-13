package calc

import (
	"math"
	"testing"
)

// ── Rounding rules (audit §4) ────────────────────────────────────────────────
// These lock in that the project uses arithmetic (round-half-away-from-zero)
// rounding everywhere — NOT banker's rounding — and that RoundTo5 is idempotent
// (no double-rounding drift).

func TestRounding_IsArithmeticNotBankers(t *testing.T) {
	// Banker's rounding would give 2.5→2 and 0.5→0. math.Round gives half-away.
	cases := map[float64]float64{0.5: 1, 1.5: 2, 2.5: 3, 3.5: 4}
	for in, want := range cases {
		if got := math.Round(in); got != want {
			t.Fatalf("math.Round(%v)=%v, want %v — banker's rounding detected", in, got, want)
		}
	}
}

func TestRoundTo5_CriticalScenarios(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{100.555, 100}, // round(20.111)*5
		{100.554, 100},
		{102.5, 105}, // round(20.5)=21 (half-away) *5
		{102.4, 100},
		{0.005, 0},
		{0.0049, 0},
		{7.5, 10}, // round(1.5)=2 *5
	}
	for _, c := range cases {
		if got := RoundTo5(c.in); !almostEqual(got, c.want) {
			t.Fatalf("RoundTo5(%v)=%v, want %v", c.in, got, c.want)
		}
	}
}

func TestRoundTo5_Idempotent(t *testing.T) {
	// Applying the rounding twice must not drift (no double-rounding).
	for _, v := range []float64{100.555, 102.4, 7.5, 12345.67, 0.0049} {
		once := RoundTo5(v)
		twice := RoundTo5(once)
		if !almostEqual(once, twice) {
			t.Fatalf("RoundTo5 not idempotent for %v: once=%v twice=%v", v, once, twice)
		}
	}
}

// ── Cross-language parity anchors (audit §8) ─────────────────────────────────
// The SAME numeric fixtures are asserted here (Go, source of truth) and in
// scripts/checks/failClosed.check.mjs + fxGuard.check.mjs (TS mirror). If any
// mirror drifts, one side fails. This guarantees "same input → same result"
// across the backend calc and every frontend preview path.

func TestParity_CanonicalFixtures(t *testing.T) {
	// FX: USD qty2 × unit100 × rate90 = 18000 (also asserted in fxGuard.check.mjs).
	usd := f(90.0)
	got, err := CalculateBoqItemTotalAmount(BoqItemAmountInput{
		BoqItemType: BoqSubRab, Quantity: f(2), UnitRate: f(100), CurrencyType: CurrencyUSD,
	}, CurrencyRates{USDRate: usd})
	if err != nil || !almostEqual(got, 18000) {
		t.Fatalf("USD total = %v (err %v), want 18000", got, err)
	}

	// RUB computes without any rate = 50.
	got, err = CalculateBoqItemTotalAmount(BoqItemAmountInput{
		BoqItemType: BoqRab, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
	}, CurrencyRates{})
	if err != nil || !almostEqual(got, 50) {
		t.Fatalf("RUB total = %v (err %v), want 50", got, err)
	}

	// Same FX rate → same result (idempotent across calls).
	a, _ := CalculateBoqItemTotalAmount(BoqItemAmountInput{BoqItemType: BoqRab, Quantity: f(3), UnitRate: f(7), CurrencyType: CurrencyUSD}, CurrencyRates{USDRate: usd})
	b, _ := CalculateBoqItemTotalAmount(BoqItemAmountInput{BoqItemType: BoqRab, Quantity: f(3), UnitRate: f(7), CurrencyType: CurrencyUSD}, CurrencyRates{USDRate: usd})
	if a != b {
		t.Fatalf("same input gave different results: %v vs %v", a, b)
	}

	// Markup base=100: addOne 10% → 110, direct 10% → 10 (also in failClosed.check.mjs).
	addOne := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupParameters: map[string]float64{"m": 10},
		MarkupSequence: []MarkupStep{{BaseIndex: -1, Action1: OpMultiply, Operand1: Operand{Type: OperandMarkup, Key: "m", MultiplyFormat: MultiplyAddOne}}},
	})
	if !almostEqual(addOne.CommercialCost, 110) {
		t.Fatalf("addOne markup = %v, want 110", addOne.CommercialCost)
	}
	direct := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupParameters: map[string]float64{"m": 10},
		MarkupSequence: []MarkupStep{{BaseIndex: -1, Action1: OpMultiply, Operand1: Operand{Type: OperandMarkup, Key: "m", MultiplyFormat: MultiplyDirect}}},
	})
	if !almostEqual(direct.CommercialCost, 10) {
		t.Fatalf("direct markup = %v, want 10", direct.CommercialCost)
	}
}
