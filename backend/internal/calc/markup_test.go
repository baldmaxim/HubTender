package calc

import (
	"testing"
)

// Parity tests with src/utils/markupCalculator.ts.
func TestCalculateMarkupResult_Empty(t *testing.T) {
	res := CalculateMarkupResult(CalculationContext{BaseAmount: 100})
	if res.CommercialCost != 100 {
		t.Errorf("nil sequence: got %v, want 100", res.CommercialCost)
	}
	if res.MarkupCoefficient != 1 {
		t.Errorf("nil sequence: coef got %v, want 1", res.MarkupCoefficient)
	}
	if len(res.Errors) != 1 {
		t.Errorf("expected one error, got %v", res.Errors)
	}

	res2 := CalculateMarkupResult(CalculationContext{BaseAmount: 100, MarkupSequence: []MarkupStep{}})
	if res2.CommercialCost != 100 {
		t.Errorf("empty slice: got %v, want 100", res2.CommercialCost)
	}
}

func TestCalculateMarkupResult_ZeroOrNegative(t *testing.T) {
	seq := []MarkupStep{{
		BaseIndex: -1, Action1: OpMultiply,
		Operand1: Operand{Type: OperandNumber, Key: 2.0},
	}}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 0, MarkupSequence: seq,
	})
	if res.CommercialCost != 0 || res.MarkupCoefficient != 1 {
		t.Errorf("zero: got %+v, want commercial=0 coef=1", res)
	}

	negRes := CalculateMarkupResult(CalculationContext{
		BaseAmount: -50, MarkupSequence: seq,
	})
	if negRes.CommercialCost != -50 || len(negRes.Errors) != 1 {
		t.Errorf("negative: got %+v", negRes)
	}
}

func TestCalculateMarkupResult_SingleMultiplyByNumber(t *testing.T) {
	seq := []MarkupStep{{
		BaseIndex: -1, Action1: OpMultiply,
		Operand1: Operand{Type: OperandNumber, Key: 1.5},
	}}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupSequence: seq,
	})
	if res.CommercialCost != 150 {
		t.Errorf("commercial: got %v, want 150", res.CommercialCost)
	}
	if res.MarkupCoefficient != 1.5 {
		t.Errorf("coef: got %v, want 1.5", res.MarkupCoefficient)
	}
	if len(res.StepResults) != 1 || res.StepResults[0] != 150 {
		t.Errorf("steps: got %v", res.StepResults)
	}
}

func TestCalculateMarkupResult_MarkupAddOneFormat(t *testing.T) {
	// 10 % with addOne → multiply by 1.1
	seq := []MarkupStep{{
		BaseIndex: -1, Action1: OpMultiply,
		Operand1: Operand{Type: OperandMarkup, Key: "profit_pct", MultiplyFormat: MultiplyAddOne},
	}}
	params := map[string]float64{"profit_pct": 10}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupSequence: seq, MarkupParameters: params,
	})
	if res.CommercialCost != 110 {
		t.Errorf("addOne: got %v, want 110", res.CommercialCost)
	}
}

func TestCalculateMarkupResult_MarkupDirectFormat(t *testing.T) {
	// 10 % with direct → multiply by 0.1 → 100 * 0.1 = 10
	seq := []MarkupStep{{
		BaseIndex: -1, Action1: OpMultiply,
		Operand1: Operand{Type: OperandMarkup, Key: "p", MultiplyFormat: MultiplyDirect},
	}}
	params := map[string]float64{"p": 10}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupSequence: seq, MarkupParameters: params,
	})
	if res.CommercialCost != 10 {
		t.Errorf("direct: got %v, want 10", res.CommercialCost)
	}
}

func TestCalculateMarkupResult_StepReferencesBase(t *testing.T) {
	// step 1: base * 1.1 (= 110)
	// step 2: base_amount_via_step_minus_one * 1.2 (Index=-1 → baseAmount=100)
	seq := []MarkupStep{
		{
			BaseIndex: -1, Action1: OpMultiply,
			Operand1: Operand{Type: OperandNumber, Key: 1.1},
		},
		{
			BaseIndex: -1, Action1: OpMultiply,
			Operand1: Operand{Type: OperandStep, Index: -1, IndexSet: true},
		},
	}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupSequence: seq,
	})
	// Step 1: 100 * 1.1 = 110
	// Step 2: baseAmount (from base_index=-1) * 100 (step operand value=100) = 10000
	if res.StepResults[0] != 110 {
		t.Errorf("step1: got %v, want 110", res.StepResults[0])
	}
	if res.StepResults[1] != 100*100 {
		t.Errorf("step2: got %v, want 10000", res.StepResults[1])
	}
	if res.CommercialCost != 10000 {
		t.Errorf("commercial: got %v, want 10000", res.CommercialCost)
	}
}

func TestCalculateMarkupResult_MultiOpChain(t *testing.T) {
	// base 100, op1 multiply 2 → 200, op2 add 50 → 250, op3 subtract 10 → 240
	seq := []MarkupStep{{
		BaseIndex: -1,
		Action1:   OpMultiply, Operand1: Operand{Type: OperandNumber, Key: 2.0},
		Action2:   OpAdd, Operand2: Operand{Type: OperandNumber, Key: 50.0},
		Action3:   OpSubtract, Operand3: Operand{Type: OperandNumber, Key: 10.0},
	}}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupSequence: seq,
	})
	if res.CommercialCost != 240 {
		t.Errorf("multi-op: got %v, want 240", res.CommercialCost)
	}
}

func TestCalculateMarkupResult_DivideByZero(t *testing.T) {
	seq := []MarkupStep{{
		BaseIndex: -1, Action1: OpDivide,
		Operand1: Operand{Type: OperandNumber, Key: 0.0},
	}}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, MarkupSequence: seq,
	})
	if len(res.Errors) != 1 {
		t.Errorf("expected 1 error, got %v", res.Errors)
	}
	// On step error TS pushes currentAmount (unchanged from 100 before the step)
	if len(res.StepResults) != 1 || res.StepResults[0] != 100 {
		t.Errorf("fallback stepResults: got %v", res.StepResults)
	}
}

func TestCalculateMarkupResult_BaseCostOverride(t *testing.T) {
	seq := []MarkupStep{{
		BaseIndex: -1, Action1: OpMultiply,
		Operand1: Operand{Type: OperandNumber, Key: 2.0},
	}}
	bc := 50.0
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount: 100, BaseCost: &bc, MarkupSequence: seq,
	})
	// Should start from BaseCost (50), not BaseAmount (100)
	if res.CommercialCost != 100 {
		t.Errorf("override: commercial got %v, want 100", res.CommercialCost)
	}
	// Coefficient is commercial / baseAmount = 100 / 100 = 1
	if res.MarkupCoefficient != 1 {
		t.Errorf("override coef: got %v, want 1", res.MarkupCoefficient)
	}
}

func TestCalculateMarkupPercentage(t *testing.T) {
	if CalculateMarkupPercentage(100, 150) != 50 {
		t.Errorf("100→150 = 50 %%")
	}
	if CalculateMarkupPercentage(0, 10) != 0 {
		t.Errorf("zero base returns 0")
	}
	if CalculateMarkupPercentage(200, 100) != -50 {
		t.Errorf("reverse returns negative")
	}
}

func TestValidateMarkupSequence(t *testing.T) {
	bad := []MarkupStep{
		{BaseIndex: 5, Action1: OpMultiply, Operand1: Operand{Type: OperandNumber, Key: 1}},
	}
	errs := ValidateMarkupSequence(bad)
	if len(errs) != 1 {
		t.Errorf("bad baseIndex: expected 1 error, got %v", errs)
	}

	good := []MarkupStep{
		{BaseIndex: -1, Action1: OpMultiply, Operand1: Operand{Type: OperandNumber, Key: 1.5}},
	}
	errs2 := ValidateMarkupSequence(good)
	if len(errs2) != 0 {
		t.Errorf("good step should validate: got %v", errs2)
	}
}
