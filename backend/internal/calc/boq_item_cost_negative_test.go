package calc

import "testing"

// Антисимметрия: коммерция линейна по base, поэтому строка с отрицательной
// суммой (отрицательная цена) даёт зеркальные материалы/работы, а коэффициент
// наценки не зависит от знака и неотрицателен.
func TestCalculateBoqItemCost_NegativeBaseAntisymmetry(t *testing.T) {
	itemTypes := []string{BoqRab, BoqSubRab, BoqRabKomp, BoqMat, BoqSubMat, BoqMatKomp}
	materialTypes := []string{"основн.", "вспомогат."}

	// Нестандартное распределение: база → работы, наценка → материалы
	// (зеркально дефолту), чтобы пройти и другие ветки ApplyPricingDistribution.
	swapped := &PricingDistribution{
		BasicMaterialBaseTarget: TargetWork, BasicMaterialMarkupTarget: TargetMaterial,
		AuxiliaryMaterialBaseTarget: TargetWork, AuxiliaryMaterialMarkupTarget: TargetMaterial,
		ComponentMaterialBaseTarget: TargetWork, ComponentMaterialMarkupTarget: TargetMaterial,
		SubcontractBasicMaterialBaseTarget: TargetWork, SubcontractBasicMaterialMarkupTarget: TargetMaterial,
		SubcontractAuxiliaryMaterialBaseTarget: TargetWork, SubcontractAuxiliaryMaterialMarkupTarget: TargetMaterial,
		WorkBaseTarget: TargetWork, WorkMarkupTarget: TargetMaterial,
		ComponentWorkBaseTarget: TargetWork, ComponentWorkMarkupTarget: TargetMaterial,
	}
	distributions := map[string]*PricingDistribution{
		"без распределения (дефолт)": nil,
		"с распределением КП":        swapped,
	}

	vatStep := SequenceStep{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "nds_22", Operand1MultiplyFormat: "addOne"}
	vatModes := map[string]struct {
		seq    []SequenceStep
		params map[string]float64
	}{
		"без НДС": {[]SequenceStep{numStep(1.2)}, map[string]float64{}},
		"с НДС":   {[]SequenceStep{numStep(1.2), vatStep}, map[string]float64{"nds_22": 22}},
	}

	const base = 1234.56

	for vatName, vm := range vatModes {
		for distName, dist := range distributions {
			for _, it := range itemTypes {
				for _, mt := range materialTypes {
					name := vatName + "/" + distName + "/" + it + "/" + mt
					t.Run(name, func(t *testing.T) {
						seqs := map[string][]SequenceStep{it: vm.seq}
						calc := func(amount float64) BoqItemCostResult {
							res, ok := CalculateBoqItemCost(
								BoqItemForCost{BoqItemType: it, MaterialType: mt, TotalAmount: amount},
								seqs, nil, vm.params, dist, nil, map[string]float64{})
							if !ok {
								t.Fatalf("ok=false при base=%v", amount)
							}
							return res
						}
						pos, neg := calc(base), calc(-base)

						// Без этого равенства выполнялись бы на нулях и ничего не доказывали.
						if approx(pos.MaterialCost+pos.WorkCost, 0) {
							t.Fatalf("положительная строка дала нулевую коммерцию: %+v", pos)
						}
						if approx(neg.MaterialCost+neg.WorkCost, 0) {
							t.Fatalf("отрицательная строка дала нулевую коммерцию: %+v", neg)
						}
						if !approx(neg.MaterialCost, -pos.MaterialCost) {
							t.Errorf("MaterialCost(-base)=%v, want %v", neg.MaterialCost, -pos.MaterialCost)
						}
						if !approx(neg.WorkCost, -pos.WorkCost) {
							t.Errorf("WorkCost(-base)=%v, want %v", neg.WorkCost, -pos.WorkCost)
						}
						if !approx(neg.MarkupCoefficient, pos.MarkupCoefficient) {
							t.Errorf("MarkupCoefficient: neg=%v pos=%v", neg.MarkupCoefficient, pos.MarkupCoefficient)
						}
						if neg.MarkupCoefficient < 0 {
							t.Errorf("MarkupCoefficient < 0: %v", neg.MarkupCoefficient)
						}
					})
				}
			}
		}
	}
}
