package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 1.5 §18.K/L (handler-слой): auth, 409-коды, фильтры/пагинация/sort,
// filtered_summary отдельно от общей summary (§15).

type stubChangeImpactSvc struct {
	report *ci.Report
	err    error
}

func (s *stubChangeImpactSvc) TenderChangeImpact(context.Context, string, string) (*ci.Report, error) {
	return s.report, s.err
}

func ciReq(t *testing.T, authed bool, query string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/44444444-4444-4444-4444-444444444444/change-impact"+query, nil)
	ctx := r.Context()
	if authed {
		ctx = context.WithValue(ctx, middleware.CtxUser, &middleware.AuthUser{ID: "u1"})
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "44444444-4444-4444-4444-444444444444")
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

func ciStubReport() *ci.Report {
	sp := func(s string) *string { return &s }
	items := []ci.ItemDiff{
		{ID: "row:b1>c1", Status: ci.StatusModified, Label: "Бетон", PositionLabel: "№1",
			ClientPositionID: sp("p1"), CurrentItemID: sp("c1"), BaselineItemID: sp("b1"),
			Direct: ci.MoneyPair{Delta: 100}, Commercial: ci.MoneyPair{Delta: 110}, Direction: "increase"},
		{ID: "cur:c2", Status: ci.StatusAdded, Label: "Арматура", PositionLabel: "№1",
			ClientPositionID: sp("p1"), CurrentItemID: sp("c2"),
			Direct: ci.MoneyPair{Delta: 50}, Commercial: ci.MoneyPair{Delta: 55}, Direction: "increase"},
		{ID: "base:b3", Status: ci.StatusRemoved, Label: "Опалубка", PositionLabel: "№2",
			BaselineItemID: sp("b3"),
			Direct:         ci.MoneyPair{Delta: -30}, Commercial: ci.MoneyPair{Delta: -33}, Direction: "decrease"},
	}
	return &ci.Report{
		Status:  ci.ReportOK,
		Current: ci.VersionMeta{TenderID: "T2", Version: 2},
		Summary: ci.Summary{GrandTotalDelta: 132, IsReconciled: true},
		Items:   items,
	}
}

func TestChangeImpactHandler_Unauthorized(t *testing.T) {
	h := NewChangeImpactHandler(&stubChangeImpactSvc{})
	w := httptest.NewRecorder()
	h.TenderChangeImpact(w, ciReq(t, false, ""))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status=%d, want 401", w.Code)
	}
}

func TestChangeImpactHandler_ConflictCodes(t *testing.T) {
	h := NewChangeImpactHandler(&stubChangeImpactSvc{err: &repository.FinancialCalculationNotReadyError{
		TenderID: "T", CalculationStatus: "stale", Reason: "CALCULATION_STALE"}})
	w := httptest.NewRecorder()
	h.TenderChangeImpact(w, ciReq(t, true, ""))
	if w.Code != http.StatusConflict || !contains(w.Body.String(), "CHANGE_IMPACT_CALCULATION_NOT_READY") {
		t.Fatalf("current not-ready: %d %s", w.Code, w.Body.String())
	}
	h = NewChangeImpactHandler(&stubChangeImpactSvc{err: &repository.ChangeImpactBaselineNotReadyError{
		TenderID: "B", Reason: "BASELINE_NOT_APPROVED"}})
	w = httptest.NewRecorder()
	h.TenderChangeImpact(w, ciReq(t, true, "?baseline_tender_id=B"))
	if w.Code != http.StatusConflict || !contains(w.Body.String(), "CHANGE_IMPACT_BASELINE_NOT_READY") {
		t.Fatalf("baseline not-ready: %d %s", w.Code, w.Body.String())
	}
}

type ciResp struct {
	Data struct {
		Summary         ci.Summary         `json:"summary"`
		FilteredSummary ci.FilteredSummary `json:"filtered_summary"`
		Items           []ci.ItemDiff      `json:"items"`
		Pagination      map[string]int     `json:"pagination"`
	} `json:"data"`
}

func doCI(t *testing.T, query string) ciResp {
	t.Helper()
	h := NewChangeImpactHandler(&stubChangeImpactSvc{report: ciStubReport()})
	w := httptest.NewRecorder()
	h.TenderChangeImpact(w, ciReq(t, true, query))
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d\n%s", w.Code, w.Body.String())
	}
	var resp ciResp
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad json: %v", err)
	}
	return resp
}

// L — фильтры/пагинация/sort; §15 — filtered_summary отдельно, общая summary
// не подменяется отфильтрованной.
func TestChangeImpactHandler_FiltersPaginationSort(t *testing.T) {
	resp := doCI(t, "?status=added")
	if len(resp.Data.Items) != 1 || resp.Data.Items[0].ID != "cur:c2" {
		t.Fatalf("status filter wrong: %+v", resp.Data.Items)
	}
	if resp.Data.FilteredSummary.FilteredItems != 1 || resp.Data.FilteredSummary.FilteredCommercialDelta != 55 {
		t.Fatalf("filtered summary wrong: %+v", resp.Data.FilteredSummary)
	}
	if resp.Data.Summary.GrandTotalDelta != 132 {
		t.Fatal("global summary must not be replaced by filtered one")
	}

	resp = doCI(t, "?search=опалубка")
	if len(resp.Data.Items) != 1 || resp.Data.Items[0].ID != "base:b3" {
		t.Fatalf("search wrong: %+v", resp.Data.Items)
	}

	resp = doCI(t, "?page=2&page_size=2")
	if resp.Data.Pagination["total"] != 3 || len(resp.Data.Items) != 1 {
		t.Fatalf("pagination wrong: %+v", resp.Data.Pagination)
	}

	resp = doCI(t, "?sort=impact_asc")
	if resp.Data.Items[0].ID != "base:b3" { // |−33| < |55| < |110|
		t.Fatalf("impact_asc wrong: %s", resp.Data.Items[0].ID)
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(sub) == 0 ||
		(func() bool {
			for i := 0; i+len(sub) <= len(s); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
			return false
		})())
}
