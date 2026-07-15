package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	"github.com/su10/hubtender/backend/internal/middleware"
)

// Этап 1.4 §17.G/I (handler-слой): auth, фильтры/пагинация/sort, summary после
// substantive-фильтров, 400 на недопустимые параметры.

type stubActionPlanSvc struct {
	report *ap.Report
	err    error
}

func (s *stubActionPlanSvc) TenderActionPlan(context.Context, string, int, int) (*ap.Report, error) {
	return s.report, s.err
}

func planReq(t *testing.T, authed bool, query string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/33333333-3333-3333-3333-333333333333/action-plan"+query, nil)
	ctx := r.Context()
	if authed {
		ctx = context.WithValue(ctx, middleware.CtxUser, &middleware.AuthUser{ID: "u1"})
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "33333333-3333-3333-3333-333333333333")
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

func planStubReport() *ap.Report {
	sp := func(s string) *string { return &s }
	fp := func(v float64) *float64 { return &v }
	actions := []ap.Action{
		{ID: "q1", Rank: 1, Priority: ap.PriorityBlocking, Source: ap.SourceQuality,
			Sources: []string{ap.SourceQuality}, Code: "CALCULATION_STALE", Category: "CALCULATION_STATE",
			EntityType: "tender", EntityID: "T", Title: "stale", ImpactAmountStatus: "unavailable"},
		{ID: "b1", Rank: 2, Priority: ap.PriorityHigh, Source: ap.SourcePriceBenchmark,
			Sources: []string{ap.SourcePriceBenchmark}, Code: "HIGH_OUTLIER", Category: "PRICE_DEVIATION",
			EntityType: "boq_item", EntityID: "i1", ClientPositionID: sp("p1"), BoqItemIDs: []string{"i1"},
			Title: "outlier", ImpactAmount: fp(500), ImpactAmountStatus: "available", AffectedItemsCount: 1},
		{ID: "s1", Rank: 3, Priority: ap.PriorityNormal, Source: ap.SourcePriceSource,
			Sources: []string{ap.SourcePriceSource}, Code: "STALE", Category: "PRICE_SOURCE",
			EntityType: "boq_item", EntityID: "i2", ClientPositionID: sp("p2"), BoqItemIDs: []string{"i2"},
			Title: "источник", ImpactAmount: fp(100), ImpactAmountStatus: "available", AffectedItemsCount: 1},
	}
	return &ap.Report{
		TenderID: "T", FinancialInputRevision: 3, FinancialCalculationRevision: 3,
		FinancialCalculationStatus: "calculated", GeneratedAt: "2026-07-14T00:00:00Z",
		AsOfDate: "2026-07-14", BenchmarkPeriodMonths: 24, SourceMaxAgeDays: 90,
		Actions:         actions,
		ItemAmounts:     map[string]float64{"i1": 500, "i2": 100},
		AmountAvailable: true,
	}
}

type planResp struct {
	Data struct {
		Summary struct {
			ActionsTotal          int      `json:"actions_total"`
			HighActions           int      `json:"high_actions"`
			AmountRequiringReview *float64 `json:"amount_requiring_review"`
		} `json:"summary"`
		Actions    []ap.Action    `json:"actions"`
		Pagination map[string]int `json:"pagination"`
	} `json:"data"`
}

func doPlan(t *testing.T, query string) planResp {
	t.Helper()
	h := NewActionPlanHandler(&stubActionPlanSvc{report: planStubReport()})
	w := httptest.NewRecorder()
	h.TenderActionPlan(w, planReq(t, true, query))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d\n%s", w.Code, w.Body.String())
	}
	var resp planResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	return resp
}

// G — без auth-контекста → 401.
func TestActionPlanHandler_Unauthorized(t *testing.T) {
	h := NewActionPlanHandler(&stubActionPlanSvc{})
	w := httptest.NewRecorder()
	h.TenderActionPlan(w, planReq(t, false, ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", w.Code)
	}
}

// I — priority-фильтр сжимает и список, и summary (после фильтров, до пагинации).
func TestActionPlanHandler_PriorityFilterAffectsSummary(t *testing.T) {
	resp := doPlan(t, "?priority=high")
	if len(resp.Data.Actions) != 1 || resp.Data.Actions[0].Code != "HIGH_OUTLIER" {
		t.Fatalf("filtered actions wrong: %+v", resp.Data.Actions)
	}
	if resp.Data.Summary.ActionsTotal != 1 || resp.Data.Summary.HighActions != 1 {
		t.Fatalf("summary must follow substantive filters: %+v", resp.Data.Summary)
	}
	if resp.Data.Summary.AmountRequiringReview == nil || *resp.Data.Summary.AmountRequiringReview != 500 {
		t.Fatalf("filtered amount=%v, want 500", resp.Data.Summary.AmountRequiringReview)
	}
}

// I — source/search-фильтры и пагинация.
func TestActionPlanHandler_SourceSearchPagination(t *testing.T) {
	if resp := doPlan(t, "?source=price_source"); len(resp.Data.Actions) != 1 || resp.Data.Actions[0].ID != "s1" {
		t.Fatalf("source filter wrong: %+v", resp.Data.Actions)
	}
	if resp := doPlan(t, "?search=источник"); len(resp.Data.Actions) != 1 || resp.Data.Actions[0].ID != "s1" {
		t.Fatalf("search wrong: %+v", resp.Data.Actions)
	}
	resp := doPlan(t, "?page=2&page_size=2")
	if resp.Data.Pagination["total"] != 3 || len(resp.Data.Actions) != 1 || resp.Data.Actions[0].ID != "s1" {
		t.Fatalf("pagination wrong: %+v %+v", resp.Data.Pagination, resp.Data.Actions)
	}
}

// I — amount_desc sort: известные суммы по убыванию, неизвестные в конце.
func TestActionPlanHandler_AmountSort(t *testing.T) {
	resp := doPlan(t, "?sort=amount_desc")
	if resp.Data.Actions[0].ID != "b1" || resp.Data.Actions[1].ID != "s1" || resp.Data.Actions[2].ID != "q1" {
		t.Fatalf("amount sort wrong: %s %s %s",
			resp.Data.Actions[0].ID, resp.Data.Actions[1].ID, resp.Data.Actions[2].ID)
	}
}

// 400 на недопустимые параметры.
func TestActionPlanHandler_BadParams(t *testing.T) {
	h := NewActionPlanHandler(&stubActionPlanSvc{report: planStubReport()})
	for _, q := range []string{"?benchmark_period_months=13", "?source_max_age_days=45"} {
		w := httptest.NewRecorder()
		h.TenderActionPlan(w, planReq(t, true, q))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("%s: status=%d, want 400", q, w.Code)
		}
	}
}
