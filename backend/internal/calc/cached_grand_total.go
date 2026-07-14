// Stage 0.1.2.4a / 0.1.2.4a.1: the ONE canonical formula of
// tenders.cached_grand_total — now DECIMAL-EXACT.
//
// Semantics (confirmed against the legacy SQL/Go twins and the UI):
//
//		cached_grand_total =
//		    round2dec( Σ(total_commercial_material_cost + total_commercial_work_cost)
//		               + current tender insurance total )
//
//	  - inputs are the MATERIALIZED server-generated commercial values, read from
//	    PostgreSQL NUMERIC as EXACT decimal strings (::text) — float64 is NOT an
//	    authoritative money representation on this path;
//	  - insurance is added exactly once (the shared insuranceTotalRat kernel —
//	    the same formula the float compatibility API delegates to);
//	  - redistribution prepared values / position adjustments are NOT part of
//	    this total; markup/VAT are already inside the materialized commercial
//	    values and are never re-applied here;
//	  - rounding happens exactly once, at the end: DECIMAL half away from zero
//	    (RoundMoney2Decimal): 1.005 → 1.01, 2.675 → 2.68, 100.555 → 100.56 —
//	    matching PostgreSQL ROUND(numeric, 2); no binary math.Round shortcut,
//	    no epsilon;
//	  - the persisted value is the canonical decimal string
//	    (Result.RoundedTotalDecimal); float64 fields on the Result exist ONLY
//	    for JSON/DTO compatibility and are derived AFTER the final rounding;
//	  - the value is the LAST successfully materialized commercial total, not a
//	    historical calculation snapshot (input_revision — этап 0.1.3).
package calc

import (
	"fmt"
	"math/big"
)

// CachedTenderGrandTotalInput — normalized, server-aggregated inputs in EXACT
// decimal form: commercial totals as numeric::text strings, insurance as the
// exact rational produced by CalculateInsuranceTotalDecimal.
type CachedTenderGrandTotalInput struct {
	CommercialMaterialTotal string
	CommercialWorkTotal     string
	// InsuranceTotalDecimal — exact decimal string of the insurance total
	// ("0" when the tender has no insurance row). Kept as a string so the
	// input stays plain data; parsed exactly, never through float64.
	InsuranceTotalDecimal string
}

// CachedTenderGrandTotalResult — the total plus a traceable breakdown.
// RoundedTotalDecimal is the AUTHORITATIVE value (bound into the NUMERIC
// column as-is); the float64 fields are derived for DTO/JSON compatibility
// after the exact arithmetic and final rounding.
// Server-generated calculation result. Must never be populated from an HTTP
// request.
type CachedTenderGrandTotalResult struct {
	CommercialMaterialTotal float64
	CommercialWorkTotal     float64
	CommercialTotal         float64
	InsuranceTotal          float64
	BeforeRounding          float64
	RoundedTotal            float64
	RoundingAdjustment      float64
	// RoundedTotalDecimal — canonical "1234.56" decimal string (exact).
	RoundedTotalDecimal string
}

// InvalidCachedGrandTotalInputError — a malformed aggregated input. Inputs come
// from materialized server data, so this is an internal calculation error —
// never a client's "fix your JSON" and never a silent total=0 fallback.
type InvalidCachedGrandTotalInputError struct {
	Field  string
	Value  string
	Reason string // MALFORMED_DECIMAL | NEGATIVE_VALUE | NOT_FINITE | OVERFLOW
}

func (e *InvalidCachedGrandTotalInputError) Error() string {
	return fmt.Sprintf("INVALID_CACHED_GRAND_TOTAL_INPUT: %s (%s=%q)", e.Reason, e.Field, e.Value)
}

// CalculateCachedTenderGrandTotal is the ONLY place the cached_grand_total
// formula exists. Pure and decimal-exact: no DB, no HTTP DTO, deterministic,
// order-independent (inputs are already aggregated sums), no float64 on the
// authoritative arithmetic path.
//
// NOTE: this is NOT calc.CalculateGrandTotal — that legacy function is the
// Financial-Indicators formula breakdown (отдельный путь, этап 0.1.2.4b).
func CalculateCachedTenderGrandTotal(in CachedTenderGrandTotalInput) (*CachedTenderGrandTotalResult, error) {
	material, err := parseTotalInput("commercial_material_total", in.CommercialMaterialTotal)
	if err != nil {
		return nil, err
	}
	work, err := parseTotalInput("commercial_work_total", in.CommercialWorkTotal)
	if err != nil {
		return nil, err
	}
	insurance, err := parseTotalInput("insurance_total", in.InsuranceTotalDecimal)
	if err != nil {
		return nil, err
	}

	commercial := new(big.Rat).Add(material, work)
	before := new(big.Rat).Add(commercial, insurance) // insurance exactly once
	rounded := RoundMoney2Decimal(before)             // rounding exactly once, decimal half away from zero
	adjustment := new(big.Rat).Sub(rounded, before)

	return &CachedTenderGrandTotalResult{
		CommercialMaterialTotal: ratToFloat(material),
		CommercialWorkTotal:     ratToFloat(work),
		CommercialTotal:         ratToFloat(commercial),
		InsuranceTotal:          ratToFloat(insurance),
		BeforeRounding:          ratToFloat(before),
		RoundedTotal:            ratToFloat(rounded),
		RoundingAdjustment:      ratToFloat(adjustment),
		RoundedTotalDecimal:     FormatMoney2Decimal(rounded),
	}, nil
}

// parseTotalInput maps decimal-parse failures onto the established typed error.
func parseTotalInput(field, s string) (*big.Rat, error) {
	v, perr := parseNonNegativeDecimalRat(field, s)
	if perr != nil {
		var mde *MoneyDecimalError
		if asMoneyErr(perr, &mde) {
			return nil, &InvalidCachedGrandTotalInputError{Field: mde.Field, Value: mde.Value, Reason: mde.Reason}
		}
		return nil, perr
	}
	return v, nil
}
