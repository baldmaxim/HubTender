package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/analytics/costbenchmark"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// BenchmarkRangeEditorRoles — кто ведёт справочник эталонных диапазонов:
// руководство и ведущие инженеры. Инженеры видят диапазоны, но не правят —
// иначе эталон подгонялся бы под собственный расчёт.
var BenchmarkRangeEditorRoles = map[string]bool{
	"administrator":      true,
	"developer":          true,
	"director":           true,
	"general_director":   true,
	"veduschiy_inzhener": true,
}

type costBenchmarkServicer interface {
	Report(ctx context.Context, tenderID string, period int) (*services.CostBenchmarkResponse, error)
	Ranges(ctx context.Context) ([]repository.BenchmarkRange, error)
	CreateRange(ctx context.Context, in repository.BenchmarkRangeInput, actor *string) (string, error)
	UpdateRange(ctx context.Context, id string, in repository.BenchmarkRangeInput, actor *string) error
	DeactivateRange(ctx context.Context, id string, actor *string) error
	Brief(ctx context.Context, tenderID string) (*repository.TenderBrief, error)
	SaveBrief(ctx context.Context, tenderID, summaryText string, factCategoryIDs []string, actor *string) (*repository.TenderBrief, error)
}

// CostBenchmarkHandler — эталоны удельных показателей и справочник диапазонов.
type CostBenchmarkHandler struct {
	svc costBenchmarkServicer
}

func NewCostBenchmarkHandler(svc costBenchmarkServicer) *CostBenchmarkHandler {
	return &CostBenchmarkHandler{svc: svc}
}

// GetReport handles GET /api/v1/tenders/{id}/cost-benchmarks?period_months=24.
func (h *CostBenchmarkHandler) GetReport(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	period := 0
	if raw := r.URL.Query().Get("period_months"); raw != "" {
		p, err := strconv.Atoi(raw)
		if err != nil {
			apierr.BadRequest("period_months must be an integer").Render(w)
			return
		}
		period = p
	}
	rep, err := h.svc.Report(r.Context(), tenderID, period)
	switch {
	case errors.Is(err, services.ErrCostBenchmarkBadPeriod):
		apierr.BadRequest("period_months: допустимы 6, 12, 24, 36").Render(w)
	case errors.Is(err, services.ErrCostBenchmarkTenderNotFound):
		apierr.NotFound("тендер не найден").Render(w)
	case err != nil:
		apierr.InternalFromErr(w, r, err, "cost benchmark failed", "tender_id", tenderID)
	default:
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rep})
	}
}

// GetRanges handles GET /api/v1/benchmark-ranges.
func (h *CostBenchmarkHandler) GetRanges(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Ranges(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "benchmark ranges failed")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: list})
}

func blankToNil(p *string) *string {
	if p == nil {
		return nil
	}
	v := strings.TrimSpace(*p)
	if v == "" {
		return nil
	}
	return &v
}

// validateRange — понятные сообщения до БД; CHECK-ограничения таблицы остаются
// последней линией.
func validateRange(in *repository.BenchmarkRangeInput) string {
	in.CostCategoryID = blankToNil(in.CostCategoryID)
	in.DetailCostCategoryID = blankToNil(in.DetailCostCategoryID)
	in.HousingClass = blankToNil(in.HousingClass)
	in.ConstructionScope = blankToNil(in.ConstructionScope)
	in.Note = blankToNil(in.Note)

	if in.MetricKind != costbenchmark.MetricPerVolumeUnit && in.MetricKind != costbenchmark.MetricPerAreaSP {
		return "metric_kind: per_volume_unit или per_area_sp"
	}
	switch in.Level {
	case costbenchmark.LevelTotal:
		if in.MetricKind != costbenchmark.MetricPerAreaSP {
			return "для тендера целиком задаётся только ₽ на м² общей площади"
		}
		in.CostCategoryID, in.DetailCostCategoryID = nil, nil
	case costbenchmark.LevelCategory:
		if in.CostCategoryID == nil {
			return "не выбрана категория затрат"
		}
		in.DetailCostCategoryID = nil
	case costbenchmark.LevelDetail:
		if in.DetailCostCategoryID == nil {
			return "не выбрана детализация"
		}
		in.CostCategoryID = nil
	default:
		return "level: total, category или detail"
	}
	if in.Min == nil && in.Max == nil {
		return "задайте хотя бы одну границу"
	}
	if (in.Min != nil && *in.Min < 0) || (in.Max != nil && *in.Max < 0) {
		return "границы не могут быть отрицательными"
	}
	if in.Min != nil && in.Max != nil && *in.Min > *in.Max {
		return "нижняя граница больше верхней"
	}
	return ""
}

func renderRangeErr(w http.ResponseWriter, r *http.Request, err error, op string) {
	switch {
	case errors.Is(err, repository.ErrRangeDuplicate):
		apierr.Conflict("на эту цель, класс и объём строительства диапазон уже заведён").Render(w)
	case errors.Is(err, repository.ErrRangeInvalid):
		apierr.BadRequest("некорректный диапазон: проверьте цель, класс и границы").Render(w)
	case errors.Is(err, repository.ErrRangeNotFound):
		apierr.NotFound("диапазон не найден").Render(w)
	default:
		apierr.InternalFromErr(w, r, err, op)
	}
}

func (h *CostBenchmarkHandler) decodeRange(w http.ResponseWriter, r *http.Request) (*repository.BenchmarkRangeInput, *string, bool) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return nil, nil, false
	}
	var in repository.BenchmarkRangeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return nil, nil, false
	}
	if msg := validateRange(&in); msg != "" {
		apierr.BadRequest(msg).Render(w)
		return nil, nil, false
	}
	return &in, &authUser.ID, true
}

// PostRange handles POST /api/v1/benchmark-ranges.
func (h *CostBenchmarkHandler) PostRange(w http.ResponseWriter, r *http.Request) {
	in, actor, ok := h.decodeRange(w, r)
	if !ok {
		return
	}
	id, err := h.svc.CreateRange(r.Context(), *in, actor)
	if err != nil {
		renderRangeErr(w, r, err, "benchmark range create failed")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: map[string]string{"id": id}})
}

// PutRange handles PUT /api/v1/benchmark-ranges/{rangeId}.
func (h *CostBenchmarkHandler) PutRange(w http.ResponseWriter, r *http.Request) {
	in, actor, ok := h.decodeRange(w, r)
	if !ok {
		return
	}
	if err := h.svc.UpdateRange(r.Context(), chi.URLParam(r, "rangeId"), *in, actor); err != nil {
		renderRangeErr(w, r, err, "benchmark range update failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DeleteRange handles DELETE /api/v1/benchmark-ranges/{rangeId} — мягкое удаление.
func (h *CostBenchmarkHandler) DeleteRange(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	if err := h.svc.DeactivateRange(r.Context(), chi.URLParam(r, "rangeId"), &authUser.ID); err != nil {
		renderRangeErr(w, r, err, "benchmark range delete failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// maxBriefLength — выжимка это абзац-другой для руководства, а не документ.
const maxBriefLength = 20000

// GetBrief handles GET /api/v1/tenders/{id}/brief.
func (h *CostBenchmarkHandler) GetBrief(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	b, err := h.svc.Brief(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "tender brief failed", "tender_id", tenderID)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: b})
}

type tenderBriefRequest struct {
	SummaryText     string   `json:"summary_text"`
	FactCategoryIDs []string `json:"fact_category_ids"`
}

// PutBrief handles PUT /api/v1/tenders/{id}/brief.
func (h *CostBenchmarkHandler) PutBrief(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	var req tenderBriefRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return
	}
	if len([]rune(req.SummaryText)) > maxBriefLength {
		apierr.BadRequest("выжимка слишком длинная").Render(w)
		return
	}
	b, err := h.svc.SaveBrief(r.Context(), tenderID, req.SummaryText, req.FactCategoryIDs, &authUser.ID)
	switch {
	case errors.Is(err, repository.ErrRangeInvalid):
		apierr.BadRequest("некорректные данные выжимки: тендер или категории не найдены").Render(w)
	case err != nil:
		apierr.InternalFromErr(w, r, err, "tender brief save failed", "tender_id", tenderID)
	default:
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: b})
	}
}
