// Stage 0.1.2.4a: the ONE canonical formula of tenders.cached_grand_total.
//
// Semantics (confirmed against the legacy SQL/Go twins and the UI):
//
//		cached_grand_total =
//		    round2( Σ(total_commercial_material_cost + total_commercial_work_cost)
//		            + current tender insurance total )
//
//	  - inputs are the MATERIALIZED server-generated commercial values;
//	  - insurance is added exactly once (calc.CalculateInsuranceTotal — the same
//	    kernel the prepared pipeline uses);
//	  - redistribution prepared values / position adjustments are NOT part of
//	    this total; markup/VAT are already inside the materialized commercial
//	    values and are never re-applied here;
//	  - rounding happens exactly once, at the end (round2 — half away from zero
//	    on the *100 scale, mirroring the legacy PostgreSQL ROUND(numeric, 2)
//	    within float64 representation limits; см. ограничение ниже);
//	  - the value is the LAST successfully materialized commercial total, not a
//	    historical calculation snapshot (input_revision — этап 0.1.3).
//
// Float64 limitation (документированное): значения вроде 100.555 не имеют
// точного float64-представления, поэтому byte-exact эквивалентность
// PostgreSQL-numeric на таких границах не гарантируется и не заявляется;
// единая Go-policy (round2) применяется ко всем новым production paths, parity
// с persisted значением закрепляется integration-тестами.
package calc

import "fmt"

// CachedTenderGrandTotalInput — normalized, server-aggregated inputs.
type CachedTenderGrandTotalInput struct {
	CommercialMaterialTotal float64
	CommercialWorkTotal     float64
	InsuranceTotal          float64
}

// CachedTenderGrandTotalResult — the total plus a traceable breakdown.
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
}

// InvalidCachedGrandTotalInputError — a malformed aggregated input. Inputs come
// from materialized server data, so this is an internal calculation error —
// never a client's "fix your JSON" and never a silent total=0 fallback.
type InvalidCachedGrandTotalInputError struct {
	Field  string
	Value  float64
	Reason string // NOT_FINITE | NEGATIVE_VALUE
}

func (e *InvalidCachedGrandTotalInputError) Error() string {
	return fmt.Sprintf("INVALID_CACHED_GRAND_TOTAL_INPUT: %s (%s=%v)", e.Reason, e.Field, e.Value)
}

// CalculateCachedTenderGrandTotal is the ONLY place the cached_grand_total
// formula exists. Pure: no DB, no HTTP DTO, deterministic, does not mutate the
// input, order-independent (inputs are already aggregated sums).
//
// NOTE: this is NOT calc.CalculateGrandTotal — that legacy function is the
// Financial-Indicators formula breakdown (отдельный путь, этап 0.1.2.4b).
func CalculateCachedTenderGrandTotal(in CachedTenderGrandTotalInput) (*CachedTenderGrandTotalResult, error) {
	for _, f := range []struct {
		name string
		val  float64
	}{
		{"commercial_material_total", in.CommercialMaterialTotal},
		{"commercial_work_total", in.CommercialWorkTotal},
		{"insurance_total", in.InsuranceTotal},
	} {
		if !isFinite(f.val) {
			return nil, &InvalidCachedGrandTotalInputError{Field: f.name, Value: f.val, Reason: "NOT_FINITE"}
		}
		if f.val < 0 {
			return nil, &InvalidCachedGrandTotalInputError{Field: f.name, Value: f.val, Reason: "NEGATIVE_VALUE"}
		}
	}

	commercial := in.CommercialMaterialTotal + in.CommercialWorkTotal
	before := commercial + in.InsuranceTotal // insurance exactly once
	rounded := round2(before)                // rounding exactly once

	return &CachedTenderGrandTotalResult{
		CommercialMaterialTotal: in.CommercialMaterialTotal,
		CommercialWorkTotal:     in.CommercialWorkTotal,
		CommercialTotal:         commercial,
		InsuranceTotal:          in.InsuranceTotal,
		BeforeRounding:          before,
		RoundedTotal:            rounded,
		RoundingAdjustment:      rounded - before,
	}, nil
}
