package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"

	ea "github.com/su10/hubtender/backend/internal/analytics/estimatearchive"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// archiveServicer — граница сервиса архива смет.
type archiveServicer interface {
	Search(ctx context.Context, req services.ArchiveSearchRequest) ([]services.ArchiveSearchHit, error)
	Suggest(ctx context.Context, req services.SuggestRequest) ([]services.SuggestResult, error)
	GetPosition(ctx context.Context, positionID string) (*repository.ArchivePositionDetail, error)
	Compose(ctx context.Context, in repository.ComposeInput) (*repository.ComposeResult, error)
}

// ArchiveHandler обслуживает /api/v1/archive/*.
type ArchiveHandler struct {
	svc      archiveServicer
	validate *validator.Validate
}

// NewArchiveHandler creates an ArchiveHandler.
func NewArchiveHandler(svc archiveServicer) *ArchiveHandler {
	return &ArchiveHandler{svc: svc, validate: validator.New()}
}

// SearchPositions handles GET /api/v1/archive/positions/search.
func (h *ArchiveHandler) SearchPositions(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	workName := q.Get("q")
	if workName == "" {
		apierr.BadRequest("параметр q обязателен").Render(w)
		return
	}

	volume, err := optionalFloatParam(q.Get("volume"))
	if err != nil {
		apierr.BadRequest("некорректный volume").Render(w)
		return
	}
	minScore, err := optionalFloatParam(q.Get("min_score"))
	if err != nil {
		apierr.BadRequest("некорректный min_score").Render(w)
		return
	}
	score := ea.DefaultMinScore
	if minScore != nil {
		score = *minScore
	}

	req := services.ArchiveSearchRequest{
		Query: ea.Query{
			WorkName: workName,
			UnitCode: q.Get("unit_code"),
			ItemNo:   q.Get("item_no"),
			Volume:   volume,
		},
		Filter:   archiveFilterFromQuery(q),
		MinScore: score,
		Limit:    intParam(q.Get("limit"), 0),
	}

	hits, err := h.svc.Search(r.Context(), req)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "не удалось выполнить поиск по архиву смет")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: hits})
}

// GetPosition handles GET /api/v1/archive/positions/{id}.
func (h *ArchiveHandler) GetPosition(w http.ResponseWriter, r *http.Request) {
	positionID := chi.URLParam(r, "id")
	if positionID == "" {
		apierr.BadRequest("missing position id").Render(w)
		return
	}
	d, err := h.svc.GetPosition(r.Context(), positionID)
	if err != nil {
		if errors.Is(err, repository.ErrArchivePositionNotFound) {
			apierr.ArchiveSourceNotFound(
				"ARCHIVE_SOURCE_POSITION_NOT_FOUND", positionID, "",
			).Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "не удалось загрузить историческую позицию")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: d})
}

// suggestQueryReq — один запрос батча подбора аналогов.
type suggestQueryReq struct {
	Ref      string   `json:"ref"`
	WorkName string   `json:"work_name" validate:"required,min=1"`
	UnitCode string   `json:"unit_code"`
	ItemNo   string   `json:"item_no"`
	Volume   *float64 `json:"volume"`
}

// suggestReq — тело POST /api/v1/archive/positions/suggest.
type suggestReq struct {
	Queries           []suggestQueryReq `json:"queries" validate:"required,min=1,dive"`
	LimitPerQuery     int               `json:"limit_per_query"`
	MinScore          *float64          `json:"min_score"`
	ExcludeTenderID   string            `json:"exclude_tender_id"`
	OnlyLatestVersion *bool             `json:"only_latest_version"`
	ApprovedOnly      bool              `json:"approved_only"`
	PeriodMonths      int               `json:"period_months"`
	WithBoqOnly       *bool             `json:"with_boq_only"`
}

// SuggestPositions handles POST /api/v1/archive/positions/suggest.
func (h *ArchiveHandler) SuggestPositions(w http.ResponseWriter, r *http.Request) {
	var req suggestReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}
	if len(req.Queries) > services.MaxSuggestQueries {
		apierr.BadRequest("запросов в батче больше допустимых " +
			strconv.Itoa(services.MaxSuggestQueries)).Render(w)
		return
	}

	queries := make([]ea.Query, len(req.Queries))
	for i, q := range req.Queries {
		ref := q.Ref
		if ref == "" {
			ref = strconv.Itoa(i)
		}
		queries[i] = ea.Query{
			Ref: ref, WorkName: q.WorkName, UnitCode: q.UnitCode,
			ItemNo: q.ItemNo, Volume: q.Volume,
		}
	}

	score := ea.DefaultMinScore
	if req.MinScore != nil {
		score = *req.MinScore
	}

	res, err := h.svc.Suggest(r.Context(), services.SuggestRequest{
		Queries: queries,
		Filter: repository.ArchiveSearchFilter{
			ExcludeTenderID:   req.ExcludeTenderID,
			OnlyLatestVersion: boolOrDefault(req.OnlyLatestVersion, true),
			ApprovedOnly:      req.ApprovedOnly,
			PeriodMonths:      req.PeriodMonths,
			WithBoqOnly:       boolOrDefault(req.WithBoqOnly, true),
		},
		MinScore:     score,
		LimitPerItem: req.LimitPerQuery,
	})
	if err != nil {
		apierr.InternalFromErr(w, r, err, "не удалось подобрать аналоги в архиве смет")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}

// archiveFilterFromQuery собирает общие фильтры архива из query-параметров.
func archiveFilterFromQuery(q map[string][]string) repository.ArchiveSearchFilter {
	get := func(k string) string {
		if v, ok := q[k]; ok && len(v) > 0 {
			return v[0]
		}
		return ""
	}
	return repository.ArchiveSearchFilter{
		ExcludeTenderID:   get("exclude_tender_id"),
		UnitCode:          get("unit_code"),
		OnlyLatestVersion: boolParam(get("only_latest_version"), true),
		ApprovedOnly:      boolParam(get("approved_only"), false),
		PeriodMonths:      intParam(get("period_months"), 0),
		WithBoqOnly:       boolParam(get("with_boq_only"), true),
		CandidateLimit:    intParam(get("candidate_limit"), 0),
	}
}

func optionalFloatParam(raw string) (*float64, error) {
	if raw == "" {
		return nil, nil
	}
	v, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return nil, err
	}
	return &v, nil
}

func intParam(raw string, def int) int {
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return v
}

func boolParam(raw string, def bool) bool {
	if raw == "" {
		return def
	}
	v, err := strconv.ParseBool(raw)
	if err != nil {
		return def
	}
	return v
}

func boolOrDefault(v *bool, def bool) bool {
	if v == nil {
		return def
	}
	return *v
}
