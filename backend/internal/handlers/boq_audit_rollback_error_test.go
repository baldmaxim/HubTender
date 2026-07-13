package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0.1.2.2b (§14 D): the rollback handler maps every typed domain error to
// its RFC 7807 response through the repository → service %w chain — never a
// generic 500 — and the command contract carries ONLY the audit id (no client
// snapshot can reach the service).

type stubRollbackSvc struct {
	err          error
	res          *repository.BoqAuditRollbackResult
	gotAuditID   string
	gotChangedBy string
}

func (s *stubRollbackSvc) Rollback(_ context.Context, auditID, changedBy string) (*repository.BoqAuditRollbackResult, error) {
	s.gotAuditID, s.gotChangedBy = auditID, changedBy
	if s.err != nil {
		return nil, s.err
	}
	return s.res, nil
}

func (s *stubRollbackSvc) ListByPosition(context.Context, repository.BoqAuditListFilter) ([]repository.BoqAuditRow, error) {
	panic("not used")
}

// doRollback fires POST /api/v1/boq-audit/{auditId}/rollback with an auth user
// and an optional request body.
func doRollback(t *testing.T, svc boqAuditRollbackServicer, body string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewBoqAuditRollbackHandler(svc)

	r := chi.NewRouter()
	r.Post("/api/v1/boq-audit/{auditId}/rollback", h.Rollback)

	req := httptest.NewRequest("POST", "/api/v1/boq-audit/audit-1/rollback", strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.CtxUser,
		&middleware.AuthUser{ID: "user-1"}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeProblem(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if ct := w.Header().Get("Content-Type"); ct != "application/problem+json" {
		t.Fatalf("content-type = %q, want application/problem+json", ct)
	}
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("body not JSON: %v", err)
	}
	return m
}

// wrapped mimics the exact repository → service %w chain.
func wrapped(e error) error {
	return fmt.Errorf("boqAuditRollbackService.Rollback: %w",
		fmt.Errorf("boqAuditRollbackRepo: %w", e))
}

// §14.19 — INVALID_BOQ_AUDIT_SNAPSHOT → RFC 7807 400.
func TestRollbackHandler_InvalidSnapshot_RFC7807(t *testing.T) {
	svc := &stubRollbackSvc{err: wrapped(&repository.InvalidBoqAuditSnapshotError{
		AuditID: "audit-1", ItemID: "item-1", Field: "quantity", Reason: repository.InvalidFieldType,
	})}
	w := doRollback(t, svc, "")
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "INVALID_BOQ_AUDIT_SNAPSHOT" {
		t.Fatalf("code = %v", m["code"])
	}
	if m["reason"] != "INVALID_FIELD_TYPE" || m["field"] != "quantity" {
		t.Fatalf("reason/field = %v/%v", m["reason"], m["field"])
	}
}

// §14.20 — BOQ_AUDIT_TARGET_MISMATCH → RFC 7807 409 WITHOUT leaking the other
// tender's identifiers.
func TestRollbackHandler_TargetMismatch_NoForeignDataLeak(t *testing.T) {
	svc := &stubRollbackSvc{err: wrapped(&repository.BoqAuditTargetMismatchError{
		AuditID:        "audit-1",
		ExpectedItemID: "item-A", ActualItemID: "item-B",
		ExpectedTenderID: "tender-SECRET", ActualTenderID: "tender-CURRENT",
	})}
	w := doRollback(t, svc, "")
	if w.Code != 409 {
		t.Fatalf("status = %d, want 409", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "BOQ_AUDIT_TARGET_MISMATCH" {
		t.Fatalf("code = %v", m["code"])
	}
	body := w.Body.String()
	for _, leak := range []string{"tender-SECRET", "tender-CURRENT", "item-A", "item-B"} {
		if strings.Contains(body, leak) {
			t.Fatalf("response leaks foreign identifier %q: %s", leak, body)
		}
	}
}

// §14.21 — UNSUPPORTED_BOQ_AUDIT_ROLLBACK → RFC 7807 400.
func TestRollbackHandler_Unsupported_RFC7807(t *testing.T) {
	svc := &stubRollbackSvc{err: wrapped(&repository.UnsupportedBoqAuditRollbackError{
		AuditID: "audit-1", Operation: "INSERT",
	})}
	w := doRollback(t, svc, "")
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "UNSUPPORTED_BOQ_AUDIT_ROLLBACK" || m["operation"] != "INSERT" {
		t.Fatalf("code/operation = %v/%v", m["code"], m["operation"])
	}
}

// §14.22 — MISSING_FX_RATE keeps its existing RFC 7807 mapping.
func TestRollbackHandler_MissingFX_RFC7807(t *testing.T) {
	svc := &stubRollbackSvc{err: wrapped(&calc.MissingFXRateError{Currency: "USD"})}
	w := doRollback(t, svc, "")
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "MISSING_FX_RATE" || m["currency"] != "USD" {
		t.Fatalf("code/currency = %v/%v", m["code"], m["currency"])
	}
}

// §14.23 — INVALID_BOQ_PARENT keeps its existing RFC 7807 mapping.
func TestRollbackHandler_InvalidParent_RFC7807(t *testing.T) {
	svc := &stubRollbackSvc{err: wrapped(&repository.InvalidBoqParentError{
		ItemID: "item-1", ParentItemID: "parent-1", Reason: repository.BoqParentNotFound,
	})}
	w := doRollback(t, svc, "")
	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "INVALID_BOQ_PARENT" || m["reason"] != "PARENT_NOT_FOUND" {
		t.Fatalf("code/reason = %v/%v", m["code"], m["reason"])
	}
}

// §14.24 / §13.14 — the client cannot smuggle a snapshot/patch: any request
// body (including derived fields) is ignored; only the audit id and the JWT
// user reach the service.
func TestRollbackHandler_ClientBodyIgnored(t *testing.T) {
	svc := &stubRollbackSvc{res: &repository.BoqAuditRollbackResult{
		ItemID: "item-1", TenderID: "tender-1", Operation: "UPDATE",
	}}
	malicious := `{"before_data":{"total_amount":999999},"total_amount":123,"commercial_markup":777}`
	w := doRollback(t, svc, malicious)
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	if svc.gotAuditID != "audit-1" || svc.gotChangedBy != "user-1" {
		t.Fatalf("service received (%q,%q); the command must carry ONLY audit id + JWT user",
			svc.gotAuditID, svc.gotChangedBy)
	}
}

// 404 policy for a missing audit record is preserved.
func TestRollbackHandler_AuditNotFound_404(t *testing.T) {
	svc := &stubRollbackSvc{err: wrapped(&repository.ErrAuditRollback{
		HTTPStatus: 404, Message: "audit record not found",
	})}
	w := doRollback(t, svc, "")
	if w.Code != 404 {
		t.Fatalf("status = %d, want 404", w.Code)
	}
}
