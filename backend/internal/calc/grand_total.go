// Port of the pure math portion of src/utils/calculateGrandTotal.ts.
// DB reads (tender, markup parameters, boq items, exclusions) live in the
// handler/service layer; this package only computes the final number given
// already-aggregated inputs. Stay 1:1 with the TS arithmetic; any drift is
// a cutover blocker.
package calc

// DirectCosts is the sum of boq_items.total_amount per boq_item_type,
// computed in the service layer (SELECT ... GROUP BY boq_item_type).
// Aligns with the forEach loop in calculateGrandTotal.ts lines 74-105.
type DirectCosts struct {
	Works                      float64 // 'раб'
	Materials                  float64 // 'мат'
	SubcontractWorks           float64 // 'суб-раб'
	SubcontractMaterials       float64 // 'суб-мат'
	WorksComp                  float64 // 'раб-комп.'
	MaterialsComp              float64 // 'мат-комп.'
	SubcontractWorksForGrowth  float64 // 'суб-раб' excluding growth-exempt categories
	SubcontractMaterialsForGrowth float64 // 'суб-мат' excluding growth-exempt categories
}

// MarkupCoefficients holds all 13 per-tender markup percentages (values 0-100).
// Naming matches the TS variable names; caller resolves each from markup_parameters
// by label/key substring match (kept in the service layer — this package doesn't
// care how coefficients were picked).
type MarkupCoefficients struct {
	Mechanization              float64 // "механизация" / "буринц"
	MvpGsm                     float64 // "мвп" / "гсм"
	Warranty                   float64 // "гаранти*"
	Coefficient06              float64 // "0.6" / "1.6" / works_16 / works_markup
	WorksCostGrowth            float64 // "рост * работ*" (not subcontract)
	MaterialCostGrowth         float64 // "рост * материал*" (not subcontract)
	SubcontractWorksCostGrowth    float64 // "рост * работ* * субподряд"
	SubcontractMaterialsCostGrowth float64 // "рост * материал* * субподряд"
	OverheadOwnForces          float64 // "ооз" (not subcontract)
	OverheadSubcontract        float64 // "ооз * субподряд"
	GeneralCosts               float64 // "офз" / "общ.*затрат*"
	ProfitOwnForces            float64 // "прибыль" (not subcontract)
	ProfitSubcontract          float64 // "прибыль * субподряд"
	Unforeseeable              float64 // "непредвид*"
}

// GrandTotalBreakdown mirrors every intermediate amount that calculateGrandTotal.ts
// computes. Exposed so dual-run can diff any component, not just the final sum.
type GrandTotalBreakdown struct {
	SubcontractTotal      float64
	Su10Total             float64
	DirectCostsTotal      float64
	MechanizationCost     float64
	Coefficient06Cost     float64
	MvpGsmCost            float64
	WarrantyCost          float64
	WorksWithMarkup       float64
	WorksCostGrowthAmount float64
	MaterialCostGrowthAmount float64
	SubcontractWorksCostGrowthAmount    float64
	SubcontractMaterialsCostGrowthAmount float64
	TotalCostGrowth       float64
	BaseForUnforeseeable  float64
	UnforeseeableCost     float64
	BaseForOOZ            float64
	OverheadOwnForcesCost float64
	SubcontractGrowth     float64
	BaseForSubcontractOOZ float64
	OverheadSubcontractCost float64
	BaseForOFZ            float64
	GeneralCostsCost      float64
	BaseForProfit         float64
	ProfitOwnForcesCost   float64
	BaseForSubcontractProfit float64
	ProfitSubcontractCost float64
	GrandTotal            float64
}

// CalculateGrandTotal takes already-aggregated inputs and returns the tender's
// commercial grand total along with every intermediate subtotal.
//
// The formula mirrors calculateGrandTotal.ts lines 259-306 EXACTLY:
//   worksSu10Only     = works
//   mechanizationCost = worksSu10Only * mechanization / 100
//   coefficient06Cost = (worksSu10Only + mechanizationCost) * coeff06 / 100
//   mvpGsmCost        = worksSu10Only * mvpGsm / 100
//   warrantyCost      = worksSu10Only * warranty / 100
//   ...and so on through all 13 cost components.
func CalculateGrandTotal(d DirectCosts, c MarkupCoefficients) GrandTotalBreakdown {
	b := GrandTotalBreakdown{}

	b.SubcontractTotal = d.SubcontractWorks + d.SubcontractMaterials
	b.Su10Total = d.Works + d.Materials + d.MaterialsComp + d.WorksComp
	b.DirectCostsTotal = b.SubcontractTotal + b.Su10Total

	worksSu10 := d.Works
	b.MechanizationCost = worksSu10 * (c.Mechanization / 100)
	b.Coefficient06Cost = (worksSu10 + b.MechanizationCost) * (c.Coefficient06 / 100)
	b.MvpGsmCost = worksSu10 * (c.MvpGsm / 100)
	b.WarrantyCost = worksSu10 * (c.Warranty / 100)

	b.WorksWithMarkup = worksSu10 + b.Coefficient06Cost + b.MvpGsmCost + b.MechanizationCost
	b.WorksCostGrowthAmount = b.WorksWithMarkup * (c.WorksCostGrowth / 100)
	b.MaterialCostGrowthAmount = d.Materials * (c.MaterialCostGrowth / 100)
	b.SubcontractWorksCostGrowthAmount = d.SubcontractWorksForGrowth * (c.SubcontractWorksCostGrowth / 100)
	b.SubcontractMaterialsCostGrowthAmount = d.SubcontractMaterialsForGrowth * (c.SubcontractMaterialsCostGrowth / 100)

	b.TotalCostGrowth = b.WorksCostGrowthAmount +
		b.MaterialCostGrowthAmount +
		b.SubcontractWorksCostGrowthAmount +
		b.SubcontractMaterialsCostGrowthAmount

	b.BaseForUnforeseeable = worksSu10 + b.Coefficient06Cost + d.Materials + b.MvpGsmCost + b.MechanizationCost
	b.UnforeseeableCost = b.BaseForUnforeseeable * (c.Unforeseeable / 100)

	b.BaseForOOZ = b.BaseForUnforeseeable + b.WorksCostGrowthAmount + b.MaterialCostGrowthAmount + b.UnforeseeableCost
	b.OverheadOwnForcesCost = b.BaseForOOZ * (c.OverheadOwnForces / 100)

	b.SubcontractGrowth = b.SubcontractWorksCostGrowthAmount + b.SubcontractMaterialsCostGrowthAmount
	b.BaseForSubcontractOOZ = b.SubcontractTotal + b.SubcontractGrowth
	b.OverheadSubcontractCost = b.BaseForSubcontractOOZ * (c.OverheadSubcontract / 100)

	b.BaseForOFZ = b.BaseForOOZ + b.OverheadOwnForcesCost
	b.GeneralCostsCost = b.BaseForOFZ * (c.GeneralCosts / 100)

	b.BaseForProfit = b.BaseForOFZ + b.GeneralCostsCost
	b.ProfitOwnForcesCost = b.BaseForProfit * (c.ProfitOwnForces / 100)

	b.BaseForSubcontractProfit = b.BaseForSubcontractOOZ + b.OverheadSubcontractCost
	b.ProfitSubcontractCost = b.BaseForSubcontractProfit * (c.ProfitSubcontract / 100)

	b.GrandTotal = b.DirectCostsTotal +
		b.MechanizationCost +
		b.MvpGsmCost +
		b.WarrantyCost +
		b.Coefficient06Cost +
		b.TotalCostGrowth +
		b.UnforeseeableCost +
		b.OverheadOwnForcesCost +
		b.OverheadSubcontractCost +
		b.GeneralCostsCost +
		b.ProfitOwnForcesCost +
		b.ProfitSubcontractCost

	return b
}
