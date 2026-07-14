package calc

import (
	"errors"
	"math"
	"math/big"
	"testing"
)

// Stage 0.1.2.4a.1 §8: decimal insurance kernel + the single-formula contract
// between the decimal API and the legacy float64 wrapper.

func decIns(judicial, total, aptP, aptA, parkP, parkA, storP, storA string) *InsuranceDecimalInput {
	return &InsuranceDecimalInput{
		JudicialPct: judicial, TotalPct: total,
		AptPriceM2: aptP, AptArea: aptA,
		ParkingPriceM2: parkP, ParkingArea: parkA,
		StoragePriceM2: storP, StorageArea: storA,
	}
}

// §8.1 — exact insurance values (compared as exact rationals / decimal strings).
func TestInsuranceDecimal_ExactValues(t *testing.T) {
	cases := []struct {
		name string
		in   *InsuranceDecimalInput
		want string // exact decimal, NOT rounded
	}{
		{"nil = no insurance row", nil, "0"},
		{"all zeros", decIns("0", "0", "0", "0", "0", "0", "0", "0"), "0"},
		{"integers", decIns("1.5", "3", "1000", "10", "0", "0", "0", "0"), "4.5"},
		{"all three legs", decIns("10", "10", "100", "2", "50", "4", "25", "8"), "6"},
		{"half-cent product", decIns("1", "1", "50", "1", "0", "0", "0", "0"), "0.005"},
		{"fractional decimals stay exact", decIns("2.5", "1.25", "0.1", "0.3", "0", "0", "0", "0"),
			"0.000009375"}, // 0.03 × 0.025 × 0.0125 — exactly
		{"pct at 100 allowed", decIns("100", "100", "1.11", "1", "0", "0", "0", "0"), "1.11"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := CalculateInsuranceTotalDecimal(tc.in)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			want, _ := new(big.Rat).SetString(tc.want)
			if got.Cmp(want) != 0 {
				t.Fatalf("insurance = %s, want %s", got.RatString(), tc.want)
			}
			s, err := ExactDecimalString("insurance_total", got)
			if err != nil {
				t.Fatalf("ExactDecimalString: %v", err)
			}
			back, _ := new(big.Rat).SetString(s)
			if back.Cmp(want) != 0 {
				t.Fatalf("decimal round-trip %q != %s", s, tc.want)
			}
		})
	}
}

// §8.2 — validation: typed errors, no silent zeros.
func TestInsuranceDecimal_Validation(t *testing.T) {
	var cfgErr *InvalidInsuranceConfigurationError
	if _, err := CalculateInsuranceTotalDecimal(decIns("1", "1", "-5", "1", "0", "0", "0", "0")); !errors.As(err, &cfgErr) || cfgErr.Field != "apt_price_m2" {
		t.Fatalf("negative price: want InvalidInsuranceConfigurationError{apt_price_m2}, got %v", err)
	}
	if _, err := CalculateInsuranceTotalDecimal(decIns("100.01", "1", "1", "1", "0", "0", "0", "0")); !errors.As(err, &cfgErr) || cfgErr.Field != "judicial_pct" {
		t.Fatalf("pct>100: want InvalidInsuranceConfigurationError{judicial_pct}, got %v", err)
	}
	var mde *MoneyDecimalError
	if _, err := CalculateInsuranceTotalDecimal(decIns("1", "1", "abc", "1", "0", "0", "0", "0")); !errors.As(err, &mde) || mde.Reason != "MALFORMED_DECIMAL" {
		t.Fatalf("malformed: want MALFORMED_DECIMAL, got %v", err)
	}
}

// §8.3 — ONE formula: the float64 wrapper must agree exactly with the decimal
// API on inputs that are exactly representable in both worlds.
func TestInsurance_FloatWrapperDelegatesToKernel(t *testing.T) {
	cases := []struct {
		f InsuranceInput
		d *InsuranceDecimalInput
	}{
		{InsuranceInput{JudicialPct: 1.5, TotalPct: 3, AptPriceM2: 1000, AptArea: 10},
			decIns("1.5", "3", "1000", "10", "0", "0", "0", "0")},
		{InsuranceInput{JudicialPct: 10, TotalPct: 10, AptPriceM2: 100, AptArea: 2, ParkingPriceM2: 50, ParkingArea: 4, StoragePriceM2: 25, StorageArea: 8},
			decIns("10", "10", "100", "2", "50", "4", "25", "8")},
		{InsuranceInput{JudicialPct: 100, TotalPct: 100, AptPriceM2: 1.25, AptArea: 4},
			decIns("100", "100", "1.25", "4", "0", "0", "0", "0")},
	}
	for _, tc := range cases {
		fv, err := CalculateInsuranceTotal(&tc.f)
		if err != nil {
			t.Fatalf("float wrapper error: %v", err)
		}
		dv, err := CalculateInsuranceTotalDecimal(tc.d)
		if err != nil {
			t.Fatalf("decimal API error: %v", err)
		}
		if fv != ratToFloat(dv) {
			t.Fatalf("wrapper %v != kernel %v for %+v", fv, ratToFloat(dv), tc.f)
		}
	}
	// Wrapper keeps its legacy validation surface.
	var cfgErr *InvalidInsuranceConfigurationError
	if _, err := CalculateInsuranceTotal(&InsuranceInput{JudicialPct: math.NaN()}); !errors.As(err, &cfgErr) || cfgErr.Reason != "non-finite value" {
		t.Fatalf("NaN: want non-finite InvalidInsuranceConfigurationError, got %v", err)
	}
	if _, err := CalculateInsuranceTotal(&InsuranceInput{JudicialPct: -1}); !errors.As(err, &cfgErr) || cfgErr.Reason != "negative value" {
		t.Fatalf("negative: want negative-value error, got %v", err)
	}
	if v, err := CalculateInsuranceTotal(nil); err != nil || v != 0 {
		t.Fatalf("nil insurance: want 0, got %v/%v", v, err)
	}
}

// RoundMoney2Decimal — the canonical policy on raw rationals (both signs).
func TestRoundMoney2Decimal_Policy(t *testing.T) {
	cases := []struct {
		num, den int64
		want     string
	}{
		{1005, 1000, "1.01"},
		{-1005, 1000, "-1.01"},
		{2675, 1000, "2.68"},
		{1, 3, "0.33"},   // 0.333… → nearest
		{2, 3, "0.67"},   // 0.666… → nearest
		{-1, 3, "-0.33"}, // symmetric
		{0, 1, "0.00"},
	}
	for _, tc := range cases {
		got := FormatMoney2Decimal(RoundMoney2Decimal(big.NewRat(tc.num, tc.den)))
		if got != tc.want {
			t.Errorf("round(%d/%d) = %q, want %q", tc.num, tc.den, got, tc.want)
		}
	}
}

// ExactDecimalString — total for finite decimals, typed error otherwise.
func TestExactDecimalString(t *testing.T) {
	ok := []struct {
		num, den int64
		want     string
	}{
		{45, 10, "4.5"},
		{45, 1, "45"},
		{1, 8, "0.125"},
		{1, 160, "0.00625"},
		{-3, 4, "-0.75"},
		{0, 1, "0"},
	}
	for _, tc := range ok {
		got, err := ExactDecimalString("x", big.NewRat(tc.num, tc.den))
		if err != nil || got != tc.want {
			t.Errorf("exact(%d/%d) = %q/%v, want %q", tc.num, tc.den, got, err, tc.want)
		}
	}
	var mde *MoneyDecimalError
	if _, err := ExactDecimalString("x", big.NewRat(1, 3)); !errors.As(err, &mde) {
		t.Fatalf("1/3 must be a typed error, got %v", err)
	}
}
