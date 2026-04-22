package calc

import (
	"math"
	"testing"
)

// With zero coefficients, grandTotal == directCostsTotal (pass-through).
func TestCalculateGrandTotal_ZeroCoefficients(t *testing.T) {
	d := DirectCosts{
		Works: 1000, Materials: 500,
		SubcontractWorks: 200, SubcontractMaterials: 100,
	}
	c := MarkupCoefficients{}
	b := CalculateGrandTotal(d, c)
	if b.DirectCostsTotal != 1800 {
		t.Errorf("directCostsTotal: got %v, want 1800", b.DirectCostsTotal)
	}
	if b.GrandTotal != 1800 {
		t.Errorf("grandTotal with 0 coefficients: got %v, want 1800", b.GrandTotal)
	}
}

// Just mechanization on works.
func TestCalculateGrandTotal_MechanizationOnly(t *testing.T) {
	d := DirectCosts{Works: 1000}
	c := MarkupCoefficients{Mechanization: 10}
	b := CalculateGrandTotal(d, c)
	// mechanizationCost = 1000 * 0.10 = 100.
	// GrandTotal = directCosts + mechanizationCost = 1000 + 100 = 1100.
	if b.MechanizationCost != 100 {
		t.Errorf("mech: got %v, want 100", b.MechanizationCost)
	}
	if b.GrandTotal != 1100 {
		t.Errorf("grandTotal: got %v, want 1100", b.GrandTotal)
	}
}

// Coefficient06 uses base = worksSu10 + mechanizationCost.
func TestCalculateGrandTotal_Coefficient06Chain(t *testing.T) {
	d := DirectCosts{Works: 1000}
	c := MarkupCoefficients{Mechanization: 10, Coefficient06: 60}
	b := CalculateGrandTotal(d, c)
	// mech = 100, coeff06Cost = (1000 + 100) * 0.6 = 660.
	if math.Abs(b.MechanizationCost-100) > 1e-6 {
		t.Errorf("mech: got %v", b.MechanizationCost)
	}
	if math.Abs(b.Coefficient06Cost-660) > 1e-6 {
		t.Errorf("coeff06: got %v, want 660", b.Coefficient06Cost)
	}
}

// Full realistic chain: works 1000, materials 500, mechanization 10, coeff06 60,
// mvp 5, warranty 3, worksCostGrowth 5, materialCostGrowth 3, unforeseeable 2,
// overheadOwnForces 15, generalCosts 4, profitOwnForces 8.
func TestCalculateGrandTotal_FullChain(t *testing.T) {
	d := DirectCosts{Works: 1000, Materials: 500}
	c := MarkupCoefficients{
		Mechanization: 10, Coefficient06: 60, MvpGsm: 5, Warranty: 3,
		WorksCostGrowth: 5, MaterialCostGrowth: 3, Unforeseeable: 2,
		OverheadOwnForces: 15, GeneralCosts: 4, ProfitOwnForces: 8,
	}
	b := CalculateGrandTotal(d, c)
	// Known-good values recomputed by hand:
	// mechanizationCost = 1000 * 0.10 = 100
	// coefficient06Cost = (1000+100) * 0.6 = 660
	// mvpGsmCost = 1000 * 0.05 = 50
	// warrantyCost = 1000 * 0.03 = 30
	// worksWithMarkup = 1000 + 660 + 50 + 100 = 1810
	// worksCostGrowth = 1810 * 0.05 = 90.5
	// materialCostGrowth = 500 * 0.03 = 15
	// totalCostGrowth = 90.5 + 15 = 105.5 (no subcontract)
	// baseForUnforeseeable = 1000 + 660 + 500 + 50 + 100 = 2310
	// unforeseeable = 2310 * 0.02 = 46.2
	// baseForOOZ = 2310 + 90.5 + 15 + 46.2 = 2461.7
	// overheadOwnForces = 2461.7 * 0.15 = 369.255
	// baseForOFZ = 2461.7 + 369.255 = 2830.955
	// generalCosts = 2830.955 * 0.04 = 113.2382
	// baseForProfit = 2830.955 + 113.2382 = 2944.1932
	// profitOwnForces = 2944.1932 * 0.08 = 235.535456
	//
	// directCostsTotal = 1500 (no subcontract, no composite types)
	// grandTotal = 1500 + mech 100 + mvp 50 + warr 30 + coeff06 660
	//            + totalCostGrowth 105.5 + unforeseeable 46.2
	//            + ooz 369.255 + ofz 113.2382 + profit 235.535456 = 3209.728656
	want := 3209.728656
	if math.Abs(b.GrandTotal-want) > 1e-3 {
		t.Errorf("grandTotal: got %v, want %v", b.GrandTotal, want)
	}
	if math.Abs(b.WorksWithMarkup-1810) > 1e-6 {
		t.Errorf("worksWithMarkup: got %v, want 1810", b.WorksWithMarkup)
	}
	if math.Abs(b.BaseForOOZ-2461.7) > 1e-3 {
		t.Errorf("baseForOOZ: got %v, want 2461.7", b.BaseForOOZ)
	}
}

// Subcontract-specific chain: subcontract works + subcontract OOZ + profit.
func TestCalculateGrandTotal_SubcontractChain(t *testing.T) {
	d := DirectCosts{
		SubcontractWorks: 1000, SubcontractMaterials: 500,
		SubcontractWorksForGrowth: 1000, SubcontractMaterialsForGrowth: 500,
	}
	c := MarkupCoefficients{
		SubcontractWorksCostGrowth: 10, SubcontractMaterialsCostGrowth: 5,
		OverheadSubcontract: 20, ProfitSubcontract: 10,
	}
	b := CalculateGrandTotal(d, c)
	// subWorksGrowth = 1000 * 0.10 = 100
	// subMatGrowth = 500 * 0.05 = 25
	// subcontractGrowth = 125
	// baseForSubOOZ = (1000+500) + 125 = 1625
	// overheadSubcontract = 1625 * 0.20 = 325
	// baseForSubProfit = 1625 + 325 = 1950
	// profitSubcontract = 1950 * 0.10 = 195
	// grandTotal = directCosts 1500 + totalCostGrowth 125 + overheadSubcontract 325 + profitSubcontract 195 = 2145
	if math.Abs(b.SubcontractGrowth-125) > 1e-6 {
		t.Errorf("subGrowth: got %v", b.SubcontractGrowth)
	}
	if math.Abs(b.OverheadSubcontractCost-325) > 1e-6 {
		t.Errorf("subOOZ: got %v", b.OverheadSubcontractCost)
	}
	if math.Abs(b.GrandTotal-2145) > 1e-6 {
		t.Errorf("grandTotal: got %v, want 2145", b.GrandTotal)
	}
}

// Composite types (мат-комп. / раб-комп.) count as direct costs but don't
// participate in any markup chain.
func TestCalculateGrandTotal_CompositeTypes(t *testing.T) {
	d := DirectCosts{WorksComp: 100, MaterialsComp: 200}
	c := MarkupCoefficients{Mechanization: 10}
	b := CalculateGrandTotal(d, c)
	// Mechanization applies only to d.Works (=0 here), so mech = 0.
	if b.MechanizationCost != 0 {
		t.Errorf("composite types should NOT feed mechanization: got %v", b.MechanizationCost)
	}
	if b.GrandTotal != 300 {
		t.Errorf("grandTotal = directCostsTotal: got %v, want 300", b.GrandTotal)
	}
}
