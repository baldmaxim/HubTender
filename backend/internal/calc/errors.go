package calc

import "fmt"

// MissingFXRateError is a typed domain error raised when a BOQ item is priced in
// a foreign currency (USD/EUR/CNY) but the tender has no positive exchange rate
// for it. It is a BLOCKING condition: callers must surface it (HTTP → RFC 7807
// with code MISSING_FX_RATE) and must never fall back to a zero amount.
//
// Kept 1:1 with the TS MissingFXRateError in src/utils/boq/calculateBoqAmount.ts.
type MissingFXRateError struct {
	Currency string // "USD" | "EUR" | "CNY"
}

func (e *MissingFXRateError) Error() string {
	return fmt.Sprintf("MISSING_FX_RATE: не задан курс валюты %s для тендера", e.Currency)
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *MissingFXRateError) Code() string { return "MISSING_FX_RATE" }

// SequenceIssue is one structured markup-sequence validation problem, suitable
// for an RFC 7807 extension member. Step is 1-based within its category; Operand
// is 1..5.
type SequenceIssue struct {
	Category string `json:"category"`
	Step     int    `json:"step"`
	Operand  int    `json:"operand"`
	Field    string `json:"field"`
	Message  string `json:"message"`
}

// InvalidMarkupSequenceError is a blocking domain error raised when a markup
// tactic's sequences fail validation. Callers must NOT persist; the handler maps
// it to RFC 7807 400 with code INVALID_MARKUP_SEQUENCE and the issue list.
type InvalidMarkupSequenceError struct {
	Issues []SequenceIssue
}

func (e *InvalidMarkupSequenceError) Error() string {
	return fmt.Sprintf("INVALID_MARKUP_SEQUENCE: %d issue(s)", len(e.Issues))
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *InvalidMarkupSequenceError) Code() string { return "INVALID_MARKUP_SEQUENCE" }
