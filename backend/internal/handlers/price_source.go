package handlers

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type priceSourceServicer interface {
	TenderPriceSourceQuality(ctx context.Context, tenderID string, maxAgeDays int) (*ps.Report, error)
}

// PriceSourceHandler — GET /api/v1/tenders/{id}/price-source-quality.
type PriceSourceHandler struct {
	svc priceSourceServicer
}

// NewPriceSourceHandler creates a PriceSourceHandler.
func NewPriceSourceHandler(svc priceSourceServicer) *PriceSourceHandler {
	return &PriceSourceHandler{svc: svc}
}

// TenderPriceSourceQuality — read-only отчёт актуальности источников.
func (h *PriceSourceHandler) TenderPriceSourceQuality(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	maxAge := ps.DefaultMaxAgeDays
	if raw := r.URL.Query().Get("max_age_days"); raw != "" {
		v, err := strconv.Atoi(raw)
		ok := err == nil
		if ok {
			ok = false
			for _, a := range ps.AllowedMaxAgeDays {
				if v == a {
					ok = true
					break
				}
			}
		}
		if !ok {
			apierr.BadRequest("max_age_days must be one of 30, 60, 90, 180, 365").Render(w)
			return
		}
		maxAge = v
	}

	report, err := h.svc.TenderPriceSourceQuality(r.Context(), tenderID, maxAge)
	if err != nil {
		if errors.Is(err, repository.ErrQualityTenderNotFound) {
			apierr.NotFound("tender not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to build price source report")
		return
	}

	items := filterSourceRows(report.Items, r)
	sortSourceRows(items, r.URL.Query().Get("sort"))

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
		"tender_id":                      report.TenderID,
		"financial_input_revision":       report.FinancialInputRevision,
		"financial_calculation_revision": report.FinancialCalculationRevision,
		"financial_calculation_status":   report.FinancialCalculationStatus,
		"generated_at":                   report.GeneratedAt,
		"as_of_date":                     report.AsOfDate,
		"max_age_days":                   report.MaxAgeDays,
		"expiring_soon_days":             report.ExpiringSoonDays,
		"amount_metrics_status":          report.AmountMetricsStatus,
		"amount_metrics_note":            report.AmountMetricsNote,
		"summary":                        report.Summary,
		"items":                          items[from:to],
		"pagination":                     map[string]int{"page": page, "page_size": pageSize, "total": total},
	}})
}

func filterSourceRows(rows []ps.Row, r *http.Request) []ps.Row {
	q := r.URL.Query()
	status := q.Get("status")
	posID := q.Get("position_id")
	itemType := q.Get("boq_item_type")
	search := strings.ToLower(strings.TrimSpace(q.Get("search")))

	match := func(s string) bool {
		switch status {
		case "", "all":
			return s != ps.StatusNotApplicable
		case "fresh":
			return s == ps.StatusFresh
		case "expiring":
			return s == ps.StatusExpiringSoon
		case "stale":
			return s == ps.StatusStale
		case "expired":
			return s == ps.StatusExpired
		case "missing_source":
			return s == ps.StatusSourceMissing
		case "missing_date":
			return s == ps.StatusPriceDateMissing
		case "invalid":
			return s == ps.StatusInvalidSourceDates
		default:
			return s == status
		}
	}
	out := make([]ps.Row, 0, len(rows))
	for _, row := range rows {
		if !match(row.Status) {
			continue
		}
		if posID != "" && row.ClientPositionID != posID {
			continue
		}
		if itemType != "" && row.BoqItemType != itemType {
			continue
		}
		if search != "" &&
			!strings.Contains(strings.ToLower(row.Name), search) &&
			!strings.Contains(strings.ToLower(row.SourceLabel), search) {
			continue
		}
		out = append(out, row)
	}
	return out
}

func sortSourceRows(rows []ps.Row, mode string) {
	switch mode {
	case "age_desc":
		sort.SliceStable(rows, func(a, b int) bool {
			return derefInt(rows[a].AgeDays) > derefInt(rows[b].AgeDays)
		})
	case "amount_desc":
		sort.SliceStable(rows, func(a, b int) bool {
			return derefFloat(rows[a].TotalAmount) > derefFloat(rows[b].TotalAmount)
		})
	case "position":
		sort.SliceStable(rows, func(a, b int) bool {
			if rows[a].ClientPositionID != rows[b].ClientPositionID {
				return rows[a].ClientPositionID < rows[b].ClientPositionID
			}
			return rows[a].BoqItemID < rows[b].BoqItemID
		})
	case "", "status":
		// дефолтный порядок движка: severity → status priority → позиция → id
	}
}

func derefInt(p *int) int {
	if p == nil {
		return -1
	}
	return *p
}

func derefFloat(p *float64) float64 {
	if p == nil {
		return -1
	}
	return *p
}
