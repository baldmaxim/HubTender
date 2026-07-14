package calc

import (
	"errors"
	"math"
	"math/big"
	"regexp"
	"strings"
	"testing"
)

// Stage 0.1.2.4a (§16) + 0.1.2.4a.1 (§7): the pure cached-grand-total kernel,
// decimal-exact contract. Assertions compare CANONICAL DECIMAL STRINGS
// (RoundedTotalDecimal), never float equality.
//
// Red-history (§7.1): the pre-decimal float64 implementation failed the
// canonical fixture with `round(1.005) = 1, want 1.01` — captured before the
// fix; the decimal kernel below is the fix.

func mustCGT(t *testing.T, in CachedTenderGrandTotalInput) *CachedTenderGrandTotalResult {
	t.Helper()
	out, err := CalculateCachedTenderGrandTotal(in)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	return out
}

func mustRat(t *testing.T, s string) *big.Rat {
	t.Helper()
	if s == "" {
		s = "0"
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		t.Fatalf("bad rat literal %q", s)
	}
	return r
}

// §16.1-7 — composition cases; insurance exactly once; exact breakdown
// identities recomputed in big.Rat.
func TestCachedGrandTotal_Composition(t *testing.T) {
	cases := []struct {
		name string
		in   CachedTenderGrandTotalInput
		want string
	}{
		{"all zero (empty tender)", CachedTenderGrandTotalInput{CommercialMaterialTotal: "0", CommercialWorkTotal: "0", InsuranceTotalDecimal: "0"}, "0.00"},
		{"material only", CachedTenderGrandTotalInput{CommercialMaterialTotal: "100.5", CommercialWorkTotal: "0", InsuranceTotalDecimal: "0"}, "100.50"},
		{"work only", CachedTenderGrandTotalInput{CommercialMaterialTotal: "0", CommercialWorkTotal: "200.25", InsuranceTotalDecimal: "0"}, "200.25"},
		{"material+work", CachedTenderGrandTotalInput{CommercialMaterialTotal: "100", CommercialWorkTotal: "200", InsuranceTotalDecimal: "0"}, "300.00"},
		{"insurance only", CachedTenderGrandTotalInput{CommercialMaterialTotal: "0", CommercialWorkTotal: "0", InsuranceTotalDecimal: "50"}, "50.00"},
		{"commercial+insurance", CachedTenderGrandTotalInput{CommercialMaterialTotal: "100", CommercialWorkTotal: "200", InsuranceTotalDecimal: "50"}, "350.00"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := mustCGT(t, tc.in)
			if out.RoundedTotalDecimal != tc.want {
				t.Fatalf("rounded = %q, want %q", out.RoundedTotalDecimal, tc.want)
			}
			// §16.17 — exact breakdown identities, recomputed in big.Rat.
			material := mustRat(t, tc.in.CommercialMaterialTotal)
			work := mustRat(t, tc.in.CommercialWorkTotal)
			insurance := mustRat(t, tc.in.InsuranceTotalDecimal)
			commercial := new(big.Rat).Add(material, work)
			before := new(big.Rat).Add(commercial, insurance) // insurance exactly once
			wantRounded := FormatMoney2Decimal(RoundMoney2Decimal(before))
			if out.RoundedTotalDecimal != wantRounded {
				t.Fatalf("rounded %q != independent decimal recompute %q", out.RoundedTotalDecimal, wantRounded)
			}
			if out.CommercialTotal != ratToFloat(commercial) {
				t.Fatal("commercial DTO float != material + work")
			}
			if out.BeforeRounding != ratToFloat(before) {
				t.Fatal("beforeRounding DTO float != commercial + insurance")
			}
		})
	}
}

// §7.2 — the CANONICAL rounding table (decimal half away from zero, matching
// PostgreSQL ROUND(numeric, 2)); half-cent cases MUST go up regardless of any
// float64 representation. Compared as decimal strings.
func TestCachedGrandTotal_RoundingBoundaries(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"0", "0.00"},
		{"0.004", "0.00"},
		{"0.005", "0.01"},
		{"0.006", "0.01"},
		{"1.004", "1.00"},
		{"1.005", "1.01"}, // red-history fixture: float64 impl produced 1.00
		{"1.006", "1.01"},
		{"1.015", "1.02"},
		{"2.675", "2.68"}, // float64(2.675) = 2.67499999999999982… — would round DOWN in binary
		{"0.305", "0.31"}, // float64(0.305) = 0.30499999999999999… — binary would give 0.30
		{"100.554", "100.55"},
		{"100.555", "100.56"},
		{"100.556", "100.56"},
		{"123456789012.34", "123456789012.34"},
		{"1.23456789", "1.23"},
		// §7 huge value (38 significant digits — exceeds float64 precision, exact here).
		{"99999999999999999999999999999999999.995", "100000000000000000000000000000000000.00"},
		{"12345678901234567890123456789.005", "12345678901234567890123456789.01"},
	}
	for _, tc := range cases {
		out := mustCGT(t, CachedTenderGrandTotalInput{CommercialMaterialTotal: "0", CommercialWorkTotal: tc.in, InsuranceTotalDecimal: "0"})
		if out.RoundedTotalDecimal != tc.want {
			t.Errorf("round(%s) = %s, want %s", tc.in, out.RoundedTotalDecimal, tc.want)
		}
	}
}

// §7.3 — multi-component aggregation reaching a half-cent boundary: the sum is
// exact BEFORE the single final rounding (0.1 + 0.2 + 0.005 has no binary
// representation; decimal arithmetic must yield exactly 0.305 → 0.31).
func TestCachedGrandTotal_HalfCentAggregates(t *testing.T) {
	cases := []struct {
		name string
		in   CachedTenderGrandTotalInput
		want string
	}{
		{"0.1+0.2+0.005", CachedTenderGrandTotalInput{
			CommercialMaterialTotal: "0.1", CommercialWorkTotal: "0.2", InsuranceTotalDecimal: "0.005"}, "0.31"},
		{"components sum to half cent", CachedTenderGrandTotalInput{
			CommercialMaterialTotal: "100.0025", CommercialWorkTotal: "200.0025", InsuranceTotalDecimal: "0"}, "300.01"},
		{"insurance half-cent boundary", CachedTenderGrandTotalInput{
			CommercialMaterialTotal: "1000", CommercialWorkTotal: "0", InsuranceTotalDecimal: "0.005"}, "1000.01"},
		{"commercial+insurance both half-cent", CachedTenderGrandTotalInput{
			CommercialMaterialTotal: "0.0025", CommercialWorkTotal: "0.0025", InsuranceTotalDecimal: "0.005"}, "0.01"},
		{"already rounded stays unchanged", CachedTenderGrandTotalInput{
			CommercialMaterialTotal: "1234.56", CommercialWorkTotal: "0.44", InsuranceTotalDecimal: "10.00"}, "1245.00"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out := mustCGT(t, tc.in)
			if out.RoundedTotalDecimal != tc.want {
				t.Fatalf("rounded = %q, want %q", out.RoundedTotalDecimal, tc.want)
			}
		})
	}
}

// §7.4 — already-2dp input passes through with zero adjustment.
func TestCachedGrandTotal_AlreadyRoundedUnchanged(t *testing.T) {
	out := mustCGT(t, CachedTenderGrandTotalInput{CommercialMaterialTotal: "0", CommercialWorkTotal: "1234.56", InsuranceTotalDecimal: "0"})
	if out.RoundedTotalDecimal != "1234.56" {
		t.Fatalf("rounded = %q, want unchanged 1234.56", out.RoundedTotalDecimal)
	}
	if out.RoundingAdjustment != 0 {
		t.Fatalf("adjustment = %v, want 0", out.RoundingAdjustment)
	}
}

// §16.8-12 / §7.5 — malformed inputs are typed errors, never a successful 0.
func TestCachedGrandTotal_MalformedInputs(t *testing.T) {
	huge := strings.Repeat("9", maxDecimalDigits+1)
	bad := []struct {
		name   string
		in     CachedTenderGrandTotalInput
		field  string
		reason string
	}{
		{"empty material is not a number", CachedTenderGrandTotalInput{CommercialWorkTotal: "1", CommercialMaterialTotal: ""}, "commercial_material_total", "MALFORMED_DECIMAL"},
		{"text", CachedTenderGrandTotalInput{CommercialMaterialTotal: "abc"}, "commercial_material_total", "MALFORMED_DECIMAL"},
		{"comma decimal", CachedTenderGrandTotalInput{CommercialWorkTotal: "1,05"}, "commercial_work_total", "MALFORMED_DECIMAL"},
		{"exponent", CachedTenderGrandTotalInput{CommercialWorkTotal: "1.2e3"}, "commercial_work_total", "MALFORMED_DECIMAL"},
		{"trailing dot", CachedTenderGrandTotalInput{InsuranceTotalDecimal: "1."}, "insurance_total", "MALFORMED_DECIMAL"},
		{"leading dot", CachedTenderGrandTotalInput{InsuranceTotalDecimal: ".5"}, "insurance_total", "MALFORMED_DECIMAL"},
		{"double dot", CachedTenderGrandTotalInput{InsuranceTotalDecimal: "1..2"}, "insurance_total", "MALFORMED_DECIMAL"},
		{"NaN string", CachedTenderGrandTotalInput{CommercialMaterialTotal: "NaN"}, "commercial_material_total", "MALFORMED_DECIMAL"},
		{"Infinity string", CachedTenderGrandTotalInput{CommercialWorkTotal: "Infinity"}, "commercial_work_total", "MALFORMED_DECIMAL"},
		{"rational form", CachedTenderGrandTotalInput{InsuranceTotalDecimal: "1/3"}, "insurance_total", "MALFORMED_DECIMAL"},
		{"negative material", CachedTenderGrandTotalInput{CommercialMaterialTotal: "-1"}, "commercial_material_total", "NEGATIVE_VALUE"},
		{"negative work", CachedTenderGrandTotalInput{CommercialWorkTotal: "-0.01"}, "commercial_work_total", "NEGATIVE_VALUE"},
		{"negative insurance", CachedTenderGrandTotalInput{InsuranceTotalDecimal: "-5"}, "insurance_total", "NEGATIVE_VALUE"},
		{"overflow material", CachedTenderGrandTotalInput{CommercialMaterialTotal: huge}, "commercial_material_total", "OVERFLOW"},
		{"overflow insurance", CachedTenderGrandTotalInput{InsuranceTotalDecimal: huge + ".99"}, "insurance_total", "OVERFLOW"},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			// Missing fields default to "" — make the untouched legs valid.
			in := tc.in
			if in.CommercialMaterialTotal == "" && tc.field != "commercial_material_total" {
				in.CommercialMaterialTotal = "0"
			}
			if in.CommercialWorkTotal == "" && tc.field != "commercial_work_total" {
				in.CommercialWorkTotal = "0"
			}
			if in.InsuranceTotalDecimal == "" && tc.field != "insurance_total" {
				in.InsuranceTotalDecimal = "0"
			}
			out, err := CalculateCachedTenderGrandTotal(in)
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

// Fail-closed: the kernel is strict — the repository always supplies explicit
// COALESCE(...,0)::text strings, so an empty string (including the zero-value
// Input) is a MALFORMED_DECIMAL typed error, never a silent 0.
func TestCachedGrandTotal_EmptyInputContract(t *testing.T) {
	var inErr *InvalidCachedGrandTotalInputError
	if _, err := CalculateCachedTenderGrandTotal(CachedTenderGrandTotalInput{}); !errors.As(err, &inErr) {
		t.Fatalf("zero-value input must be a typed error, got %v", err)
	}
	if _, err := CalculateCachedTenderGrandTotal(CachedTenderGrandTotalInput{CommercialMaterialTotal: "1"}); !errors.As(err, &inErr) {
		t.Fatalf("partially-empty input must be a typed error, got %v", err)
	}
}

// §7.6 — legacy float boundary: NaN/±Inf are typed NOT_FINITE errors (via
// floatToRat, the only float entry point into the decimal kernel).
func TestMoneyDecimal_FloatBoundaryNotFinite(t *testing.T) {
	for _, v := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		_, err := floatToRat("insurance_total", v)
		var mde *MoneyDecimalError
		if !errors.As(err, &mde) || mde.Reason != "NOT_FINITE" {
			t.Fatalf("floatToRat(%v): want NOT_FINITE MoneyDecimalError, got %v", v, err)
		}
	}
	if r, err := floatToRat("x", 2.5); err != nil || r.Cmp(big.NewRat(5, 2)) != 0 {
		t.Fatalf("floatToRat(2.5) = %v, %v; want exactly 5/2", r, err)
	}
}

// §7.7 — negative zero can never escape: formatting normalizes to "0.00".
func TestMoneyDecimal_NegativeZeroNormalized(t *testing.T) {
	r := RoundMoney2Decimal(big.NewRat(-4, 1000)) // -0.004 → -0.00
	if got := FormatMoney2Decimal(r); got != "0.00" {
		t.Fatalf("format(round(-0.004)) = %q, want 0.00", got)
	}
	if got := FormatMoney2Decimal(new(big.Rat).Neg(new(big.Rat))); got != "0.00" {
		t.Fatalf("format(-0) = %q, want 0.00", got)
	}
	// Negative money still formats with a sign when non-zero (kernel-level;
	// the cached-total inputs themselves are validated non-negative).
	if got := FormatMoney2Decimal(RoundMoney2Decimal(big.NewRat(-1005, 1000))); got != "-1.01" {
		t.Fatalf("format(round(-1.005)) = %q, want -1.01 (half away from zero)", got)
	}
}

// §16.15/16 / §7.8 — determinism: identical decimal string on repeated runs;
// input never mutated.
func TestCachedGrandTotal_DeterministicAndImmutable(t *testing.T) {
	in := CachedTenderGrandTotalInput{CommercialMaterialTotal: "100.33", CommercialWorkTotal: "200.44", InsuranceTotalDecimal: "50.55"}
	snapshot := in
	out1 := mustCGT(t, in)
	out2 := mustCGT(t, in)
	if out1.RoundedTotalDecimal != out2.RoundedTotalDecimal {
		t.Fatal("repeat calculation produced a different decimal string")
	}
	if *out1 != *out2 {
		t.Fatal("repeat calculation not deterministic")
	}
	if in != snapshot {
		t.Fatal("input was mutated")
	}
}

// §7.9 — permutation invariance: material↔work swap cannot change the total
// (the two commercial legs are symmetric in the formula).
func TestCachedGrandTotal_PermutationInvariance(t *testing.T) {
	a := mustCGT(t, CachedTenderGrandTotalInput{CommercialMaterialTotal: "123.4567", CommercialWorkTotal: "0.0483", InsuranceTotalDecimal: "9.995"})
	b := mustCGT(t, CachedTenderGrandTotalInput{CommercialMaterialTotal: "0.0483", CommercialWorkTotal: "123.4567", InsuranceTotalDecimal: "9.995"})
	if a.RoundedTotalDecimal != b.RoundedTotalDecimal {
		t.Fatalf("material/work permutation changed total: %q vs %q", a.RoundedTotalDecimal, b.RoundedTotalDecimal)
	}
}

var canonicalMoneyRe = regexp.MustCompile(`^[0-9]+\.[0-9]{2}$`)

// lcgDecimal — deterministic pseudo-random decimal string with `scale` digits
// after the point (exact decimal test inputs; no float64 involved).
func lcgDecimal(seed *uint64, scale int) string {
	*seed = *seed*6364136223846793005 + 1442695040888963407
	units := (*seed >> 33) % 1_000_000_000
	if scale == 0 {
		return new(big.Int).SetUint64(units).String()
	}
	r := new(big.Rat).SetFrac(new(big.Int).SetUint64(units), new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(scale)), nil))
	return r.FloatString(scale)
}

// §16 property/fuzz (§7.10) — deterministic LCG over exact decimal inputs:
// canonical output format, exact recompute identity, |adjustment| ≤ half a
// kopeck (in exact arithmetic), permutation invariance. No float assertions.
func TestCachedGrandTotal_Properties(t *testing.T) {
	seed := uint64(12345)
	halfCent := big.NewRat(1, 200)
	for i := 0; i < 500; i++ {
		material := lcgDecimal(&seed, int(seed>>60)%5)
		work := lcgDecimal(&seed, int(seed>>59)%5)
		insurance := lcgDecimal(&seed, int(seed>>58)%7)
		in := CachedTenderGrandTotalInput{
			CommercialMaterialTotal: material,
			CommercialWorkTotal:     work,
			InsuranceTotalDecimal:   insurance,
		}
		out := mustCGT(t, in)
		if !canonicalMoneyRe.MatchString(out.RoundedTotalDecimal) {
			t.Fatalf("non-canonical decimal %q for %+v", out.RoundedTotalDecimal, in)
		}
		// Exact identity: kernel result == independent big.Rat recompute.
		before := new(big.Rat).Add(new(big.Rat).Add(mustRat(t, material), mustRat(t, work)), mustRat(t, insurance))
		rounded := RoundMoney2Decimal(before)
		if want := FormatMoney2Decimal(rounded); out.RoundedTotalDecimal != want {
			t.Fatalf("kernel %q != recompute %q for %+v", out.RoundedTotalDecimal, want, in)
		}
		// |rounded - before| ≤ 1/200 exactly.
		diff := new(big.Rat).Sub(rounded, before)
		if diff.Abs(diff).Cmp(halfCent) > 0 {
			t.Fatalf("rounding moved more than half a kopeck: %+v", in)
		}
		// Permutation invariance.
		swapped := mustCGT(t, CachedTenderGrandTotalInput{
			CommercialMaterialTotal: work,
			CommercialWorkTotal:     material,
			InsuranceTotalDecimal:   insurance,
		})
		if swapped.RoundedTotalDecimal != out.RoundedTotalDecimal {
			t.Fatalf("permutation changed total for %+v", in)
		}
	}
}
