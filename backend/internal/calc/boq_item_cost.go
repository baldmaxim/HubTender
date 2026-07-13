// Port of calculateBoqItemCost (+ its private helpers) from
// src/services/markupTactic/calculation.ts. Orchestrates a single BOQ item's
// commercial cost: pick the markup sequence by item type, strip subcontract-growth
// steps for excluded categories, strip VAT (applied separately), compute the type
// coefficient, multiply the base amount, split material/work via pricing
// distribution, then re-apply VAT to each column. Stay 1:1 with the TS; any drift
// is a cutover blocker caught by scripts/dual-run/positions-with-costs.mjs.
package calc

import (
	"fmt"
	"math"
	"strings"
)

// SequenceStep is the FLAT JSONB form stored in public.markup_tactics.sequences.
// Mirrors src/lib/supabase/types.ts MarkupStep exactly (camelCase keys). OperandN
// Key is `any` — a string for "markup" operands, a number for "number" operands.
// OperandNIndex is a pointer so an absent field is distinguishable from index 0.
type SequenceStep struct {
	Name      string `json:"name"`
	BaseIndex int    `json:"baseIndex"`

	Action1                string `json:"action1"`
	Operand1Type           string `json:"operand1Type"`
	Operand1Key            any    `json:"operand1Key"`
	Operand1Index          *int   `json:"operand1Index"`
	Operand1MultiplyFormat string `json:"operand1MultiplyFormat"`

	Action2                string `json:"action2"`
	Operand2Type           string `json:"operand2Type"`
	Operand2Key            any    `json:"operand2Key"`
	Operand2Index          *int   `json:"operand2Index"`
	Operand2MultiplyFormat string `json:"operand2MultiplyFormat"`

	Action3                string `json:"action3"`
	Operand3Type           string `json:"operand3Type"`
	Operand3Key            any    `json:"operand3Key"`
	Operand3Index          *int   `json:"operand3Index"`
	Operand3MultiplyFormat string `json:"operand3MultiplyFormat"`

	Action4                string `json:"action4"`
	Operand4Type           string `json:"operand4Type"`
	Operand4Key            any    `json:"operand4Key"`
	Operand4Index          *int   `json:"operand4Index"`
	Operand4MultiplyFormat string `json:"operand4MultiplyFormat"`

	Action5                string `json:"action5"`
	Operand5Type           string `json:"operand5Type"`
	Operand5Key            any    `json:"operand5Key"`
	Operand5Index          *int   `json:"operand5Index"`
	Operand5MultiplyFormat string `json:"operand5MultiplyFormat"`
}

func seqOperand(typ string, key any, index *int, mf string) Operand {
	op := Operand{Type: OperandType(typ), MultiplyFormat: MultiplyFormat(mf)}
	if key != nil {
		op.Key = key
	}
	if index != nil {
		op.Index = *index
		op.IndexSet = true
	}
	return op
}

// toMarkupStep converts the flat JSONB step into the nested form CalculateMarkupResult consumes.
func (s SequenceStep) toMarkupStep() MarkupStep {
	return MarkupStep{
		Name:      s.Name,
		BaseIndex: s.BaseIndex,
		Action1:   MarkupOperation(s.Action1), Operand1: seqOperand(s.Operand1Type, s.Operand1Key, s.Operand1Index, s.Operand1MultiplyFormat),
		Action2: MarkupOperation(s.Action2), Operand2: seqOperand(s.Operand2Type, s.Operand2Key, s.Operand2Index, s.Operand2MultiplyFormat),
		Action3: MarkupOperation(s.Action3), Operand3: seqOperand(s.Operand3Type, s.Operand3Key, s.Operand3Index, s.Operand3MultiplyFormat),
		Action4: MarkupOperation(s.Action4), Operand4: seqOperand(s.Operand4Type, s.Operand4Key, s.Operand4Index, s.Operand4MultiplyFormat),
		Action5: MarkupOperation(s.Action5), Operand5: seqOperand(s.Operand5Type, s.Operand5Key, s.Operand5Index, s.Operand5MultiplyFormat),
	}
}

func (s SequenceStep) operandKeys() []any {
	return []any{s.Operand1Key, s.Operand2Key, s.Operand3Key, s.Operand4Key, s.Operand5Key}
}

type operandKT struct {
	key any
	typ string
}

func (s SequenceStep) operandPairs() []operandKT {
	return []operandKT{
		{s.Operand1Key, s.Operand1Type},
		{s.Operand2Key, s.Operand2Type},
		{s.Operand3Key, s.Operand3Type},
		{s.Operand4Key, s.Operand4Type},
		{s.Operand5Key, s.Operand5Type},
	}
}

// hasStringKey mirrors TS `operandKeys.filter(Boolean).includes(target)`: only a
// string operand key can equal a (string) markup key; numeric keys never match.
func (s SequenceStep) hasStringKey(target string) bool {
	for _, k := range s.operandKeys() {
		if str, ok := k.(string); ok && str == target {
			return true
		}
	}
	return false
}

// rewriteBaseIndices re-points baseIndex after some original steps were removed.
// removed holds ORIGINAL indices; filtered preserves original baseIndex values.
func rewriteBaseIndices(filtered []SequenceStep, removed map[int]bool) []SequenceStep {
	out := make([]SequenceStep, len(filtered))
	for i, step := range filtered {
		nb := step.BaseIndex
		if nb >= 0 {
			if removed[nb] {
				nb = -1
			} else {
				removedBefore := 0
				for r := range removed {
					if r < nb {
						removedBefore++
					}
				}
				nb -= removedBefore
			}
		}
		step.BaseIndex = nb
		out[i] = step
	}
	return out
}

// filterSequenceForExclusions drops subcontract-growth steps for excluded categories.
func filterSequenceForExclusions(seq []SequenceStep, isExcluded bool, itemType string) []SequenceStep {
	if !isExcluded {
		return seq
	}
	growthKey := "subcontract_materials_cost_growth"
	if itemType == BoqSubRab {
		growthKey = "subcontract_works_cost_growth"
	}

	removed := map[int]bool{}
	for i, step := range seq {
		if step.hasStringKey(growthKey) {
			removed[i] = true
		}
	}
	if len(removed) == 0 {
		return seq
	}

	filtered := make([]SequenceStep, 0, len(seq))
	for i, step := range seq {
		if !removed[i] {
			filtered = append(filtered, step)
		}
	}
	return rewriteBaseIndices(filtered, removed)
}

// filterVATFromSequence removes VAT step(s) and returns the VAT coefficient (in %)
// to be applied separately. Two recognised forms: an operand keyed nds_22 (when the
// param is positive), or a step whose name mentions НДС/NDS/VAT with a 1.xx numeric
// multiplier.
func filterVATFromSequence(seq []SequenceStep, params map[string]float64) ([]SequenceStep, float64) {
	const vatKey = "nds_22"
	vatParamValue := params[vatKey] // 0 when absent

	removed := map[int]bool{}
	vatCoefficient := 0.0

	for i, step := range seq {
		if vatParamValue > 0 && step.hasStringKey(vatKey) {
			removed[i] = true
			vatCoefficient = vatParamValue
			continue
		}

		name := strings.ToLower(step.Name)
		if strings.Contains(name, "ндс") || strings.Contains(name, "nds") || strings.Contains(name, "vat") {
			for _, op := range step.operandPairs() {
				if op.typ == "number" && op.key != nil {
					num := toFloat(op.key)
					if num > 1 && num < 2 {
						vatCoefficient = math.Round((num - 1) * 100)
						removed[i] = true
						break
					}
				}
			}
		}
	}

	if len(removed) == 0 {
		return seq, 0
	}

	filtered := make([]SequenceStep, 0, len(seq))
	for i, step := range seq {
		if !removed[i] {
			filtered = append(filtered, step)
		}
	}
	return rewriteBaseIndices(filtered, removed), vatCoefficient
}

// calculateTypeCoefficient applies the sequence to base = 1 to get the multiplier.
func calculateTypeCoefficient(seq []SequenceStep, params map[string]float64, baseCost *float64) float64 {
	if len(seq) == 0 {
		return 1
	}
	steps := make([]MarkupStep, len(seq))
	for i, s := range seq {
		steps[i] = s.toMarkupStep()
	}
	res := CalculateMarkupResult(CalculationContext{
		BaseAmount:       1,
		MarkupSequence:   steps,
		MarkupParameters: params,
		BaseCost:         baseCost,
	})
	return res.CommercialCost
}

// BoqItemForCost is the subset of a BOQ item needed for the commercial calc.
type BoqItemForCost struct {
	BoqItemType          string
	MaterialType         string
	DetailCostCategoryID string
	TotalAmount          float64
}

// SubcontractExclusions holds the detail-category IDs excluded from subcontract
// growth, split by exclusion_type (works → суб-раб, materials → суб-мат).
type SubcontractExclusions struct {
	Works     map[string]bool
	Materials map[string]bool
}

func isExcludedFromGrowth(item BoqItemForCost, ex *SubcontractExclusions) bool {
	if ex == nil || item.DetailCostCategoryID == "" {
		return false
	}
	switch item.BoqItemType {
	case BoqSubRab:
		return ex.Works[item.DetailCostCategoryID]
	case BoqSubMat:
		return ex.Materials[item.DetailCostCategoryID]
	}
	return false
}

// BoqItemCostResult mirrors the object returned by calculateBoqItemCost.
type BoqItemCostResult struct {
	MaterialCost      float64
	WorkCost          float64
	MarkupCoefficient float64
}

// CalculateBoqItemCost computes a single item's commercial material/work split.
//
// coeffCache is owned by the caller and shared across items of one recalc run
// (replaces the TS module-level typeCoefficientsCache) so parallel tender recalcs
// never share mutable state. ok=false mirrors the TS `null` return when the item
// type has no sequence in the tactic.
//
// Deprecated param: baseCosts is IGNORED (P0). MarkupConstructor preview
// base_costs must never affect the production coefficient. Kept in the signature
// only to avoid churning callers; pass nil.
func CalculateBoqItemCost(
	item BoqItemForCost,
	sequences map[string][]SequenceStep,
	baseCosts map[string]float64, //nolint:revive // deprecated, ignored (see doc)
	params map[string]float64,
	distribution *PricingDistribution,
	exclusions *SubcontractExclusions,
	coeffCache map[string]float64,
) (BoqItemCostResult, bool) {
	seq, has := sequences[item.BoqItemType]
	if !has || len(seq) == 0 {
		return BoqItemCostResult{}, false
	}
	baseAmount := item.TotalAmount

	isExcluded := isExcludedFromGrowth(item, exclusions)
	if isExcluded {
		seq = filterSequenceForExclusions(seq, true, item.BoqItemType)
	}

	seqNoVAT, vat := filterVATFromSequence(seq, params)

	exclTag := "norm"
	if isExcluded {
		exclTag = "excl"
	}
	cacheKey := fmt.Sprintf("%s_%s_%v", item.BoqItemType, exclTag, vat)

	coeff, cached := coeffCache[cacheKey]
	if !cached {
		// base_costs is a MarkupConstructor preview value and must NOT enter the
		// production coefficient (P0). Always compute from base = 1; the
		// deprecated baseCosts param is intentionally ignored.
		coeff = calculateTypeCoefficient(seqNoVAT, params, nil)
		coeffCache[cacheKey] = coeff
	}

	commercialNoVAT := baseAmount * coeff
	matCost, workCost := ApplyPricingDistribution(baseAmount, commercialNoVAT, item.BoqItemType, item.MaterialType, distribution)

	if vat > 0 {
		m := 1 + vat/100
		matCost *= m
		workCost *= m
	}

	total := matCost + workCost
	coefOut := 1.0
	if baseAmount > 0 {
		coefOut = total / baseAmount
	}
	return BoqItemCostResult{MaterialCost: matCost, WorkCost: workCost, MarkupCoefficient: coefOut}, true
}
