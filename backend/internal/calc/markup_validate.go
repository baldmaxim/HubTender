package calc

import (
	"fmt"
	"sort"
)

// ValidateSequences validates the flat JSONB sequences map stored in
// public.markup_tactics.sequences (keyed by boq_item_type). It enforces the P0
// rule for every ACTIVE operand N (1..5) of every step:
//
//	if actionN == "multiply" AND operandNType == "markup"
//	    → operandNMultiplyFormat is REQUIRED and must be "addOne" or "direct".
//
// multiplyFormat is NOT required for non-multiply operations, non-markup operand
// types, or empty (inactive) operand slots. Returns a deterministic, sorted list
// of issues; empty means valid. Backend enforcement is independent of frontend.
func ValidateSequences(sequences map[string][]SequenceStep) []SequenceIssue {
	var issues []SequenceIssue

	cats := make([]string, 0, len(sequences))
	for c := range sequences {
		cats = append(cats, c)
	}
	sort.Strings(cats)

	for _, cat := range cats {
		for i, step := range sequences[cat] {
			slots := []struct {
				n      int
				action string
				otype  string
				format string
			}{
				{1, step.Action1, step.Operand1Type, step.Operand1MultiplyFormat},
				{2, step.Action2, step.Operand2Type, step.Operand2MultiplyFormat},
				{3, step.Action3, step.Operand3Type, step.Operand3MultiplyFormat},
				{4, step.Action4, step.Operand4Type, step.Operand4MultiplyFormat},
				{5, step.Action5, step.Operand5Type, step.Operand5MultiplyFormat},
			}
			for _, s := range slots {
				// Inactive slot (no action / no operand type) → skip.
				if s.action == "" || s.otype == "" {
					continue
				}
				if s.action != string(OpMultiply) || s.otype != string(OperandMarkup) {
					continue
				}
				field := fmt.Sprintf("operand%dMultiplyFormat", s.n)
				switch s.format {
				case "":
					issues = append(issues, SequenceIssue{
						Category: cat, Step: i + 1, Operand: s.n, Field: field,
						Message: "operandNMultiplyFormat обязателен для multiply+markup (addOne или direct)",
					})
				case string(MultiplyAddOne), string(MultiplyDirect):
					// valid
				default:
					issues = append(issues, SequenceIssue{
						Category: cat, Step: i + 1, Operand: s.n, Field: field,
						Message: fmt.Sprintf("недопустимое значение %q (ожидается addOne или direct)", s.format),
					})
				}
			}
		}
	}

	return issues
}
