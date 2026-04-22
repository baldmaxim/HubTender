// Port of the shared rounding kernel used by both
// src/pages/Commerce/utils/smartRounding.ts and
// src/pages/CostRedistribution/utils/smartRounding.ts.
//
// The two TS files have inverted signs in the compensation loop (known legacy
// behaviour per plan Phase 0.3.4). The Go port exposes both semantics via an
// explicit `SignMode` parameter — caller decides.
package calc

import (
	"math"
	"sort"
)

// RoundTo5 rounds a positive value to the nearest multiple of 5.
// Values < 2.5 round down to 0 (matches TS).
func RoundTo5(value float64) float64 {
	if value < 2.5 {
		return 0
	}
	return math.Round(value/5) * 5
}

// SignMode selects how to compensate a rounding error.
//
//   SignModeAddPositive:   when totalError > 0, adjust by +step (Commerce variant).
//   SignModeAddNegative:   when totalError > 0, adjust by -step (CostRedistribution
//                          variant — reduces prices when rounding-up overshot).
//
// The TS files also differ on whether remainingError is adjusted `-=` or `+=`
// after each tweak — this difference exactly cancels the sign inversion, so the
// Go port uses a single formula: remainingError -= adjustment*quantity in
// SignModeAddPositive mode and remainingError += adjustment*quantity in
// SignModeAddNegative mode. Pass the matching SignMode and the result stays
// bit-compatible with the corresponding TS output.
type SignMode int

const (
	SignModeAddPositive SignMode = iota // Commerce
	SignModeAddNegative                 // CostRedistribution
)

// RoundingItem is one entry passed to CompensateError.
type RoundingItem struct {
	Index          int     // opaque caller-side index preserved in the output map
	OriginalPrice  float64
	RoundedPrice   float64
	Error          float64 // (roundedPrice - originalPrice) * quantity
	FractionalPart float64 // originalPrice - floor(originalPrice) — used for ordering
	Quantity       float64
}

// CompensateError returns a map of {Index → new rounded price} for items whose
// price should be adjusted to offset the total rounding error.
//
// Threshold: if |totalError| < 1 the map is empty (no adjustment needed).
// Step size: 5 RUB (same as RoundTo5).
// Selection: items sorted by FractionalPart DESC — items with larger fractional
// parts absorb error first, matching TS behaviour.
func CompensateError(items []RoundingItem, totalError float64, mode SignMode) map[int]float64 {
	adjustments := map[int]float64{}
	if math.Abs(totalError) < 1 {
		return adjustments
	}

	sorted := make([]RoundingItem, len(items))
	copy(sorted, items)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].FractionalPart > sorted[j].FractionalPart
	})

	remainingError := totalError
	const step = 5.0

	var errorSign float64
	if mode == SignModeAddPositive {
		if totalError > 0 {
			errorSign = 1
		} else {
			errorSign = -1
		}
	} else {
		// SignModeAddNegative
		if totalError > 0 {
			errorSign = -1
		} else {
			errorSign = 1
		}
	}

	for _, it := range sorted {
		if math.Abs(remainingError) < step {
			break
		}
		if it.Quantity <= 0 {
			continue
		}

		maxAdjustment := math.Floor(math.Abs(remainingError)/(it.Quantity*step)) * step
		if maxAdjustment < step {
			continue
		}

		adjustment := maxAdjustment * errorSign
		adjustments[it.Index] = it.RoundedPrice + adjustment

		// Mirror the TS sign convention so remainingError converges to zero.
		if mode == SignModeAddPositive {
			remainingError -= adjustment * it.Quantity
		} else {
			remainingError += adjustment * it.Quantity
		}
	}

	return adjustments
}
