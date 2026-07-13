package calc

import "testing"

// step builds a one-step sequence with operand1 = (action, otype) and the given
// multiplyFormat on operand1. Other slots empty.
func mkStep(action, otype, format string) SequenceStep {
	return SequenceStep{
		BaseIndex:              -1,
		Action1:                action,
		Operand1Type:           otype,
		Operand1Key:            "m",
		Operand1MultiplyFormat: format,
	}
}

func TestValidateSequences_MultiplyMarkupFormat(t *testing.T) {
	tests := []struct {
		name       string
		step       SequenceStep
		wantIssues int
	}{
		{"multiply+markup missing format → error", mkStep("multiply", "markup", ""), 1},
		{"multiply+markup addOne → ok", mkStep("multiply", "markup", "addOne"), 0},
		{"multiply+markup direct → ok", mkStep("multiply", "markup", "direct"), 0},
		{"multiply+markup unknown format → error", mkStep("multiply", "markup", "weird"), 1},
		{"multiply+number without format → ok", mkStep("multiply", "number", ""), 0},
		{"add+markup without format → ok", mkStep("add", "markup", ""), 0},
		{"divide+markup without format → ok", mkStep("divide", "markup", ""), 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			issues := ValidateSequences(map[string][]SequenceStep{"раб": {tt.step}})
			if len(issues) != tt.wantIssues {
				t.Fatalf("issues = %d (%v), want %d", len(issues), issues, tt.wantIssues)
			}
		})
	}
}

// Each of operand2..operand5 must be independently checked for multiply+markup.
func TestValidateSequences_AllOperandSlots(t *testing.T) {
	slots := []SequenceStep{
		{BaseIndex: -1, Action1: "add", Operand1Type: "number", Operand1Key: 1,
			Action2: "multiply", Operand2Type: "markup", Operand2Key: "m"},
		{BaseIndex: -1, Action1: "add", Operand1Type: "number", Operand1Key: 1,
			Action3: "multiply", Operand3Type: "markup", Operand3Key: "m"},
		{BaseIndex: -1, Action1: "add", Operand1Type: "number", Operand1Key: 1,
			Action4: "multiply", Operand4Type: "markup", Operand4Key: "m"},
		{BaseIndex: -1, Action1: "add", Operand1Type: "number", Operand1Key: 1,
			Action5: "multiply", Operand5Type: "markup", Operand5Key: "m"},
	}
	for i, s := range slots {
		issues := ValidateSequences(map[string][]SequenceStep{"раб": {s}})
		if len(issues) != 1 {
			t.Fatalf("operand%d: issues = %d (%v), want 1", i+2, len(issues), issues)
		}
		if issues[0].Operand != i+2 {
			t.Fatalf("operand slot: got %d, want %d", issues[0].Operand, i+2)
		}
	}
}

// Issue carries structured location (category / step / operand / field).
func TestValidateSequences_IssueShape(t *testing.T) {
	issues := ValidateSequences(map[string][]SequenceStep{
		"мат": {mkStep("multiply", "markup", "")},
	})
	if len(issues) != 1 {
		t.Fatalf("want 1 issue, got %d", len(issues))
	}
	got := issues[0]
	if got.Category != "мат" || got.Step != 1 || got.Operand != 1 || got.Field != "operand1MultiplyFormat" {
		t.Fatalf("unexpected issue shape: %+v", got)
	}
}
