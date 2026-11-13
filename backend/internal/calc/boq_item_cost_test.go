package calc

import (
	"math"
	"testing"
)

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func numStep(mult float64) SequenceStep {
	return SequenceStep{BaseIndex: -1, Action1: "multiply", Operand1Type: "number", Operand1Key: mult}
}

// Material, no distribution → дефолт Конструктора: база → материалы, наценка → работы.
func TestCalculateBoqItemCost_MaterialNilDistribution(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqMat: {numStep(1.25)}}
	cache := map[string]float64{}
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqMat, TotalAmount: 100},
		seqs, nil, map[string]float64{}, nil, nil, cache)
	if !ok {
		t.Fatal("expected ok=true")
	}
	if !approx(res.MaterialCost, 100) || !approx(res.WorkCost, 25) {
		t.Errorf("got mat=%v work=%v, want 100/25", res.MaterialCost, res.WorkCost)
	}
	if !approx(res.MarkupCoefficient, 1.25) {
		t.Errorf("coef got %v, want 1.25", res.MarkupCoefficient)
	}
}

// Material with distribution: base → material, markup → work.
func TestCalculateBoqItemCost_DistributionSplit(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqMat: {numStep(1.25)}}
	dist := &PricingDistribution{BasicMaterialBaseTarget: TargetMaterial, BasicMaterialMarkupTarget: TargetWork}
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqMat, MaterialType: "основн.", TotalAmount: 100},
		seqs, nil, map[string]float64{}, dist, nil, map[string]float64{})
	if !ok || !approx(res.MaterialCost, 100) || !approx(res.WorkCost, 25) {
		t.Errorf("got mat=%v work=%v, want 100/25", res.MaterialCost, res.WorkCost)
	}
}

// VAT removed via nds_22 param, then re-applied to each column.
func TestCalculateBoqItemCost_VatFromParam(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqRab: {
		numStep(1.2),
		{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "nds_22", Operand1MultiplyFormat: "addOne"},
	}}
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqRab, TotalAmount: 100},
		seqs, nil, map[string]float64{"nds_22": 22}, nil, nil, map[string]float64{})
	// coeff (без НДС) = 1.2 → 120; work column; ×1.22 = 146.4
	if !ok || !approx(res.MaterialCost, 0) || !approx(res.WorkCost, 120*1.22) {
		t.Errorf("got mat=%v work=%v, want 0/%v", res.MaterialCost, res.WorkCost, 120*1.22)
	}
}

// VAT recognised by step name + 1.xx numeric multiplier.
func TestCalculateBoqItemCost_VatFromName(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqRab: {
		numStep(1.2),
		{Name: "НДС 20%", BaseIndex: 0, Action1: "multiply", Operand1Type: "number", Operand1Key: 1.2},
	}}
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqRab, TotalAmount: 100},
		seqs, nil, map[string]float64{}, nil, nil, map[string]float64{})
	if !ok || !approx(res.WorkCost, 120*1.2) {
		t.Errorf("got work=%v, want %v", res.WorkCost, 120*1.2)
	}
}

// Excluded суб-раб drops the growth step; the dependent step inherits its base (step0), not the raw base.
func TestCalculateBoqItemCost_SubcontractExclusion(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqSubRab: {
		numStep(1.1), // step0
		{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "subcontract_works_cost_growth", Operand1MultiplyFormat: "addOne"}, // step1 (removed)
		{BaseIndex: 1, Action1: "multiply", Operand1Type: "number", Operand1Key: 1.05}, // step2 → after removal inherits base of step1 = step0
	}}
	params := map[string]float64{"subcontract_works_cost_growth": 10}
	ex := &SubcontractExclusions{Works: map[string]bool{"cat1": true}, Materials: map[string]bool{}}

	excluded, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubRab, DetailCostCategoryID: "cat1", TotalAmount: 100},
		seqs, nil, params, nil, ex, map[string]float64{})
	// filtered: [×1.1, ×1.05(base 0)] → 1.1×1.05 = 1.155 → 115.5
	if !ok || !approx(excluded.WorkCost, 115.5) {
		t.Errorf("excluded work got %v, want 115.5", excluded.WorkCost)
	}

	// Sanity: a non-excluded item keeps the growth step → different result.
	notExcluded, _ := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubRab, DetailCostCategoryID: "other", TotalAmount: 100},
		seqs, nil, params, nil, ex, map[string]float64{})
	if approx(notExcluded.WorkCost, 105) {
		t.Errorf("non-excluded should differ from 105, got %v", notExcluded.WorkCost)
	}
}

// Новый список: шаг с new_subcontract_works_cost_growth выпадает для суб-раб в исключениях.
func TestCalculateBoqItemCost_SubcontractExclusionNewWorksKey(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqSubRab: {
		numStep(1.1), // step0
		{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "new_subcontract_works_cost_growth", Operand1MultiplyFormat: "addOne"}, // step1 (removed)
		{BaseIndex: 1, Action1: "multiply", Operand1Type: "number", Operand1Key: 1.05},                                                                 // step2 → наследует base удалённого step1 (step0)
	}}
	params := map[string]float64{"new_subcontract_works_cost_growth": 10}
	ex := &SubcontractExclusions{Works: map[string]bool{"cat1": true}, Materials: map[string]bool{}}

	excluded, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubRab, DetailCostCategoryID: "cat1", TotalAmount: 100},
		seqs, nil, params, nil, ex, map[string]float64{})
	if !ok || !approx(excluded.WorkCost, 115.5) {
		t.Errorf("excluded work got %v, want 115.5", excluded.WorkCost)
	}
	notExcluded, _ := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubRab, DetailCostCategoryID: "other", TotalAmount: 100},
		seqs, nil, params, nil, ex, map[string]float64{})
	if approx(notExcluded.WorkCost, 105) {
		t.Errorf("non-excluded should differ from 105, got %v", notExcluded.WorkCost)
	}
}

// Новый список: шаг с new_subcontract_materials_cost_growth выпадает для суб-мат в исключениях.
func TestCalculateBoqItemCost_SubcontractExclusionNewMaterialsKey(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqSubMat: {
		numStep(1.1), // step0
		{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "new_subcontract_materials_cost_growth", Operand1MultiplyFormat: "addOne"}, // step1 (removed)
		{BaseIndex: 1, Action1: "multiply", Operand1Type: "number", Operand1Key: 1.05},                                                                     // step2 → наследует base удалённого step1 (step0)
	}}
	params := map[string]float64{"new_subcontract_materials_cost_growth": 10}
	ex := &SubcontractExclusions{Works: map[string]bool{}, Materials: map[string]bool{"cat1": true}}

	// Основн. материал без распределения: база → материалы, наценка → работы; сумма = коэффициент × 100.
	excluded, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubMat, MaterialType: "основн.", DetailCostCategoryID: "cat1", TotalAmount: 100},
		seqs, nil, params, nil, ex, map[string]float64{})
	if !ok || !approx(excluded.MaterialCost+excluded.WorkCost, 115.5) {
		t.Errorf("excluded total got %v, want 115.5", excluded.MaterialCost+excluded.WorkCost)
	}
	notExcluded, _ := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubMat, MaterialType: "основн.", DetailCostCategoryID: "other", TotalAmount: 100},
		seqs, nil, params, nil, ex, map[string]float64{})
	if approx(notExcluded.MaterialCost+notExcluded.WorkCost, 105) {
		t.Errorf("non-excluded should differ from 105, got %v", notExcluded.MaterialCost+notExcluded.WorkCost)
	}
}

// Новый список: НДС через параметр new_nds выделяется и применяется к колонкам после распределения.
func TestCalculateBoqItemCost_VatFromNewParam(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqRab: {
		numStep(1.2),
		{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "new_nds", Operand1MultiplyFormat: "addOne"},
	}}
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqRab, TotalAmount: 100},
		seqs, nil, map[string]float64{"new_nds": 3}, nil, nil, map[string]float64{})
	if !ok || !approx(res.MaterialCost, 0) || !approx(res.WorkCost, 120*1.03) {
		t.Errorf("got mat=%v work=%v, want 0/%v", res.MaterialCost, res.WorkCost, 120*1.03)
	}

	// Материал с распределением: НДС применяется и к материалам, и к работам.
	matSeqs := map[string][]SequenceStep{BoqMat: {
		numStep(1.25),
		{BaseIndex: 0, Action1: "multiply", Operand1Type: "markup", Operand1Key: "new_nds", Operand1MultiplyFormat: "addOne"},
	}}
	dist := &PricingDistribution{BasicMaterialBaseTarget: TargetMaterial, BasicMaterialMarkupTarget: TargetWork}
	m, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqMat, MaterialType: "основн.", TotalAmount: 100},
		matSeqs, nil, map[string]float64{"new_nds": 3}, dist, nil, map[string]float64{})
	if !ok || !approx(m.MaterialCost, 100*1.03) || !approx(m.WorkCost, 25*1.03) {
		t.Errorf("got mat=%v work=%v, want %v/%v", m.MaterialCost, m.WorkCost, 100*1.03, 25*1.03)
	}

	// Параметр = 0 → шаг не считается НДС и остаётся в цепочке (×(1+0)).
	zero, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqRab, TotalAmount: 100},
		seqs, nil, map[string]float64{"new_nds": 0}, nil, nil, map[string]float64{})
	if !ok || !approx(zero.WorkCost, 120) {
		t.Errorf("zero vat got work=%v, want 120", zero.WorkCost)
	}
}

// суб-мат основн. with nil distribution: base → material, markup → work.
func TestCalculateBoqItemCost_SubMaterialNilDistribution(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqSubMat: {numStep(1.3)}}
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubMat, MaterialType: "основн.", TotalAmount: 100},
		seqs, nil, map[string]float64{}, nil, nil, map[string]float64{})
	if !ok || !approx(res.MaterialCost, 100) || !approx(res.WorkCost, 30) {
		t.Errorf("got mat=%v work=%v, want 100/30", res.MaterialCost, res.WorkCost)
	}
}

// No sequence for the item type → ok=false (mirrors TS null).
func TestCalculateBoqItemCost_NoSequence(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqRab: {numStep(1.2)}}
	_, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqMat, TotalAmount: 100},
		seqs, nil, map[string]float64{}, nil, nil, map[string]float64{})
	if ok {
		t.Error("expected ok=false for missing sequence")
	}
}

// Shared coeff cache: two items of the same type compute the coefficient once.
func TestCalculateBoqItemCost_CoeffCacheReuse(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqMat: {numStep(1.25)}}
	cache := map[string]float64{}
	CalculateBoqItemCost(BoqItemForCost{BoqItemType: BoqMat, TotalAmount: 100}, seqs, nil, map[string]float64{}, nil, nil, cache)
	CalculateBoqItemCost(BoqItemForCost{BoqItemType: BoqMat, TotalAmount: 200}, seqs, nil, map[string]float64{}, nil, nil, cache)
	if len(cache) != 1 {
		t.Errorf("expected 1 cached coefficient, got %d", len(cache))
	}
}

// growthChainSteps — цепочка Рост(base -1) → ООЗ(0) → ОФЗ(1) → НДС(2) → Прибыль(3), все addOne.
func growthChainSteps() []SequenceStep {
	mk := func(base int, key string) SequenceStep {
		return SequenceStep{BaseIndex: base, Action1: "multiply", Operand1Type: "markup", Operand1Key: key, Operand1MultiplyFormat: "addOne"}
	}
	return []SequenceStep{
		mk(-1, "new_subcontract_works_cost_growth"),
		mk(0, "new_overhead_subcontract"),
		mk(1, "new_general_costs"),
		mk(2, "new_nds"),
		mk(3, "new_profit_discount"),
	}
}

var growthChainParams = map[string]float64{
	"new_subcontract_works_cost_growth": 10,
	"new_overhead_subcontract":          6,
	"new_general_costs":                 5,
	"new_nds":                           3,
	"new_profit_discount":               3,
}

// НДС в середине цепочки: шаг после НДС наследует его базу (а не падает на базу -1).
func TestCalculateBoqItemCost_VatInMiddleOfChain(t *testing.T) {
	seqs := map[string][]SequenceStep{BoqSubRab: growthChainSteps()}
	ex := &SubcontractExclusions{Works: map[string]bool{"cat1": true}, Materials: map[string]bool{}}

	// (a) категория не в исключениях: 1.1×1.06×1.05×1.03 (прибыль) × 1.03 (НДС отдельно).
	res, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubRab, DetailCostCategoryID: "other", TotalAmount: 100},
		seqs, nil, growthChainParams, nil, ex, map[string]float64{})
	want := 100 * 1.1 * 1.06 * 1.05 * 1.03 * 1.03
	if !ok || !approx(res.MaterialCost+res.WorkCost, want) {
		t.Errorf("(a) got %v, want %v", res.MaterialCost+res.WorkCost, want)
	}

	// (b) категория в исключениях роста: 1.06×1.05×1.03 × 1.03.
	exRes, ok := CalculateBoqItemCost(
		BoqItemForCost{BoqItemType: BoqSubRab, DetailCostCategoryID: "cat1", TotalAmount: 100},
		seqs, nil, growthChainParams, nil, ex, map[string]float64{})
	wantEx := 100 * 1.06 * 1.05 * 1.03 * 1.03
	if !ok || !approx(exRes.MaterialCost+exRes.WorkCost, wantEx) {
		t.Errorf("(b) got %v, want %v", exRes.MaterialCost+exRes.WorkCost, wantEx)
	}
}

// (c) Удалённый первый шаг (base -1): зависимый от него шаг опирается на базу, как раньше.
func TestRewriteBaseIndices_RemovedFirstStepFallsToBase(t *testing.T) {
	orig := growthChainSteps()[:2] // Рост(-1), ООЗ(0)
	removed := map[int]bool{0: true}
	out := rewriteBaseIndices(orig, orig[1:], removed)
	if len(out) != 1 || out[0].BaseIndex != -1 {
		t.Errorf("got %+v, want single step with BaseIndex -1", out)
	}
}

// Цикл наследования среди удалённых шагов → база -1, без зависания.
func TestRewriteBaseIndices_CycleFallsToBase(t *testing.T) {
	orig := []SequenceStep{{BaseIndex: 1}, {BaseIndex: 0}, {BaseIndex: 0}}
	out := rewriteBaseIndices(orig, orig[2:], map[int]bool{0: true, 1: true})
	if len(out) != 1 || out[0].BaseIndex != -1 {
		t.Errorf("got %+v, want BaseIndex -1", out)
	}
}
