package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 1.1 §12 (handler-слой): auth, 404, envelope с revision/status.

type stubQualitySvc struct {
	report *quality.Report
	err    error
}

func (s *stubQualitySvc) TenderQuality(context.Context, string) (*quality.Report, error) {
	return s.report, s.err
}

func qualityReq(t *testing.T, authed bool) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/22222222-2222-2222-2222-222222222222/quality", nil)
	ctx := r.Context()
	if authed {
		ctx = authedTenderReq(t, http.MethodGet, "/x", "").Context()
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "22222222-2222-2222-2222-222222222222")
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

func TestQualityAnalyticsHandler_AuthorizedGetsDashboard(t *testing.T) {
	svc := &stubQualitySvc{report: &quality.Report{
		TenderID:                     "22222222-2222-2222-2222-222222222222",
		FinancialInputRevision:       7,
		FinancialCalculationRevision: 7,
		FinancialCalculationStatus:   "calculated",
		GeneratedAt:                  "2026-07-14T00:00:00Z",
		Issues:                       []quality.Issue{},
		Categories:                   []quality.CategorySummary{},
	}}
	h := NewQualityAnalyticsHandler(svc)
	w := httptest.NewRecorder()
	h.TenderQuality(w, qualityReq(t, true))
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d\n%s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			FinancialInputRevision     int64  `json:"financial_input_revision"`
			FinancialCalculationStatus string `json:"financial_calculation_status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	// §12.4 — ответ несёт revision/status (frontend знает версию аналитики).
	if resp.Data.FinancialInputRevision != 7 || resp.Data.FinancialCalculationStatus != "calculated" {
		t.Fatalf("revision/status lost: %s", w.Body.String())
	}
}

func TestQualityAnalyticsHandler_Unauthorized(t *testing.T) {
	h := NewQualityAnalyticsHandler(&stubQualitySvc{})
	w := httptest.NewRecorder()
	h.TenderQuality(w, qualityReq(t, false))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestQualityAnalyticsHandler_NotFound(t *testing.T) {
	svc := &stubQualitySvc{err: fmt.Errorf("qualityService.TenderQuality: %w", repository.ErrQualityTenderNotFound)}
	h := NewQualityAnalyticsHandler(svc)
	w := httptest.NewRecorder()
	h.TenderQuality(w, qualityReq(t, true))
	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404\n%s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "qualityService") {
		t.Fatal("internal error text leaked")
	}
}
