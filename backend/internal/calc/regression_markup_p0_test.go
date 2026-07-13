package calc

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ─── Shared fixture loader (also used by regression_fx_p0_test.go) ───────────

type calcCasesFile struct {
	AmountCases []amountCase `json:"amount_cases"`
	CoeffCases  []coeffCase  `json:"coeff_cases"`
}

type ratesDTO struct {
	USD *float64 `json:"usdRate"`
	EUR *float64 `json:"eurRate"`
	CNY *float64 `json:"cnyRate"`
}

func (r ratesDTO) toRates() CurrencyRates {
	return CurrencyRates{USDRate: r.USD, EURRate: r.EUR, CNYRate: r.CNY}
}

type amountInDTO struct {
	BoqItemType            string   `json:"boqItemType"`
	Quantity               *float64 `json:"quantity"`
	UnitRate               *float64 `json:"unitRate"`
	CurrencyType           string   `json:"currencyType"`
	DeliveryPriceType      string   `json:"deliveryPriceType"`
	DeliveryAmount         *float64 `json:"deliveryAmount"`
	ConsumptionCoefficient *float64 `json:"consumptionCoefficient"`
	ParentWorkItemID       *string  `json:"parentWorkItemId"`
	TotalAmount            *float64 `json:"totalAmount"`
}

func (d amountInDTO) toInput() BoqItemAmountInput {
	return BoqItemAmountInput{
		BoqItemType:            d.BoqItemType,
		Quantity:               d.Quantity,
		UnitRate:               d.UnitRate,
		CurrencyType:           d.CurrencyType,
		DeliveryPriceType:      d.DeliveryPriceType,
		DeliveryAmount:         d.DeliveryAmount,
		ConsumptionCoefficient: d.ConsumptionCoefficient,
		ParentWorkItemID:       d.ParentWorkItemID,
		TotalAmount:            d.TotalAmount,
	}
}

type amountCase struct {
	Name            string      `json:"name"`
	In              amountInDTO `json:"in"`
	Rates           ratesDTO    `json:"rates"`
	WantAmount      float64     `json:"wantAmount"`
	WantErrCurrency string      `json:"wantErrCurrency"`
}

type coeffCase struct {
	Name                   string             `json:"name"`
	ItemType               string             `json:"itemType"`
	BaseAmount             float64            `json:"baseAmount"`
	Params                 map[string]float64 `json:"params"`
	BaseCosts              map[string]float64 `json:"baseCosts"`
	Sequence               []SequenceStep     `json:"sequence"`
	WantCommercial         float64            `json:"wantCommercial"`
	AssertBaseCostsIgnored bool               `json:"assertBaseCostsIgnored"`
}

func loadCalcCases(t *testing.T) calcCasesFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "calculation_cases.json"))
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	var f calcCasesFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("unmarshal fixtures: %v", err)
	}
	return f
}

func findCoeffCase(t *testing.T, name string) coeffCase {
	t.Helper()
	for _, c := range loadCalcCases(t).CoeffCases {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("coeff case %q not found in fixtures", name)
	return coeffCase{}
}

// ─── Bug 2: multiply+markup without operandNMultiplyFormat must default to
// addOne (10% → ×1.1), not direct (10% → ×0.1). Fails on pre-fix code. ────────

func TestMultiplyMarkup_MissingFormat_DefaultsAddOne(t *testing.T) {
	c := findCoeffCase(t, "multiply_markup_missing_format_defaults_addOne")

	steps := make([]MarkupStep, len(c.Sequence))
	for i, s := range c.Sequence {
		steps[i] = s.toMarkupStep()
	}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount:       c.BaseAmount,
		MarkupSequence:   steps,
		MarkupParameters: c.Params,
	})
	if !almostEqual(res.CommercialCost, c.WantCommercial) {
		t.Fatalf("multiply+markup missing format: CommercialCost = %v, want %v (addOne). "+
			"Pre-fix code defaults to 'direct' and yields %v.",
			res.CommercialCost, c.WantCommercial, c.BaseAmount*0.1)
	}
}

// Explicit direct on multiply+markup keeps bare-percentage semantics: 100 × 0.1 = 10.
func TestMultiplyMarkup_DirectFormat_TenPercent(t *testing.T) {
	step := SequenceStep{
		BaseIndex: -1, Action1: "multiply", Operand1Type: "markup",
		Operand1Key: "m", Operand1MultiplyFormat: "direct",
	}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount:       100,
		MarkupSequence:   []MarkupStep{step.toMarkupStep()},
		MarkupParameters: map[string]float64{"m": 10},
	})
	if !almostEqual(res.CommercialCost, 10) {
		t.Fatalf("direct multiply+markup: CommercialCost = %v, want 10", res.CommercialCost)
	}
}

// ─── Bug 1: a saved base_cost must NOT change the production coefficient. ─────

func TestBaseCosts_DoNotAffectCoefficient(t *testing.T) {
	c := findCoeffCase(t, "base_costs_do_not_change_coefficient")

	sequences := map[string][]SequenceStep{c.ItemType: c.Sequence}
	item := BoqItemForCost{BoqItemType: c.ItemType, TotalAmount: c.BaseAmount}

	withBase, okA := CalculateBoqItemCost(item, sequences, c.BaseCosts, c.Params, nil, nil, map[string]float64{})
	noBase, okB := CalculateBoqItemCost(item, sequences, nil, c.Params, nil, nil, map[string]float64{})
	if !okA || !okB {
		t.Fatalf("CalculateBoqItemCost returned ok=false (withBase=%v noBase=%v)", okA, okB)
	}
	if !almostEqual(withBase.MarkupCoefficient, noBase.MarkupCoefficient) {
		t.Fatalf("base_costs leaked into coefficient: withBaseCosts=%v noBaseCosts=%v — must be equal",
			withBase.MarkupCoefficient, noBase.MarkupCoefficient)
	}
	// Anchor: addOne 10% ⇒ coefficient 1.1.
	if !almostEqual(noBase.MarkupCoefficient, 1.1) {
		t.Fatalf("unexpected coefficient %v, want 1.1", noBase.MarkupCoefficient)
	}
}

// ─── Bug 4: validation must require operandNMultiplyFormat for multiply+markup.

func TestValidate_MultiplyMarkup_RequiresFormat(t *testing.T) {
	seq := []MarkupStep{{
		BaseIndex: -1,
		Action1:   OpMultiply,
		Operand1:  Operand{Type: OperandMarkup, Key: "m"}, // MultiplyFormat intentionally empty
	}}
	errs := ValidateMarkupSequence(seq)

	found := false
	for _, e := range errs {
		if strings.Contains(e, "MultiplyFormat") || strings.Contains(e, "multiplyFormat") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("validator must flag missing multiplyFormat for multiply+markup; got errors: %v", errs)
	}
}
