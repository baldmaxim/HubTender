// Stage 0.1.2.4a.1: the narrow decimal-safe money boundary for
// tenders.cached_grand_total.
//
// PostgreSQL stores every participating column as NUMERIC. The authoritative
// path therefore never converts them to float64 before the final rounding:
// aggregates and insurance fields are read as exact decimal strings (::text),
// all arithmetic runs on stdlib math/big.Rat (exact rational arithmetic — a
// finite decimal is always exactly representable), and the single final
// rounding is DECIMAL half away from zero: 1.005 → 1.01, 2.675 → 2.68,
// 100.555 → 100.56.
//
// Deliberately NO third-party decimal dependency: big.Rat/big.Int are the
// stdlib-proven kernel the task explicitly allows; no ad-hoc epsilon, no
// binary math.Round(value*100)/100 on the authoritative path, no
// locale-dependent formatting.
//
// Scope is intentionally narrow (§3): ONLY the cached-grand-total boundary
// (insurance kernel + total kernel + repository read/write). The rest of the
// project's float64 money math (prepared pipeline preview parity, FI legacy)
// is untouched — full decimal migration is a separate future stage.
package calc

import (
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// MoneyDecimalError — a malformed/unrepresentable decimal money value on the
// authoritative boundary. Never silently coerced to 0.
type MoneyDecimalError struct {
	Field  string
	Value  string
	Reason string // MALFORMED_DECIMAL | NEGATIVE_VALUE | NOT_FINITE | OVERFLOW
}

func (e *MoneyDecimalError) Error() string {
	return fmt.Sprintf("MONEY_DECIMAL_ERROR: %s (%s=%q)", e.Reason, e.Field, e.Value)
}

// decimalRe — strict decimal literal as PostgreSQL numeric::text emits it.
var decimalRe = regexp.MustCompile(`^-?[0-9]+(\.[0-9]+)?$`)

// maxDecimalDigits caps the accepted magnitude (PostgreSQL numeric can hold
// thousands of digits; money values beyond this are treated as OVERFLOW).
const maxDecimalDigits = 40

// parseDecimalRat parses an exact decimal string into a big.Rat.
func parseDecimalRat(field, s string) (*big.Rat, error) {
	s = strings.TrimSpace(s)
	if s == "" || !decimalRe.MatchString(s) {
		return nil, &MoneyDecimalError{Field: field, Value: s, Reason: "MALFORMED_DECIMAL"}
	}
	digits := len(strings.TrimLeft(s, "-")) - strings.Count(s, ".")
	if digits > maxDecimalDigits {
		return nil, &MoneyDecimalError{Field: field, Value: s, Reason: "OVERFLOW"}
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, &MoneyDecimalError{Field: field, Value: s, Reason: "MALFORMED_DECIMAL"}
	}
	return r, nil
}

// parseNonNegativeDecimalRat additionally enforces the non-negative money
// invariant of the cached-total inputs.
func parseNonNegativeDecimalRat(field, s string) (*big.Rat, error) {
	r, err := parseDecimalRat(field, s)
	if err != nil {
		return nil, err
	}
	if r.Sign() < 0 {
		return nil, &MoneyDecimalError{Field: field, Value: s, Reason: "NEGATIVE_VALUE"}
	}
	return r, nil
}

// floatToRat converts a LEGACY float64 boundary value into an exact big.Rat
// (the float's exact binary value — no decimal reinterpretation). NaN/±Inf are
// typed errors.
func floatToRat(field string, v float64) (*big.Rat, error) {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return nil, &MoneyDecimalError{
			Field: field, Value: strconv.FormatFloat(v, 'g', -1, 64), Reason: "NOT_FINITE"}
	}
	return new(big.Rat).SetFloat64(v), nil
}

// RoundMoney2Decimal rounds an exact rational money value to 2 decimal places
// using DECIMAL half away from zero (the canonical monetary policy; matches
// PostgreSQL ROUND(numeric, 2)). Deterministic, no float64 involved.
// Negative zero cannot escape: a zero result is exactly 0/1.
func RoundMoney2Decimal(r *big.Rat) *big.Rat {
	// x*100 = num/den; n = trunc(num/den); rem = num - n*den.
	scaled := new(big.Rat).Mul(r, big.NewRat(100, 1))
	num := new(big.Int).Set(scaled.Num())
	den := new(big.Int).Set(scaled.Denom()) // > 0 by big.Rat invariant

	n, rem := new(big.Int).QuoRem(num, den, new(big.Int)) // trunc toward zero
	// |rem|*2 >= den → away from zero.
	rem.Abs(rem)
	rem.Mul(rem, big.NewInt(2))
	if rem.Cmp(den) >= 0 {
		if scaled.Sign() >= 0 {
			n.Add(n, big.NewInt(1))
		} else {
			n.Sub(n, big.NewInt(1))
		}
	}
	return new(big.Rat).SetFrac(n, big.NewInt(100))
}

// FormatMoney2Decimal renders an ALREADY 2dp-rounded rational as the canonical
// "1234.56" decimal string (no negative zero, no locale, no exponent). This is
// the exact value bound into the NUMERIC column — never a float64.
func FormatMoney2Decimal(r *big.Rat) string {
	cents := new(big.Rat).Mul(r, big.NewRat(100, 1))
	if !cents.IsInt() {
		// Defensive: callers must round first; fall back to exact FloatString
		// of the rounded value.
		return RoundMoney2Decimal(r).FloatString(2)
	}
	n := cents.Num()
	if n.Sign() == 0 {
		return "0.00" // normalized zero (never "-0.00")
	}
	sign := ""
	abs := new(big.Int).Abs(n)
	if n.Sign() < 0 {
		sign = "-"
	}
	whole, frac := new(big.Int).QuoRem(abs, big.NewInt(100), new(big.Int))
	return fmt.Sprintf("%s%s.%02d", sign, whole.String(), frac.Int64())
}

// ratToFloat converts a FINAL (already rounded) decimal value to float64 for
// JSON/DTO compatibility only. Authoritative persistence uses the decimal
// string, never this value.
func ratToFloat(r *big.Rat) float64 {
	f, _ := r.Float64()
	return f
}

// ExactDecimalString renders an exact rational as a plain decimal string
// WITHOUT any rounding. It is total for every value on this boundary: NUMERIC
// inputs are finite decimals and stay finite under +, × and ÷100, so the
// reduced denominator is always 2^a·5^b. A non-terminating rational (foreign
// to this boundary) is a typed error — never a silent approximation.
func ExactDecimalString(field string, r *big.Rat) (string, error) {
	den := new(big.Int).Set(r.Denom())
	digits := 0
	for _, p := range []int64{2, 5} {
		pb := big.NewInt(p)
		count := 0
		q, rem := new(big.Int), new(big.Int)
		for {
			q.QuoRem(den, pb, rem)
			if rem.Sign() != 0 {
				break
			}
			den.Set(q)
			count++
		}
		if count > digits {
			digits = count
		}
	}
	if den.Cmp(big.NewInt(1)) != 0 {
		return "", &MoneyDecimalError{Field: field, Value: r.RatString(), Reason: "MALFORMED_DECIMAL"}
	}
	if digits == 0 {
		return r.Num().String(), nil
	}
	// r·10^digits is an integer, so FloatString(digits) is exact (no rounding).
	return r.FloatString(digits), nil
}

// insuranceTotalRat is the ONE insurance formula kernel:
//
//	(apt_price×apt_area + parking_price×parking_area + storage_price×storage_area)
//	× judicial_pct/100 × total_pct/100
//
// exact rational arithmetic; both the decimal API and the legacy float64
// wrapper delegate here — the formula exists in one place.
func insuranceTotalRat(aptPrice, aptArea, parkPrice, parkArea, storPrice, storArea, judicialPct, totalPct *big.Rat) *big.Rat {
	base := new(big.Rat).Mul(aptPrice, aptArea)
	base.Add(base, new(big.Rat).Mul(parkPrice, parkArea))
	base.Add(base, new(big.Rat).Mul(storPrice, storArea))
	hundred := big.NewRat(100, 1)
	out := new(big.Rat).Mul(base, new(big.Rat).Quo(judicialPct, hundred))
	out.Mul(out, new(big.Rat).Quo(totalPct, hundred))
	return out
}

// InsuranceDecimalInput mirrors public.tender_insurance read as EXACT decimal
// strings (numeric::text) — the authoritative cached-total path.
type InsuranceDecimalInput struct {
	AptPriceM2     string
	AptArea        string
	ParkingPriceM2 string
	ParkingArea    string
	StoragePriceM2 string
	StorageArea    string
	JudicialPct    string
	TotalPct       string
}

// CalculateInsuranceTotalDecimal validates the exact decimal insurance
// configuration and returns the EXACT (unrounded) insurance total. nil input =
// no insurance row = 0. Same validation rules as the float API: non-negative
// fields, percentages within [0, 100].
func CalculateInsuranceTotalDecimal(in *InsuranceDecimalInput) (*big.Rat, error) {
	if in == nil {
		return new(big.Rat), nil
	}
	fields := []struct {
		name string
		val  string
	}{
		{"apt_price_m2", in.AptPriceM2}, {"apt_area", in.AptArea},
		{"parking_price_m2", in.ParkingPriceM2}, {"parking_area", in.ParkingArea},
		{"storage_price_m2", in.StoragePriceM2}, {"storage_area", in.StorageArea},
		{"judicial_pct", in.JudicialPct}, {"total_pct", in.TotalPct},
	}
	vals := make([]*big.Rat, len(fields))
	for i, f := range fields {
		r, err := parseNonNegativeDecimalRat(f.name, f.val)
		if err != nil {
			// Preserve the established typed error for user-facing config issues.
			var mde *MoneyDecimalError
			if asMoneyErr(err, &mde) && mde.Reason == "NEGATIVE_VALUE" {
				return nil, &InvalidInsuranceConfigurationError{Field: f.name, Reason: "negative value"}
			}
			return nil, err
		}
		vals[i] = r
	}
	hundred := big.NewRat(100, 1)
	for _, p := range []struct {
		name string
		val  *big.Rat
	}{{"judicial_pct", vals[6]}, {"total_pct", vals[7]}} {
		if p.val.Cmp(hundred) > 0 {
			return nil, &InvalidInsuranceConfigurationError{Field: p.name, Reason: "percentage out of range [0,100]"}
		}
	}
	return insuranceTotalRat(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], vals[7]), nil
}

// asMoneyErr is a tiny local errors.As shim (avoids importing errors here twice).
func asMoneyErr(err error, target **MoneyDecimalError) bool {
	e, ok := err.(*MoneyDecimalError)
	if ok {
		*target = e
	}
	return ok
}
