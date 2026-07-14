package handlers

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// priceBenchmarkServicer — граница сервиса.
type priceBenchmarkServicer interface {
	TenderPriceBenchmarks(ctx context.Context, tenderID string, periodMonths int) (*pb.Report, error)
	ItemHistory(ctx context.Context, tenderID, boqItemID string, periodMonths, limit int) (*pb.ItemBenchmark, []pb.Observation, error)
}

// PriceBenchmarkHandler — GET /api/v1/tenders/{id}/price-benchmarks[…/history].
type PriceBenchmarkHandler struct {
	svc priceBenchmarkServicer
}

// NewPriceBenchmarkHandler creates a PriceBenchmarkHandler.
func NewPriceBenchmarkHandler(svc priceBenchmarkServicer) *PriceBenchmarkHandler {
	return &PriceBenchmarkHandler{svc: svc}
}

const maxPageSize = 200

func parsePeriod(r *http.Request) (int, bool) {
	raw := r.URL.Query().Get("period_months")
	if raw == "" {
		return pb.DefaultPeriodMonths, true
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return 0, false
	}
	for _, p := range pb.AllowedPeriods {
		if v == p {
			return v, true
		}
	}
	return 0, false
}

func (h *PriceBenchmarkHandler) renderErr(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, repository.ErrQualityTenderNotFound) {
		apierr.NotFound("not found").Render(w)
		return
	}
	var notReady *repository.FinancialCalculationNotReadyError
	if errors.As(err, &notReady) {
		// §8: fail-closed — benchmark по неактуальному расчёту не строится.
		apierr.FinancialCalculationNotReady(
			notReady.CalculationStatus, notReady.InputRevision,
			notReady.CalculationRevision, notReady.Reason).Render(w)
		return
	}
	apierr.InternalFromErr(w, r, err, "failed to build price benchmark")
}

// TenderPriceBenchmarks — основной endpoint: фильтры/сортировка/пагинация
// поверх готового отчёта (никаких запросов на строку — §12).
func (h *PriceBenchmarkHandler) TenderPriceBenchmarks(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	period, ok := parsePeriod(r)
	if !ok {
		apierr.BadRequest("period_months must be one of 6, 12, 24, 36").Render(w)
		return
	}

	report, err := h.svc.TenderPriceBenchmarks(r.Context(), tenderID, period)
	if err != nil {
		h.renderErr(w, r, err)
		return
	}

	items := filterBenchmarkItems(report.Items, r)
	sortBenchmarkItems(items, r.URL.Query().Get("sort"))

	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if pageSize < 1 {
		pageSize = 50
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	total := len(items)
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
		"period_months":                  report.PeriodMonths,
		"generated_at":                   report.GeneratedAt,
		"summary":                        report.Summary,
		"items":                          items[from:to],
		"pagination": map[string]int{
			"page": page, "page_size": pageSize, "total": total,
		},
	}})
}

// ItemHistory — detail endpoint (наблюдения по строке, limit ≤ 50).
func (h *PriceBenchmarkHandler) ItemHistory(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	boqItemID := chi.URLParam(r, "itemId")
	if tenderID == "" || boqItemID == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	period, ok := parsePeriod(r)
	if !ok {
		apierr.BadRequest("period_months must be one of 6, 12, 24, 36").Render(w)
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 50 {
		limit = 50
	}
	item, obs, err := h.svc.ItemHistory(r.Context(), tenderID, boqItemID, period, limit)
	if err != nil {
		h.renderErr(w, r, err)
		return
	}
	if obs == nil {
		obs = []pb.Observation{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: map[string]any{
		"item":         item,
		"observations": obs,
		"methodology":  "Историческая прямая стоимость за единицу (authoritative total_amount / quantity), включая действующие коэффициенты и доставку строки; одна репрезентативная точка (медиана) на согласованный логический тендер.",
	}})
}

// ─── фильтры/сортировка (pure, поверх готового отчёта) ───────────────────────

func filterBenchmarkItems(items []pb.ItemBenchmark, r *http.Request) []pb.ItemBenchmark {
	q := r.URL.Query()
	status := q.Get("status")
	posID := q.Get("position_id")
	itemType := q.Get("boq_item_type")
	search := strings.ToLower(strings.TrimSpace(q.Get("search")))

	statusMatch := func(s string) bool {
		switch status {
		case "", "all":
			return true
		case "high":
			return s == pb.StatusHighOutlier
		case "low":
			return s == pb.StatusLowOutlier
		case "within_range":
			return s == pb.StatusWithinRange
		case "insufficient":
			return s == pb.StatusInsufficientHistory
		case "not_eligible":
			return s == pb.StatusNotEligible
		default:
			return s == status
		}
	}
	out := make([]pb.ItemBenchmark, 0, len(items))
	for _, it := range items {
		if !statusMatch(it.Status) {
			continue
		}
		if posID != "" && it.ClientPositionID != posID {
			continue
		}
		if itemType != "" && it.BoqItemType != itemType {
			continue
		}
		if search != "" && !strings.Contains(strings.ToLower(it.Name), search) {
			continue
		}
		out = append(out, it)
	}
	return out
}

func sortBenchmarkItems(items []pb.ItemBenchmark, mode string) {
	dev := func(it *pb.ItemBenchmark) float64 {
		if it.DeviationFromMedianPercent == nil {
			return 0
		}
		return *it.DeviationFromMedianPercent
	}
	switch mode {
	case "deviation_asc":
		sort.SliceStable(items, func(a, b int) bool { return dev(&items[a]) < dev(&items[b]) })
	case "current_cost_desc":
		sort.SliceStable(items, func(a, b int) bool { return items[a].CurrentUnitCost > items[b].CurrentUnitCost })
	case "current_cost_asc":
		sort.SliceStable(items, func(a, b int) bool { return items[a].CurrentUnitCost < items[b].CurrentUnitCost })
	case "position":
		sort.SliceStable(items, func(a, b int) bool {
			if items[a].ClientPositionID != items[b].ClientPositionID {
				return items[a].ClientPositionID < items[b].ClientPositionID
			}
			return items[a].BoqItemID < items[b].BoqItemID
		})
	case "", "deviation_desc":
		// дефолтный порядок движка уже status→|deviation| desc
	}
}
