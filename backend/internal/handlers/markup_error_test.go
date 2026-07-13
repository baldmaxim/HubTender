package handlers

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// The handler maps blocking domain errors to RFC 7807 400 responses with a
// stable machine-readable code and structured details, even when the error is
// wrapped by the service layer (errors.As unwraps %w chains).

func TestRenderInvalidSequence_RFC7807(t *testing.T) {
	inner := &calc.InvalidMarkupSequenceError{Issues: []calc.SequenceIssue{
		{Category: "раб", Step: 1, Operand: 1, Field: "operand1MultiplyFormat", Message: "обязателен"},
	}}
	// Wrapped exactly as MarkupService.CreateTactic would return it.
	wrapped := fmt.Errorf("markupService.CreateTactic: %w", inner)

	w := httptest.NewRecorder()
	if !renderInvalidSequence(w, wrapped) {
		t.Fatal("renderInvalidSequence should handle a wrapped InvalidMarkupSequenceError")
	}
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("content-type = %q, want application/problem+json", ct)
	}

	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["code"] != "INVALID_MARKUP_SEQUENCE" {
		t.Fatalf("code = %v, want INVALID_MARKUP_SEQUENCE", body["code"])
	}
	issues, ok := body["issues"].([]any)
	if !ok || len(issues) != 1 {
		t.Fatalf("issues missing/wrong: %v", body["issues"])
	}
}

func TestRenderInvalidSequence_IgnoresOtherErrors(t *testing.T) {
	w := httptest.NewRecorder()
	if renderInvalidSequence(w, fmt.Errorf("some db error")) {
		t.Fatal("must not handle unrelated errors")
	}
}

// Stage 0.1.2.1: the template-insert path wraps the calc error twice
// (repository → service). errors.As must still reach MissingFXRateError so the
// handler answers 400 MISSING_FX_RATE instead of a generic 500.
func TestRenderMissingFXRate_TemplateInsertChain(t *testing.T) {
	repoErr := fmt.Errorf("boqRepo.InsertTemplateItems: item #2: %w", &calc.MissingFXRateError{Currency: "EUR"})
	svcErr := fmt.Errorf("boqService.InsertTemplateItems: %w", repoErr)

	w := httptest.NewRecorder()
	if !renderMissingFXRate(w, svcErr) {
		t.Fatal("template-insert error chain must be recognised as MissingFXRateError")
	}
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400 (not a 500)", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["code"] != "MISSING_FX_RATE" || body["currency"] != "EUR" {
		t.Fatalf("unexpected problem body: %v", body)
	}
}

func TestRenderMissingFXRate_RFC7807(t *testing.T) {
	wrapped := fmt.Errorf("boqRepo.CreateBoqItem: %w", &calc.MissingFXRateError{Currency: "USD"})

	w := httptest.NewRecorder()
	if !renderMissingFXRate(w, wrapped) {
		t.Fatal("renderMissingFXRate should handle a wrapped MissingFXRateError")
	}
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	if body["code"] != "MISSING_FX_RATE" || body["currency"] != "USD" {
		t.Fatalf("unexpected body: %v", body)
	}
}
