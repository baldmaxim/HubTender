// Port of src/utils/markupCalculator.ts — applies a sequence of markup steps
// to a base amount. Stay 1:1 with the TS; any drift is a cutover blocker.
package calc

import (
	"fmt"
)

// MarkupOperation is an arithmetic op applied to a base value with one operand.
type MarkupOperation string

const (
	OpMultiply MarkupOperation = "multiply"
	OpDivide   MarkupOperation = "divide"
	OpAdd      MarkupOperation = "add"
	OpSubtract MarkupOperation = "subtract"
)

// OperandType is the source of an operand value: a named markup %, a previous
// step result, or a fixed number.
type OperandType string

const (
	OperandMarkup OperandType = "markup"
	OperandStep   OperandType = "step"
	OperandNumber OperandType = "number"
)

// MultiplyFormat controls how "markup" operands are interpreted.
// "addOne" → 10 % becomes 1.1; "direct" (or empty) → 10 % becomes 0.1.
type MultiplyFormat string

const (
	MultiplyAddOne MultiplyFormat = "addOne"
	MultiplyDirect MultiplyFormat = "direct"
)

// Operand is one term in a step. Fields are optional per TS; only those
// relevant to OperandType are read.
type Operand struct {
	Type           OperandType
	Key            any            // string (for markup key) or number (for "number" literal)
	Index          int            // for "step": -1 means baseAmount, ≥0 means stepResults[Index]
	IndexSet       bool           // distinguishes Index=0 from "not provided"
	MultiplyFormat MultiplyFormat // for "markup": addOne vs direct
}

// MarkupStep mirrors the JSONB sequence element in public.markup_tactics.sequence.
// Up to 5 chained operations. Unused Action fields are empty.
type MarkupStep struct {
	Name      string // optional display name
	BaseIndex int    // -1 = use baseAmount; ≥0 = use stepResults[BaseIndex]

	Action1  MarkupOperation
	Operand1 Operand

	Action2  MarkupOperation // empty = skip remaining ops
	Operand2 Operand

	Action3  MarkupOperation
	Operand3 Operand

	Action4  MarkupOperation
	Operand4 Operand

	Action5  MarkupOperation
	Operand5 Operand
}

// CalculationContext mirrors the TS interface of the same name.
type CalculationContext struct {
	BaseAmount       float64
	ItemType         string             // BoqItemType (kept for parity; not used in math today)
	MarkupSequence   []MarkupStep
	MarkupParameters map[string]float64
	BaseCost         *float64 // optional override from the tactic
}

// CalculationResult mirrors the TS interface of the same name.
type CalculationResult struct {
	CommercialCost    float64
	MarkupCoefficient float64
	StepResults       []float64
	Errors            []string // nil when no errors (matches TS `undefined`)
}

// CalculateMarkupResult applies ctx.MarkupSequence step-by-step.
// Semantics strictly 1:1 with calculateMarkupResult in markupCalculator.ts.
func CalculateMarkupResult(ctx CalculationContext) CalculationResult {
	stepResults := []float64{}

	// Empty or missing sequence → return baseAmount unchanged with an error marker.
	if len(ctx.MarkupSequence) == 0 {
		msg := "Последовательность операций не определена"
		if ctx.MarkupSequence != nil { // present but empty
			msg = "Последовательность операций пуста"
		}
		return CalculationResult{
			CommercialCost:    ctx.BaseAmount,
			MarkupCoefficient: 1,
			StepResults:       []float64{},
			Errors:            []string{msg},
		}
	}

	// Use tactic baseCost override if provided, otherwise item baseAmount.
	currentAmount := ctx.BaseAmount
	if ctx.BaseCost != nil {
		currentAmount = *ctx.BaseCost
	}

	// Zero / negative shortcut — matches TS.
	if currentAmount <= 0 {
		var errs []string
		if currentAmount < 0 {
			errs = []string{"Базовая стоимость отрицательная"}
		}
		return CalculationResult{
			CommercialCost:    currentAmount,
			MarkupCoefficient: 1,
			StepResults:       []float64{},
			Errors:            errs,
		}
	}

	var errors []string

	for i, step := range ctx.MarkupSequence {
		res, err := runStep(step, ctx.BaseAmount, stepResults, ctx.MarkupParameters)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Ошибка в шаге %d: %s", i+1, err.Error()))
			// On error the TS code pushes currentAmount (unchanged) into stepResults.
			stepResults = append(stepResults, currentAmount)
			continue
		}
		stepResults = append(stepResults, res)
		currentAmount = res
	}

	coef := 1.0
	if ctx.BaseAmount > 0 {
		coef = currentAmount / ctx.BaseAmount
	}

	return CalculationResult{
		CommercialCost:    currentAmount,
		MarkupCoefficient: coef,
		StepResults:       stepResults,
		Errors:            errors,
	}
}

// runStep evaluates a single MarkupStep with up to 5 sequential operations.
func runStep(step MarkupStep, baseAmount float64, stepResults []float64, params map[string]float64) (float64, error) {
	base, err := getBaseValue(step.BaseIndex, baseAmount, stepResults)
	if err != nil {
		return 0, err
	}
	cur := base

	// Op 1 is mandatory; ops 2-5 run only when the corresponding Action is non-empty.
	ops := []struct {
		action  MarkupOperation
		operand Operand
	}{
		{step.Action1, step.Operand1},
		{step.Action2, step.Operand2},
		{step.Action3, step.Operand3},
		{step.Action4, step.Operand4},
		{step.Action5, step.Operand5},
	}

	for idx, o := range ops {
		if idx == 0 {
			if o.action == "" || o.operand.Type == "" {
				return 0, fmt.Errorf("обязательная первая операция отсутствует")
			}
		} else {
			// TS: `if (step.actionN && step.operandNType) { ... }`
			if o.action == "" || o.operand.Type == "" {
				continue
			}
		}
		v, err := getOperandValue(o.operand, params, stepResults, baseAmount)
		if err != nil {
			return 0, err
		}
		cur, err = applyOperation(cur, o.action, v)
		if err != nil {
			return 0, err
		}
	}

	return cur, nil
}

func getBaseValue(baseIndex int, baseAmount float64, stepResults []float64) (float64, error) {
	if baseIndex == -1 {
		return baseAmount, nil
	}
	if baseIndex >= 0 && baseIndex < len(stepResults) {
		return stepResults[baseIndex], nil
	}
	return 0, fmt.Errorf("Недопустимый baseIndex: %d. Доступно шагов: %d", baseIndex, len(stepResults))
}

func getOperandValue(op Operand, params map[string]float64, stepResults []float64, baseAmount float64) (float64, error) {
	switch op.Type {
	case OperandMarkup:
		if op.Key == nil {
			return 0, fmt.Errorf("Не указан ключ наценки или отсутствуют параметры наценок")
		}
		key := fmt.Sprintf("%v", op.Key)
		v, ok := params[key]
		if !ok {
			return 0, fmt.Errorf("Параметр наценки %q не найден", key)
		}
		if op.MultiplyFormat == MultiplyAddOne {
			return 1 + v/100, nil
		}
		return v / 100, nil

	case OperandStep:
		if !op.IndexSet {
			return 0, fmt.Errorf("Не указан индекс шага или отсутствуют результаты шагов")
		}
		if op.Index == -1 {
			return baseAmount, nil
		}
		if op.Index < 0 || op.Index >= len(stepResults) {
			return 0, fmt.Errorf("Недопустимый индекс шага: %d. Доступно шагов: %d", op.Index, len(stepResults))
		}
		return stepResults[op.Index], nil

	case OperandNumber:
		if op.Key == nil {
			return 0, fmt.Errorf("Не указано числовое значение")
		}
		return toFloat(op.Key), nil

	default:
		return 0, fmt.Errorf("Неизвестный тип операнда: %s", op.Type)
	}
}

func applyOperation(base float64, op MarkupOperation, operand float64) (float64, error) {
	switch op {
	case OpMultiply:
		return base * operand, nil
	case OpDivide:
		if operand == 0 {
			return 0, fmt.Errorf("Деление на ноль")
		}
		return base / operand, nil
	case OpAdd:
		return base + operand, nil
	case OpSubtract:
		return base - operand, nil
	default:
		return 0, fmt.Errorf("Неизвестная операция: %s", op)
	}
}

func toFloat(v any) float64 {
	switch x := v.(type) {
	case float64:
		return x
	case float32:
		return float64(x)
	case int:
		return float64(x)
	case int64:
		return float64(x)
	case int32:
		return float64(x)
	case string:
		var f float64
		fmt.Sscanf(x, "%f", &f)
		return f
	default:
		return 0
	}
}

// CalculateMarkupPercentage returns ((commercial - base) / base) * 100.
// Port of calculateMarkupPercentage.
func CalculateMarkupPercentage(baseAmount, commercialCost float64) float64 {
	if baseAmount == 0 {
		return 0
	}
	return ((commercialCost - baseAmount) / baseAmount) * 100
}

// ValidateMarkupSequence returns a list of validation errors.
// Empty slice means all steps are valid. Port of validateMarkupSequence.
func ValidateMarkupSequence(seq []MarkupStep) []string {
	var errs []string
	for i, step := range seq {
		stepNum := i + 1

		if step.BaseIndex < -1 || step.BaseIndex >= i {
			errs = append(errs, fmt.Sprintf("Шаг %d: недопустимый baseIndex (%d)", stepNum, step.BaseIndex))
		}
		if step.Action1 == "" || step.Operand1.Type == "" {
			errs = append(errs, fmt.Sprintf("Шаг %d: отсутствует обязательная первая операция", stepNum))
		}

		check := func(n int, operand Operand) {
			if operand.Type == OperandStep {
				if !operand.IndexSet || operand.Index >= i {
					errs = append(errs, fmt.Sprintf("Шаг %d: недопустимый operand%dIndex для типа 'step'", stepNum, n))
				}
			}
		}
		check(1, step.Operand1)
		check(2, step.Operand2)
		check(3, step.Operand3)
		check(4, step.Operand4)
		check(5, step.Operand5)
	}
	return errs
}
