package calc

import (
	"math"
	"testing"
)

func TestRoundTo5(t *testing.T) {
	cases := []struct {
		in, want float64
	}{
		{0, 0},
		{1, 0},
		{2.49, 0},
		{2.5, 5},
		{7.3, 5},
		{7.5, 10}, // JS Math.round uses half-away-from-zero for positives; 7.5/5=1.5 → round → 2 → 10
		{12, 10},
		{13, 15},
		{100, 100},
		{102.3, 100},
		{102.5, 105},
	}
	for _, c := range cases {
		got := RoundTo5(c.in)
		if got != c.want {
			t.Errorf("RoundTo5(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

// Small error below threshold — no adjustments.
func TestCompensateError_BelowThreshold(t *testing.T) {
	items := []RoundingItem{
		{Index: 0, RoundedPrice: 100, FractionalPart: 0.9, Quantity: 10, Error: 0.5},
	}
	adj := CompensateError(items, 0.5, SignModeAddPositive)
	if len(adj) != 0 {
		t.Errorf("below threshold should return empty map, got %v", adj)
	}
}

// Positive error in AddPositive mode — errorSign=+1 → adjustment INCREASES price.
// This matches the Commerce TS variant.
func TestCompensateError_PositiveError_AddPositive(t *testing.T) {
	// totalError = 100, quantity = 10, step = 5.
	// maxAdjustment = floor(100 / (10*5)) * 5 = 2 * 5 = 10.
	// adjustment = 10 * 1 = +10.
	// new price = 100 + 10 = 110.
	items := []RoundingItem{
		{Index: 0, RoundedPrice: 100, FractionalPart: 0.9, Quantity: 10, Error: 100},
	}
	adj := CompensateError(items, 100, SignModeAddPositive)
	if adj[0] != 110 {
		t.Errorf("Commerce variant positive error: got %v, want 110", adj[0])
	}
}

// Positive error in AddNegative mode — errorSign=-1 → adjustment DECREASES price.
// This matches the CostRedistribution TS variant.
func TestCompensateError_PositiveError_AddNegative(t *testing.T) {
	items := []RoundingItem{
		{Index: 0, RoundedPrice: 100, FractionalPart: 0.9, Quantity: 10, Error: 100},
	}
	adj := CompensateError(items, 100, SignModeAddNegative)
	if adj[0] != 90 {
		t.Errorf("Redistribution variant positive error: got %v, want 90", adj[0])
	}
}

// Sort-by-fractional: item with the larger fractionalPart absorbs error first.
func TestCompensateError_Ordering(t *testing.T) {
	items := []RoundingItem{
		{Index: 0, RoundedPrice: 100, FractionalPart: 0.1, Quantity: 2, Error: 25},
		{Index: 1, RoundedPrice: 200, FractionalPart: 0.95, Quantity: 2, Error: 25},
	}
	// totalError = 50. With addPositive: errorSign=+1. Quantity=2, step=5.
	// For items sorted by fractionalPart DESC, index=1 first.
	//   maxAdjustment = floor(50/(2*5)) * 5 = 25. adjustment=+25.
	//   new price = 200 + 25 = 225. remainingError = 50 - 25*2 = 0. stop.
	adj := CompensateError(items, 50, SignModeAddPositive)
	if adj[1] != 225 {
		t.Errorf("first-in-sort absorbs error: got %v, want 225", adj[1])
	}
	if _, ok := adj[0]; ok {
		t.Errorf("second item should NOT be adjusted; got %v", adj[0])
	}
}

// Zero-quantity item is skipped (avoid div-by-zero).
func TestCompensateError_ZeroQuantity(t *testing.T) {
	items := []RoundingItem{
		{Index: 0, RoundedPrice: 100, FractionalPart: 0.9, Quantity: 0, Error: 100},
		{Index: 1, RoundedPrice: 200, FractionalPart: 0.5, Quantity: 10, Error: 50},
	}
	// index 0 is skipped, index 1 absorbs the error: maxAdj=floor(50/50)*5=5,
	// adj=+5, price = 205. remainingError = 50-5*10 = 0.
	adj := CompensateError(items, 50, SignModeAddPositive)
	if _, ok := adj[0]; ok {
		t.Errorf("zero-quantity item should be skipped")
	}
	if math.Abs(adj[1]-205) > 1e-6 {
		t.Errorf("non-zero-quantity adjusted: got %v, want 205", adj[1])
	}
}
