package handlers

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type actionPlanServicer interface {
	TenderActionPlan(ctx context.Context, tenderID string, periodMonths, maxAgeDays int) (*ap.Report, error)
}

// ActionPlanHandler — GET /api/v1/tenders/{id}/action-plan (read-only, без
// mutation endpoints для action items).
type ActionPlanHandler struct {
	svc actionPlanServicer
}

// NewActionPlanHandler creates an ActionPlanHandler.
func NewActionPlanHandler(svc actionPlanServicer) *ActionPlanHandler {
	return &ActionPlanHandler{svc: svc}
}

// TenderActionPlan — единый план действий. Summary считается по полному
// набору действий ПОСЛЕ substantive-фильтров (priority/source/category/
// position/search), но ДО пагинации (§11).
func (h *ActionPlanHandler) TenderActionPlan(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	period := pb.DefaultPeriodMonths
	if raw := r.URL.Query().Get("benchmark_period_months"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || !containsInt(pb.AllowedPeriods, v) {
			apierr.BadRequest("benchmark_period_months must be one of 6, 12, 24, 36").Render(w)
			return
		}
		period = v
	}
	maxAge := ps.DefaultMaxAgeDays
	if raw := r.URL.Query().Get("source_max_age_days"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || !containsInt(ps.AllowedMaxAgeDays, v) {
			apierr.BadRequest("source_max_age_days must be one of 30, 60, 90, 180, 365").Render(w)
			return
		}
		maxAge = v
	}

	report, err := h.svc.TenderActionPlan(r.Context(), tenderID, period, maxAge)
	if err != nil {
		if errors.Is(err, repository.ErrQualityTenderNotFound) {
			apierr.NotFound("tender not found").Render(w)
			return
		}
		// Внутренняя ошибка компонента НЕ маскируется пустым «всё чисто» (§9).
		apierr.InternalFromErr(w, r, err, "failed to build action plan", "tender_id", tenderID)
		return
	}

	actions := filterActions(report.Actions, r)
	// Summary по отфильтрованному набору, до пагинации (§11); контекстные
	// счётчики остаются глобальными.
	summary := ap.Summarize(actions, report.ItemAmounts, report.AmountAvailable)
	summary.PriceItemsWithinRange = report.Summary.PriceItemsWithinRange
	summary.PriceItemsInsufficientHistory = report.Summary.PriceItemsInsufficientHistory
	summary.PriceSourcesFresh = report.Summary.PriceSourcesFresh
	summary.PriceSourcesNotApplicable = report.Summary.PriceSourcesNotApplicable

	sortActionsBy(actions, r.URL.Query().Get("sort"))

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > 200 {
		pageSize = 200
	}
	total := len(actions)
	from := (page - 1) * pageSize
	if from > total {
		from = total
	}
	to := from + pageSize
	if to > total {
		to = total
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: map[string]any{
		"tender_id":                      report.TenderID,
		"financial_input_revision":       report.FinancialInputRevision,
		"financial_calculation_revision": report.FinancialCalculationRevision,
		"financial_calculation_status":   report.FinancialCalculationStatus,
		"generated_at":                   report.GeneratedAt,
		"as_of_date":                     report.AsOfDate,
		"benchmark_period_months":        report.BenchmarkPeriodMonths,
		"source_max_age_days":            report.SourceMaxAgeDays,
		"components":                     report.Components,
		"summary":                        summary,
		"actions":                        actions[from:to],
		"pagination":                     map[string]int{"page": page, "page_size": pageSize, "total": total},
	}})
}

func containsInt(list []int, v int) bool {
	for _, a := range list {
		if a == v {
			return true
		}
	}
	return false
}

func filterActions(actions []ap.Action, r *http.Request) []ap.Action {
	q := r.URL.Query()
	priority := q.Get("priority")
	source := q.Get("source")
	category := q.Get("category")
	posID := q.Get("position_id")
	search := strings.ToLower(strings.TrimSpace(q.Get("search")))

	out := make([]ap.Action, 0, len(actions))
	for _, a := range actions {
		if priority != "" && priority != "all" && a.Priority != priority {
			continue
		}
		if source != "" && source != "all" && !containsStr(a.Sources, source) {
			continue
		}
		if category != "" && a.Category != category {
			continue
		}
		if posID != "" && (a.ClientPositionID == nil || *a.ClientPositionID != posID) {
			continue
		}
		if search != "" {
			hay := strings.ToLower(a.Title + " " + a.Reason + " " + a.RecommendedAction + " " + a.Code)
			if !strings.Contains(hay, search) {
				continue
			}
		}
		out = append(out, a)
	}
	return out
}

func containsStr(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// sortActionsBy — фронт не пересчитывает server rank; допустимые режимы
// детерминированы, дефолт recommended = порядок движка (rank).
func sortActionsBy(actions []ap.Action, mode string) {
	switch mode {
	case "amount_desc":
		sort.SliceStable(actions, func(i, j int) bool {
			ia, ib := actions[i].ImpactAmount, actions[j].ImpactAmount
			if (ia != nil) != (ib != nil) {
				return ia != nil
			}
			if ia != nil && *ia != *ib {
				return *ia > *ib
			}
			return actions[i].Rank < actions[j].Rank
		})
	case "position":
		sort.SliceStable(actions, func(i, j int) bool {
			pa, pb := "", ""
			if actions[i].ClientPositionID != nil {
				pa = *actions[i].ClientPositionID
			}
			if actions[j].ClientPositionID != nil {
				pb = *actions[j].ClientPositionID
			}
			if (pa != "") != (pb != "") {
				return pa != "" // tender-level в конец
			}
			if pa != pb {
				return pa < pb
			}
			return actions[i].Rank < actions[j].Rank
		})
	case "", "recommended":
		// порядок движка (rank 1..N) уже установлен
	}
}
