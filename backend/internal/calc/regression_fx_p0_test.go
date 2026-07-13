package calc

import (
	"errors"
	"testing"
)

// P0 bug 3: a missing/zero FX rate for a foreign-currency item must be a
// blocking MissingFXRateError, never a silently-zero amount. RUB must still
// compute without any rate. Cases are data-driven from
// testdata/calculation_cases.json (amount_cases).

func TestFX_AmountCases(t *testing.T) {
	for _, c := range loadCalcCases(t).AmountCases {
		t.Run(c.Name, func(t *testing.T) {
			got, err := CalculateBoqItemTotalAmount(c.In.toInput(), c.Rates.toRates())

			if c.WantErrCurrency != "" {
				var fx *MissingFXRateError
				if !errors.As(err, &fx) {
					t.Fatalf("expected MissingFXRateError, got err=%v amount=%v", err, got)
				}
				if fx.Currency != c.WantErrCurrency {
					t.Fatalf("MissingFXRateError.Currency = %q, want %q", fx.Currency, c.WantErrCurrency)
				}
				// Never a successful zero: on error the amount is meaningless and
				// must not be treated as a real total.
				if err == nil {
					t.Fatalf("missing rate must not return a successful (0, nil)")
				}
				return
			}

			if err != nil {
				t.Fatalf("unexpected error for %s: %v", c.Name, err)
			}
			if !almostEqual(got, c.WantAmount) {
				t.Fatalf("amount = %v, want %v", got, c.WantAmount)
			}
		})
	}
}

// Explicit guard: RUB is computable with an entirely empty CurrencyRates.
func TestFX_RUB_NoRate_OK(t *testing.T) {
	got, err := CalculateBoqItemTotalAmount(BoqItemAmountInput{
		BoqItemType: BoqRab, Quantity: f(10), UnitRate: f(5), CurrencyType: CurrencyRUB,
	}, CurrencyRates{})
	if err != nil {
		t.Fatalf("RUB must not require a rate, got err: %v", err)
	}
	if !almostEqual(got, 50) {
		t.Fatalf("RUB amount = %v, want 50", got)
	}
}

// Explicit guard: a missing foreign rate never yields a successful zero.
func TestFX_MissingRate_NeverZeroSuccess(t *testing.T) {
	for _, cur := range []string{CurrencyUSD, CurrencyEUR, CurrencyCNY} {
		got, err := CalculateBoqItemTotalAmount(BoqItemAmountInput{
			BoqItemType: BoqRab, Quantity: f(1), UnitRate: f(100), CurrencyType: cur,
		}, CurrencyRates{})
		if err == nil {
			t.Fatalf("%s missing rate returned successful amount %v (must error)", cur, got)
		}
	}
}
