package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0.1.2.3a (§17): the save handler accepts ONLY rules — forged client
// records are dropped by the decoder and can never reach the service — and
// maps every typed domain error to RFC 7807 through the %w chain.

type stubRedistributionSvc struct {
	err          error
	out          *repository.RedistributionSaveOutput
	gotTender    string
	gotTactic    string
	gotRules     calc.RedistributionRulesInput
	gotCreatedBy string
	calls        int
}

func (s *stubRedistributionSvc) Save(
	_ context.Context, tenderID, tacticID string,
	rules calc.RedistributionRulesInput, createdBy string,
) (*repository.RedistributionSaveOutput, error) {
	s.calls++
	s.gotTender, s.gotTactic, s.gotRules, s.gotCreatedBy = tenderID, tacticID, rules, createdBy
	if s.err != nil {
		return nil, s.err
	}
	return s.out, nil
}

func (s *stubRedistributionSvc) LoadResults(context.Context, string, string) (*repository.RedistributionLoad, error) {
	panic("not used")
}

const (
	rTender = "11111111-1111-1111-1111-111111111111"
	rTactic = "22222222-2222-2222-2222-222222222222"
)

func doRedistributionSave(t *testing.T, svc redistributionServicer, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewRedistributionHandler(svc)
	req := httptest.NewRequest("POST", "/api/v1/redistributions/save", strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.CtxUser,
		&middleware.AuthUser{ID: "user-1"}))
	w := httptest.NewRecorder()
	h.Save(w, req)
	return w
}

func okStubOutput() *repository.RedistributionSaveOutput {
	return &repository.RedistributionSaveOutput{
		SavedCount: 1,
		Results: []repository.RedistributionRecord{{
			BoqItemID: "i1", OriginalWorkCost: 1000, DeductedAmount: 100, AddedAmount: 0, FinalWorkCost: 900,
		}},
		TotalDeducted:  100,
		TotalAdded:     100,
		IsBalanced:     true,
		CanonicalRules: json.RawMessage(`{"schema_version":2,"calculation_source":"server"}`),
		TenderID:       rTender,
	}
}

func rulesOnlyBody() string {
	return fmt.Sprintf(`{
		"tender_id": %q, "markup_tactic_id": %q,
		"rules": {
			"deductions": [{"level":"detail","detail_cost_category_id":"33333333-3333-3333-3333-333333333333","percentage":10}],
			"targets": [{"level":"detail","detail_cost_category_id":"44444444-4444-4444-4444-444444444444"}]
		}
	}`, rTender, rTactic)
}

// §17.1/12 — a rules-only request succeeds; the response carries the SERVER
// results and metadata.
func TestRedistributionSaveHandler_RulesOnlyRequest(t *testing.T) {
	svc := &stubRedistributionSvc{out: okStubOutput()}
	w := doRedistributionSave(t, svc, rulesOnlyBody())
	if w.Code != 200 {
		t.Fatalf("status = %d, body %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			SavedCount        int                               `json:"saved_count"`
			Results           []repository.RedistributionRecord `json:"results"`
			CalculationSource string                            `json:"calculation_source"`
			SchemaVersion     int                               `json:"schema_version"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response: %v", err)
	}
	if resp.Data.SavedCount != 1 || len(resp.Data.Results) != 1 || resp.Data.Results[0].FinalWorkCost != 900 {
		t.Fatalf("server results missing from response: %+v", resp.Data)
	}
	if resp.Data.CalculationSource != "server" || resp.Data.SchemaVersion != 2 {
		t.Fatalf("server metadata missing: %+v", resp.Data)
	}
	if len(svc.gotRules.Deductions) != 1 || svc.gotRules.Deductions[0].Percentage != 10 {
		t.Fatalf("rules not delivered to service: %+v", svc.gotRules)
	}
}

// §17.2-4 — a LEGACY request with forged records (including malformed financial
// values) is accepted for rolling compatibility, but records never reach the
// service: two different forged payloads produce the IDENTICAL service command.
func TestRedistributionSaveHandler_ForgedRecordsIgnored(t *testing.T) {
	forge := func(records string) string {
		return fmt.Sprintf(`{
			"tender_id": %q, "markup_tactic_id": %q,
			"records": %s,
			"created_by": "99999999-9999-9999-9999-999999999999",
			"rules": {
				"deductions": [{"level":"detail","detail_cost_category_id":"33333333-3333-3333-3333-333333333333","percentage":10}],
				"targets": [{"level":"detail","detail_cost_category_id":"44444444-4444-4444-4444-444444444444"}]
			}
		}`, rTender, rTactic, records)
	}
	forged1 := forge(`[{"boq_item_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","original_work_cost":777,"deducted_amount":888888,"added_amount":999999,"final_work_cost":-123}]`)
	forged2 := forge(`[{"boq_item_id":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","original_work_cost":"мусор","final_work_cost":{"nested":true}}]`)

	svc1 := &stubRedistributionSvc{out: okStubOutput()}
	w1 := doRedistributionSave(t, svc1, forged1)
	svc2 := &stubRedistributionSvc{out: okStubOutput()}
	w2 := doRedistributionSave(t, svc2, forged2)

	if w1.Code != 200 || w2.Code != 200 {
		t.Fatalf("legacy payloads must stay accepted: %d / %d", w1.Code, w2.Code)
	}
	// Identical service command regardless of the forged records.
	r1, _ := json.Marshal(svc1.gotRules)
	r2, _ := json.Marshal(svc2.gotRules)
	if string(r1) != string(r2) {
		t.Fatalf("forged records leaked into the command: %s vs %s", r1, r2)
	}
	// §17.5 — actor from the auth context, not from created_by in the body.
	if svc1.gotCreatedBy != "user-1" || svc2.gotCreatedBy != "user-1" {
		t.Fatalf("actor must come from JWT, got %q/%q", svc1.gotCreatedBy, svc2.gotCreatedBy)
	}
	// Identical responses too.
	if w1.Body.String() != w2.Body.String() {
		t.Fatal("responses differ for identical rules with different forged records")
	}
}

// wrappedR mimics the repository → service %w chain.
func wrappedR(e error) error {
	return fmt.Errorf("redistributionService.Save: %w",
		fmt.Errorf("redistributionRepo.SaveAuthoritative: %w", e))
}

// §17.6 — tactic mismatch → 409 REDISTRIBUTION_TACTIC_MISMATCH.
func TestRedistributionSaveHandler_TacticMismatch409(t *testing.T) {
	svc := &stubRedistributionSvc{err: wrappedR(&calc.RedistributionTacticMismatchError{
		TenderID: rTender, RequestedTacticID: rTactic, ActiveTacticID: "other",
	})}
	w := doRedistributionSave(t, svc, rulesOnlyBody())
	if w.Code != 409 {
		t.Fatalf("status = %d, want 409", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "REDISTRIBUTION_TACTIC_MISMATCH" {
		t.Fatalf("code = %v", m["code"])
	}
}

// §17.7 — missing FX keeps its 400 MISSING_FX_RATE mapping.
func TestRedistributionSaveHandler_MissingFX400(t *testing.T) {
	svc := &stubRedistributionSvc{err: wrappedR(&calc.MissingFXRateError{Currency: "USD"})}
	w := doRedistributionSave(t, svc, rulesOnlyBody())
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if m := decodeProblem(t, w); m["code"] != "MISSING_FX_RATE" {
		t.Fatalf("code = %v", m["code"])
	}
}

// §17.8 — invalid rules → 400 with the issues array.
func TestRedistributionSaveHandler_InvalidRules400(t *testing.T) {
	svc := &stubRedistributionSvc{err: wrappedR(&calc.InvalidRedistributionRulesError{
		Issues: []calc.RuleIssue{{Field: "deductions[0].percentage", Code: "PERCENTAGE_OUT_OF_RANGE", Message: "…"}},
	})}
	w := doRedistributionSave(t, svc, rulesOnlyBody())
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "INVALID_REDISTRIBUTION_RULES" {
		t.Fatalf("code = %v", m["code"])
	}
	issues, ok := m["issues"].([]any)
	if !ok || len(issues) != 1 {
		t.Fatalf("issues missing: %v", m["issues"])
	}
	first, _ := issues[0].(map[string]any)
	if first["field"] != "deductions[0].percentage" || first["code"] != "PERCENTAGE_OUT_OF_RANGE" {
		t.Fatalf("issue shape wrong: %v", first)
	}
}

// §17.9 — unbalanced output → 409, never persisted as success.
func TestRedistributionSaveHandler_Unbalanced409(t *testing.T) {
	svc := &stubRedistributionSvc{err: wrappedR(&calc.UnbalancedRedistributionError{
		TotalDeducted: 100, TotalAdded: 50,
	})}
	w := doRedistributionSave(t, svc, rulesOnlyBody())
	if w.Code != 409 {
		t.Fatalf("status = %d, want 409", w.Code)
	}
	if m := decodeProblem(t, w); m["code"] != "REDISTRIBUTION_UNBALANCED" {
		t.Fatalf("code = %v", m["code"])
	}
}

// No BOQ items → 400 REDISTRIBUTION_NO_BOQ_ITEMS.
func TestRedistributionSaveHandler_NoBoqItems400(t *testing.T) {
	svc := &stubRedistributionSvc{err: wrappedR(&calc.RedistributionNoBoqItemsError{TenderID: rTender})}
	w := doRedistributionSave(t, svc, rulesOnlyBody())
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	if m := decodeProblem(t, w); m["code"] != "REDISTRIBUTION_NO_BOQ_ITEMS" {
		t.Fatalf("code = %v", m["code"])
	}
}
