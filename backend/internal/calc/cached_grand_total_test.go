package calc

import (
	"errors"
	"math"
	"testing"
)

// Stage 0.1.2.4a (§16): the pure cached-grand-total kernel.

func mustCGT(t *testing.T, in CachedTenderGrandTotalInput) *CachedTenderGrandTotalResult {
	t.Helper()
	out, err := CalculateCachedTenderGrandTotal(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return out
}

// §16.1-7 — composition cases; insurance exactly once.
func TestCachedGrandTotal_Composition(t *testing.T) {
	cases := []struct {
		name string
		in   CachedTenderGrandTotalInput
		want float64
	}{
		{"empty", CachedTenderGrandTotalInput{}, 0},
		{"material only", CachedTenderGrandTotalInput{CommercialMaterialTotal: 100.5}, 100.5},
		{"work only", CachedTenderGrandTotalInput{CommercialWorkTotal: 200.25}, 200.25},
		{"material+work", CachedTenderGrandTotalInput{CommercialMaterialTotal: 100, CommercialWorkTotal: 200}, 300},
		{"insurance only", CachedTenderGrandTotalInput{InsuranceTotal: 50}, 50},
		{"commercial+insurance", CachedTenderGrandTotalInput{CommercialMaterialTotal: 100, CommercialWorkTotal: 200, InsuranceTotal: 50}, 350},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := mustCGT(t, tc.in)
			if out.RoundedTotal != tc.want {
				t.Fatalf("rounded = %v, want %v", out.RoundedTotal, tc.want)
			}
			// §16.17 — breakdown identities.
			if out.CommercialTotal != tc.in.CommercialMaterialTotal+tc.in.CommercialWorkTotal {
				t.Fatal("commercial != material + work")
			}
			if out.BeforeRounding != out.CommercialTotal+out.InsuranceTotal {
				t.Fatal("beforeRounding != commercial + insurance (insurance must be added exactly once)")
			}
			if out.RoundedTotal != round2(out.BeforeRounding) {
				t.Fatal("rounded != round2(beforeRounding)")
			}
			if math.Abs(out.RoundingAdjustment-(out.RoundedTotal-out.BeforeRounding)) > 1e-12 {
				t.Fatal("roundingAdjustment identity broken")
			}
		})
	}
}

// §16.8-12 — malformed inputs are typed errors, never a successful 0.
func TestCachedGrandTotal_MalformedInputs(t *testing.T) {
	bad := []struct {
		name   string
		in     CachedTenderGrandTotalInput
		field  string
		reason string
	}{
		{"NaN material", CachedTenderGrandTotalInput{CommercialMaterialTotal: math.NaN()}, "commercial_material_total", "NOT_FINITE"},
		{"NaN work", CachedTenderGrandTotalInput{CommercialWorkTotal: math.NaN()}, "commercial_work_total", "NOT_FINITE"},
		{"NaN insurance", CachedTenderGrandTotalInput{InsuranceTotal: math.NaN()}, "insurance_total", "NOT_FINITE"},
		{"+Inf", CachedTenderGrandTotalInput{CommercialWorkTotal: math.Inf(1)}, "commercial_work_total", "NOT_FINITE"},
		{"-Inf", CachedTenderGrandTotalInput{InsuranceTotal: math.Inf(-1)}, "insurance_total", "NOT_FINITE"},
		{"negative material", CachedTenderGrandTotalInput{CommercialMaterialTotal: -1}, "commercial_material_total", "NEGATIVE_VALUE"},
		{"negative work", CachedTenderGrandTotalInput{CommercialWorkTotal: -0.01}, "commercial_work_total", "NEGATIVE_VALUE"},
		{"negative insurance", CachedTenderGrandTotalInput{InsuranceTotal: -5}, "insurance_total", "NEGATIVE_VALUE"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			out, err := CalculateCachedTenderGrandTotal(tc.in)
			var inErr *InvalidCachedGrandTotalInputError
			if !errors.As(err, &inErr) {
				t.Fatalf("want InvalidCachedGrandTotalInputError, got %v", err)
			}
			if inErr.Field != tc.field || inErr.Reason != tc.reason {
				t.Fatalf("field/reason = %s/%s, want %s/%s", inErr.Field, inErr.Reason, tc.field, tc.reason)
			}
			if out != nil {
				t.Fatal("no result may be returned for malformed input")
			}
		})
	}
}

// §16.13 / §4 — rounding boundary fixtures (documented policy: round2 = half
// away from zero on the *100 scale, within float64 representation limits).
func TestCachedGrandTotal_RoundingBoundaries(t *testing.T) {
	cases := []struct {
		in   float64
		want float64
	}{
		{0, 0},
		{0.004, 0},
		{0.005, 0.01},
		{0.006, 0.01},
		{1.004, 1},
		{1.005, 1.0}, // float64(1.005) = 1.00499999… → 1.00 (documented limitation)
		{1.006, 1.01},
		{100.554, 100.55},
		{100.555, 100.56}, // float64(100.555) = 100.55500000000000682 → up
		{100.556, 100.56},
		{123456789012.34, 123456789012.34}, // §16.14 large finite value
		{1.23456789, 1.23},
	}
	for _, tc := range cases {
		out := mustCGT(t, CachedTenderGrandTotalInput{CommercialWorkTotal: tc.in})
		if out.RoundedTotal != tc.want {
			t.Errorf("round(%v) = %v, want %v", tc.in, out.RoundedTotal, tc.want)
		}
	}
}

// §16.15/16 — input not mutated; repeat runs identical.
func TestCachedGrandTotal_DeterministicAndImmutable(t *testing.T) {
	in := CachedTenderGrandTotalInput{CommercialMaterialTotal: 100.33, CommercialWorkTotal: 200.44, InsuranceTotal: 50.55}
	snapshot := in
	out1 := mustCGT(t, in)
	out2 := mustCGT(t, in)
	if *out1 != *out2 {
		t.Fatal("repeat calculation not deterministic")
	}
	if in != snapshot {
		t.Fatal("input was mutated")
	}
}

// §16 property/fuzz — deterministic LCG over valid finite inputs: no NaN/Inf,
// no negative total, insurance conserved in the breakdown, no panic.
func TestCachedGrandTotal_Properties(t *testing.T) {
	seed := uint64(12345)
	for i := 0; i < 500; i++ {
		in := CachedTenderGrandTotalInput{
			CommercialMaterialTotal: lcg(&seed),
			CommercialWorkTotal:     lcg(&seed),
			InsuranceTotal:          lcg(&seed),
		}
		out := mustCGT(t, in)
		if math.IsNaN(out.RoundedTotal) || math.IsInf(out.RoundedTotal, 0) {
			t.Fatalf("non-finite total for %+v", in)
		}
		if out.RoundedTotal < 0 {
			t.Fatalf("negative total for %+v", in)
		}
		if out.InsuranceTotal != in.InsuranceTotal {
			t.Fatalf("insurance not conserved: %v != %v", out.InsuranceTotal, in.InsuranceTotal)
		}
		if math.Abs(out.RoundedTotal-out.BeforeRounding) > 0.005+1e-9 {
			t.Fatalf("rounding moved more than half a kopeck: %+v", out)
		}
	}
}
