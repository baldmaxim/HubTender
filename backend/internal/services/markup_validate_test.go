package services

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// validateTacticSequences is the guard CreateTactic/UpdateTactic run BEFORE any
// repository write. These tests prove it returns a typed
// *calc.InvalidMarkupSequenceError for bad input (so the repo is never reached)
// and nil for valid/empty input.

func TestValidateTacticSequences_RejectsMissingFormat(t *testing.T) {
	raw := json.RawMessage(`{"раб":[{"baseIndex":-1,"action1":"multiply","operand1Type":"markup","operand1Key":"m"}]}`)
	err := validateTacticSequences(raw)
	var inv *calc.InvalidMarkupSequenceError
	if !errors.As(err, &inv) {
		t.Fatalf("expected InvalidMarkupSequenceError, got %v", err)
	}
	if len(inv.Issues) != 1 || inv.Issues[0].Field != "operand1MultiplyFormat" {
		t.Fatalf("unexpected issues: %+v", inv.Issues)
	}
}

func TestValidateTacticSequences_RejectsUnknownFormat(t *testing.T) {
	raw := json.RawMessage(`{"раб":[{"baseIndex":-1,"action1":"multiply","operand1Type":"markup","operand1Key":"m","operand1MultiplyFormat":"weird"}]}`)
	if err := validateTacticSequences(raw); !errors.As(err, new(*calc.InvalidMarkupSequenceError)) {
		t.Fatalf("expected InvalidMarkupSequenceError, got %v", err)
	}
}

func TestValidateTacticSequences_AcceptsValid(t *testing.T) {
	for _, fmtVal := range []string{"addOne", "direct"} {
		raw := json.RawMessage(`{"раб":[{"baseIndex":-1,"action1":"multiply","operand1Type":"markup","operand1Key":"m","operand1MultiplyFormat":"` + fmtVal + `"}]}`)
		if err := validateTacticSequences(raw); err != nil {
			t.Fatalf("format %q: unexpected error %v", fmtVal, err)
		}
	}
}

func TestValidateTacticSequences_EmptyIsValid(t *testing.T) {
	if err := validateTacticSequences(nil); err != nil {
		t.Fatalf("nil sequences must validate, got %v", err)
	}
	if err := validateTacticSequences(json.RawMessage(`{}`)); err != nil {
		t.Fatalf("empty sequences must validate, got %v", err)
	}
}

func TestValidateTacticSequences_MalformedJSON(t *testing.T) {
	if err := validateTacticSequences(json.RawMessage(`{not json`)); !errors.As(err, new(*calc.InvalidMarkupSequenceError)) {
		t.Fatalf("malformed sequences must be a blocking InvalidMarkupSequenceError, got %v", err)
	}
}
