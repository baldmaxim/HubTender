package handlers

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type changeImpactServicer interface {
	TenderChangeImpact(ctx context.Context, tenderID, baselineID string) (*ci.Report, error)
}

// ChangeImpactHandler — GET /api/v1/tenders/{id}/change-impact (read-only).
type ChangeImpactHandler struct {
	svc changeImpactServicer
}

// NewChangeImpactHandler creates a ChangeImpactHandler.
func NewChangeImpactHandler(svc changeImpactServicer) *ChangeImpactHandler {
	return &ChangeImpactHandler{svc: svc}
}

// TenderChangeImpact — сравнение версий. Общая summary/bridge/config/top
// строятся по ПОЛНОМУ сравнению; substantive-фильтры дают отдельную
// filtered_summary; пагинация — только к списку строк (§15).
func (h *ChangeImpactHandler) TenderChangeImpact(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	baselineID := r.URL.Query().Get("baseline_tender_id")

	report, err := h.svc.TenderChangeImpact(r.Context(), tenderID, baselineID)
	if err != nil {
		if errors.Is(err, repository.ErrQualityTenderNotFound) {
			apierr.NotFound("tender not found").Render(w)
			return
		}
		var notReady *repository.FinancialCalculationNotReadyError
		if errors.As(err, &notReady) {
			renderChangeImpactConflict(w, "CHANGE_IMPACT_CALCULATION_NOT_READY",
				"Финансовый расчёт текущей версии не актуален — сравнение недоступно до пересчёта.",
				map[string]any{
					"calculationStatus":   notReady.CalculationStatus,
					"inputRevision":       notReady.InputRevision,
					"calculationRevision": notReady.CalculationRevision,
					"reason":              notReady.Reason,
				})
			return
		}
		var baseNotReady *repository.ChangeImpactBaselineNotReadyError
		if errors.As(err, &baseNotReady) {
			renderChangeImpactConflict(w, "CHANGE_IMPACT_BASELINE_NOT_READY",
				"Выбранная версия для сравнения недоступна: несогласованная, неактуальная или чужая версия.",
				map[string]any{"baselineTenderId": baseNotReady.TenderID, "reason": baseNotReady.Reason})
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to build change impact", "tender_id", tenderID)
		return
	}

	items := filterDiffItems(report.Items, r)
	filtered := ci.FilteredSummary{FilteredItems: len(items)}
	for i := range items {
		filtered.FilteredCommercialDelta += items[i].Commercial.Delta
		filtered.FilteredDirectDelta += items[i].Direct.Delta
	}
	sortDiffItems(items, r.URL.Query().Get("sort"))

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
		"status":                report.Status,
		"current":               report.Current,
		"baseline":              report.Baseline,
		"baseline_candidates":   report.BaselineCandidates,
		"generated_at":          report.GeneratedAt,
		"summary":               report.Summary,
		"filtered_summary":      filtered,
		"bridge":                report.Bridge,
		"configuration_changes": report.ConfigChanges,
		"position_summaries":    report.PositionSummaries,
		"top_contributors":      report.TopContributors,
		"items":                 items[from:to],
		"pagination":            map[string]int{"page": page, "page_size": pageSize, "total": total},
	}})
}

func renderChangeImpactConflict(w http.ResponseWriter, code, detail string, extras map[string]any) {
	all := map[string]any{"code": code}
	for k, v := range extras {
		all[k] = v
	}
	(&apierr.ProblemExtra{
		Problem: apierr.Problem{
			Type: "about:blank", Title: "Conflict",
			Status: http.StatusConflict, Detail: detail,
		},
		Extras: all,
	}).Render(w)
}

func filterDiffItems(items []ci.ItemDiff, r *http.Request) []ci.ItemDiff {
	q := r.URL.Query()
	status := q.Get("status")
	posID := q.Get("position_id")
	itemType := q.Get("boq_item_type")
	search := strings.ToLower(strings.TrimSpace(q.Get("search")))

	match := func(s string) bool {
		switch status {
		case "", "all":
			return true
		case "modified":
			return s == ci.StatusModified
		case "added":
			return s == ci.StatusAdded
		case "removed":
			return s == ci.StatusRemoved
		case "unchanged":
			return s == ci.StatusUnchanged
		case "ambiguous":
			return s == ci.StatusAmbiguousGroup
		default:
			return s == status
		}
	}
	out := make([]ci.ItemDiff, 0, len(items))
	for _, it := range items {
		if !match(it.Status) {
			continue
		}
		if posID != "" && (it.ClientPositionID == nil || *it.ClientPositionID != posID) {
			continue
		}
		if itemType != "" && it.BoqItemType != itemType {
			continue
		}
		if search != "" {
			hay := strings.ToLower(it.Label + " " + it.PositionLabel)
			if !strings.Contains(hay, search) {
				continue
			}
		}
		out = append(out, it)
	}
	return out
}

func sortDiffItems(items []ci.ItemDiff, mode string) {
	abs := func(v float64) float64 {
		if v < 0 {
			return -v
		}
		return v
	}
	switch mode {
	case "impact_asc":
		sort.SliceStable(items, func(i, j int) bool {
			ai, aj := abs(items[i].Commercial.Delta), abs(items[j].Commercial.Delta)
			if ai != aj {
				return ai < aj
			}
			return items[i].ID < items[j].ID
		})
	case "direct_delta_desc":
		sort.SliceStable(items, func(i, j int) bool {
			ai, aj := abs(items[i].Direct.Delta), abs(items[j].Direct.Delta)
			if ai != aj {
				return ai > aj
			}
			return items[i].ID < items[j].ID
		})
	case "position":
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].PositionLabel != items[j].PositionLabel {
				return items[i].PositionLabel < items[j].PositionLabel
			}
			return items[i].ID < items[j].ID
		})
	case "", "impact_desc":
		// порядок движка: |commercial delta| desc — уже установлен
	}
}
