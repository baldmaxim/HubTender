package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	rp "github.com/su10/hubtender/backend/internal/analytics/reviewpack"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 1.6 §24.C/L (handler-слой): auth, 409-код, заголовки скачивания.

type stubReviewSvc struct {
	model *rp.Model
	data  []byte
	fname string
	err   error
}

func (s *stubReviewSvc) TenderReviewModel(context.Context, string, int, int, string) (*rp.Model, error) {
	return s.model, s.err
}
func (s *stubReviewSvc) TenderReviewXLSX(context.Context, string, int, int, string) ([]byte, string, error) {
	return s.data, s.fname, s.err
}

func rpReq(t *testing.T, authed bool, path string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, path, nil)
	ctx := r.Context()
	if authed {
		ctx = context.WithValue(ctx, middleware.CtxUser, &middleware.AuthUser{ID: "u1"})
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "55555555-5555-5555-5555-555555555555")
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

func TestReviewPackHandler_Unauthorized(t *testing.T) {
	h := NewReviewPackHandler(&stubReviewSvc{})
	w := httptest.NewRecorder()
	h.TenderReviewReport(w, rpReq(t, false, "/api/v1/tenders/x/review-report"))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", w.Code)
	}
}

func TestReviewPackHandler_NotReady409(t *testing.T) {
	h := NewReviewPackHandler(&stubReviewSvc{err: &repository.FinancialCalculationNotReadyError{
		TenderID: "T", CalculationStatus: "stale", Reason: "CALCULATION_STALE"}})
	w := httptest.NewRecorder()
	h.TenderReviewReportXLSX(w, rpReq(t, true, "/api/v1/tenders/x/review-report.xlsx"))
	if w.Code != http.StatusConflict || !strings.Contains(w.Body.String(), "REVIEW_REPORT_CALCULATION_NOT_READY") {
		t.Fatalf("want 409 REVIEW_REPORT_CALCULATION_NOT_READY: %d %s", w.Code, w.Body.String())
	}
}

func TestReviewPackHandler_XLSXHeadersAndPreviewURL(t *testing.T) {
	model := rp.Build(rp.Inputs{Metadata: rp.Metadata{TenderID: "T", TenderNumber: "TN"}})
	h := NewReviewPackHandler(&stubReviewSvc{
		model: model, data: []byte("PK\x03\x04fake"), fname: "Tender_TN_v1_Review_2026-07-15.xlsx",
	})
	w := httptest.NewRecorder()
	h.TenderReviewReportXLSX(w, rpReq(t, true, "/api/v1/tenders/x/review-report.xlsx?benchmark_period_months=12"))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "spreadsheetml") {
		t.Fatalf("content-type=%q", ct)
	}
	cd := w.Header().Get("Content-Disposition")
	if !strings.Contains(cd, "attachment") || !strings.Contains(cd, "filename*=UTF-8''") {
		t.Fatalf("content-disposition=%q", cd)
	}
	if cc := w.Header().Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Fatalf("cache-control=%q", cc)
	}

	w2 := httptest.NewRecorder()
	h.TenderReviewReport(w2, rpReq(t, true, "/api/v1/tenders/x/review-report?benchmark_period_months=12"))
	if w2.Code != http.StatusOK || !strings.Contains(w2.Body.String(), "review-report.xlsx?benchmark_period_months=12") {
		t.Fatalf("preview must carry download_url: %d %s", w2.Code, w2.Body.String())
	}
}

func TestReviewPackHandler_BadParams(t *testing.T) {
	h := NewReviewPackHandler(&stubReviewSvc{})
	for _, q := range []string{"?benchmark_period_months=13", "?source_max_age_days=45"} {
		w := httptest.NewRecorder()
		h.TenderReviewReport(w, rpReq(t, true, "/api/v1/tenders/x/review-report"+q))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status=%d, want 400", q, w.Code)
		}
	}
}
