package handlers

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	rp "github.com/su10/hubtender/backend/internal/analytics/reviewpack"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type reviewPackServicer interface {
	TenderReviewModel(ctx context.Context, tenderID string, periodMonths, maxAgeDays int, baselineID string) (*rp.Model, error)
	TenderReviewXLSX(ctx context.Context, tenderID string, periodMonths, maxAgeDays int, baselineID string) ([]byte, string, error)
}

// ReviewPackHandler — GET /api/v1/tenders/{id}/review-report(.xlsx).
type ReviewPackHandler struct {
	svc reviewPackServicer
}

// NewReviewPackHandler creates a ReviewPackHandler.
func NewReviewPackHandler(svc reviewPackServicer) *ReviewPackHandler {
	return &ReviewPackHandler{svc: svc}
}

func (h *ReviewPackHandler) parseParams(w http.ResponseWriter, r *http.Request) (tenderID string, period, maxAge int, baselineID string, ok bool) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return "", 0, 0, "", false
	}
	tenderID = chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return "", 0, 0, "", false
	}
	period = pb.DefaultPeriodMonths
	if raw := r.URL.Query().Get("benchmark_period_months"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || !containsInt(pb.AllowedPeriods, v) {
			apierr.BadRequest("benchmark_period_months must be one of 6, 12, 24, 36").Render(w)
			return "", 0, 0, "", false
		}
		period = v
	}
	maxAge = ps.DefaultMaxAgeDays
	if raw := r.URL.Query().Get("source_max_age_days"); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || !containsInt(ps.AllowedMaxAgeDays, v) {
			apierr.BadRequest("source_max_age_days must be one of 30, 60, 90, 180, 365").Render(w)
			return "", 0, 0, "", false
		}
		maxAge = v
	}
	return tenderID, period, maxAge, r.URL.Query().Get("baseline_tender_id"), true
}

func (h *ReviewPackHandler) renderError(w http.ResponseWriter, r *http.Request, err error, tenderID string) {
	if errors.Is(err, repository.ErrQualityTenderNotFound) {
		apierr.NotFound("tender not found").Render(w)
		return
	}
	var notReady *repository.FinancialCalculationNotReadyError
	if errors.As(err, &notReady) {
		renderChangeImpactConflict(w, "REVIEW_REPORT_CALCULATION_NOT_READY",
			"Финансовый расчёт не актуален — отчёт для проверки формируется только для актуальной ревизии.",
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
			"Выбранная версия для сравнения недоступна.",
			map[string]any{"baselineTenderId": baseNotReady.TenderID, "reason": baseNotReady.Reason})
		return
	}
	var tooLarge *rp.ErrReportTooLarge
	if errors.As(err, &tooLarge) {
		(&apierr.ProblemExtra{
			Problem: apierr.Problem{Type: "about:blank", Title: "Payload Too Large",
				Status: http.StatusRequestEntityTooLarge,
				Detail: "Отчёт превышает safety-лимит строк — сузьте данные тендера или обратитесь к разработчикам."},
			Extras: map[string]any{"code": "REVIEW_REPORT_TOO_LARGE"},
		}).Render(w)
		return
	}
	// Внутренняя ошибка компонента НЕ маскируется «чистым» отчётом (§5).
	apierr.InternalFromErr(w, r, err, "failed to build review report", "tender_id", tenderID)
}

// TenderReviewReport — JSON preview (§5).
func (h *ReviewPackHandler) TenderReviewReport(w http.ResponseWriter, r *http.Request) {
	tenderID, period, maxAge, baselineID, ok := h.parseParams(w, r)
	if !ok {
		return
	}
	model, err := h.svc.TenderReviewModel(r.Context(), tenderID, period, maxAge, baselineID)
	if err != nil {
		h.renderError(w, r, err, tenderID)
		return
	}
	q := url.Values{
		"benchmark_period_months": {strconv.Itoa(period)},
		"source_max_age_days":     {strconv.Itoa(maxAge)},
	}
	if baselineID != "" {
		q.Set("baseline_tender_id", baselineID)
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: map[string]any{
		"status":            model.Status,
		"metadata":          model.Metadata,
		"components":        model.Sections,
		"executive_summary": model.Executive,
		"download_url":      "/api/v1/tenders/" + tenderID + "/review-report.xlsx?" + q.Encode(),
	}})
}

// TenderReviewReportXLSX — скачивание файла (§6). Транзакция чтения закрыта
// внутри сервиса ДО записи файла в response.
func (h *ReviewPackHandler) TenderReviewReportXLSX(w http.ResponseWriter, r *http.Request) {
	tenderID, period, maxAge, baselineID, ok := h.parseParams(w, r)
	if !ok {
		return
	}
	data, filename, err := h.svc.TenderReviewXLSX(r.Context(), tenderID, period, maxAge, baselineID)
	if err != nil {
		h.renderError(w, r, err, tenderID)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	// UTF-8 filename (RFC 5987) + ASCII fallback; приватный финансовый файл —
	// без кэширования.
	w.Header().Set("Content-Disposition",
		`attachment; filename="review-report.xlsx"; filename*=UTF-8''`+url.PathEscape(filename))
	w.Header().Set("Cache-Control", "no-store, private")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}
