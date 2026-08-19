package repository

import (
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// redistributionResultsEqual decides whether a recalc may skip the full
// DELETE + N INSERT (six indexes, 2×N per-row pg_notify) and re-stamp the
// revision marker with a single UPDATE. A false positive would silently freeze
// stale money in the snapshot, so the comparison is pinned here.

func rr(id string, orig, ded, add, final float64) calc.RedistributionResult {
	return calc.RedistributionResult{
		BoqItemID: id, OriginalWorkCost: orig, DeductedAmount: ded,
		AddedAmount: add, FinalWorkCost: final,
	}
}

func TestRedistributionResultsEqual(t *testing.T) {
	base := []calc.RedistributionResult{
		rr("a", 1000, 100, 0, 900),
		rr("b", 500, 0, 100, 600),
	}

	cases := []struct {
		name string
		got  []calc.RedistributionResult
		want bool
	}{
		{"identical", []calc.RedistributionResult{
			rr("a", 1000, 100, 0, 900), rr("b", 500, 0, 100, 600)}, true},
		{"below epsilon", []calc.RedistributionResult{
			rr("a", 1000+1e-9, 100, 0, 900), rr("b", 500, 0, 100-1e-9, 600)}, true},
		{"original changed", []calc.RedistributionResult{
			rr("a", 1500, 100, 0, 900), rr("b", 500, 0, 100, 600)}, false},
		{"deducted changed", []calc.RedistributionResult{
			rr("a", 1000, 150, 0, 900), rr("b", 500, 0, 100, 600)}, false},
		{"added changed", []calc.RedistributionResult{
			rr("a", 1000, 100, 0, 900), rr("b", 500, 0, 150, 600)}, false},
		{"final changed", []calc.RedistributionResult{
			rr("a", 1000, 100, 0, 900), rr("b", 500, 0, 100, 650)}, false},
		{"one cent apart is a change", []calc.RedistributionResult{
			rr("a", 1000, 100, 0, 900.01), rr("b", 500, 0, 100, 600)}, false},
		{"different item id", []calc.RedistributionResult{
			rr("a", 1000, 100, 0, 900), rr("c", 500, 0, 100, 600)}, false},
		{"reordered is a change (both sides are id-ASC)", []calc.RedistributionResult{
			rr("b", 500, 0, 100, 600), rr("a", 1000, 100, 0, 900)}, false},
		{"missing row", []calc.RedistributionResult{rr("a", 1000, 100, 0, 900)}, false},
		{"extra row", []calc.RedistributionResult{
			rr("a", 1000, 100, 0, 900), rr("b", 500, 0, 100, 600), rr("c", 1, 0, 0, 1)}, false},
		{"empty vs populated", nil, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := redistributionResultsEqual(base, tc.got); got != tc.want {
				t.Fatalf("redistributionResultsEqual = %v, want %v", got, tc.want)
			}
		})
	}

	if !redistributionResultsEqual(nil, nil) {
		t.Fatal("two empty sets must compare equal")
	}
}
