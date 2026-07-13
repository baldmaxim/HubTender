package repository

import "github.com/su10/hubtender/backend/internal/calc"

// Mappers from stored rows into the authoritative calc kernel's input shapes.
// They live here (not in services) so BOTH the public recalc AND the
// in-transaction copy / transfer paths use exactly one implementation.

// ToCalcExclusions converts subcontract-growth exclusion rows into calc's shape.
func ToCalcExclusions(rows []SubcontractExclusionRow) *calc.SubcontractExclusions {
	ex := &calc.SubcontractExclusions{Works: map[string]bool{}, Materials: map[string]bool{}}
	for _, r := range rows {
		switch r.ExclusionType {
		case "works":
			ex.Works[r.DetailCostCategoryID] = true
		case "materials":
			ex.Materials[r.DetailCostCategoryID] = true
		}
	}
	return ex
}

// ToCalcPricingDistribution converts the stored pricing-distribution row into
// calc's shape. nil in → nil out (calc then applies its default split).
func ToCalcPricingDistribution(r *PricingDistributionRow) *calc.PricingDistribution {
	if r == nil {
		return nil
	}
	d := func(s string) calc.DistTarget { return calc.DistTarget(s) }
	return &calc.PricingDistribution{
		BasicMaterialBaseTarget:                  d(r.BasicMaterialBaseTarget),
		BasicMaterialMarkupTarget:                d(r.BasicMaterialMarkupTarget),
		AuxiliaryMaterialBaseTarget:              d(r.AuxiliaryMaterialBaseTarget),
		AuxiliaryMaterialMarkupTarget:            d(r.AuxiliaryMaterialMarkupTarget),
		ComponentMaterialBaseTarget:              d(r.ComponentMaterialBaseTarget),
		ComponentMaterialMarkupTarget:            d(r.ComponentMaterialMarkupTarget),
		SubcontractBasicMaterialBaseTarget:       d(r.SubcontractBasicMaterialBaseTarget),
		SubcontractBasicMaterialMarkupTarget:     d(r.SubcontractBasicMaterialMarkupTarget),
		SubcontractAuxiliaryMaterialBaseTarget:   d(r.SubcontractAuxiliaryMaterialBaseTarget),
		SubcontractAuxiliaryMaterialMarkupTarget: d(r.SubcontractAuxiliaryMaterialMarkupTarget),
		WorkBaseTarget:                           d(r.WorkBaseTarget),
		WorkMarkupTarget:                         d(r.WorkMarkupTarget),
		ComponentWorkBaseTarget:                  d(r.ComponentWorkBaseTarget),
		ComponentWorkMarkupTarget:                d(r.ComponentWorkMarkupTarget),
	}
}

// BuildMarkupParamsMap mirrors loadMarkupParameters in
// src/services/markupTactic/parameters.ts: key → value, falling back to the
// hardcoded defaults when the tender has no percentage rows.
func BuildMarkupParamsMap(rows []TenderMarkupPctRow) map[string]float64 {
	m := make(map[string]float64, len(rows))
	for _, r := range rows {
		if r.MarkupParameter != nil && r.MarkupParameter.Key != "" {
			m[r.MarkupParameter.Key] = r.Value
		}
	}
	if len(m) == 0 {
		return FallbackMarkupParams()
	}
	return m
}

// FallbackMarkupParams is a 1:1 port of getFallbackParameters().
func FallbackMarkupParams() map[string]float64 {
	return map[string]float64{
		"mechanization_service":             5,
		"mbp_gsm":                           5,
		"warranty_period":                   5,
		"works_16_markup":                   60,
		"works_cost_growth":                 10,
		"material_cost_growth":              10,
		"subcontract_works_cost_growth":     10,
		"subcontract_materials_cost_growth": 10,
		"contingency_costs":                 3,
		"overhead_own_forces":               10,
		"overhead_subcontract":              10,
		"general_costs_without_subcontract": 20,
		"profit_own_forces":                 10,
		"profit_subcontract":                16,
	}
}
