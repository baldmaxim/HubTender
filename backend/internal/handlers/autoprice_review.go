package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// AutopriceApproverRoles — кто подтверждает и переоткрывает позиции авторасценки.
var AutopriceApproverRoles = map[string]bool{
	"veduschiy_inzhener": true,
	"administrator":      true,
}

const maxAutopriceLabelLen = 200

// autopriceStore — граница репозитория авторасценки.
type autopriceStore interface {
	CreateRun(ctx context.Context, tenderID, userID, label string, sourceRef *string) (*repository.AutopriceRunCreated, error)
	ListRuns(ctx context.Context, tenderID string) ([]repository.AutopriceRun, error)
	GetRun(ctx context.Context, sessionID string) (*repository.AutopriceRun, error)
	ListTenders(ctx context.Context) ([]repository.AutopriceTender, error)
	ListReviews(ctx context.Context, sessionID string) ([]repository.AutopriceReview, error)
	GetPositionDetail(ctx context.Context, sessionID, positionID string) (*repository.AutopriceDetail, error)
	UpsertReview(ctx context.Context, sessionID, positionID, actorID string, in repository.AutopriceReviewInput) (*repository.AutopriceReview, error)
	PatchReview(ctx context.Context, sessionID, positionID, actorID string, p repository.AutopriceReviewPatch) (*repository.AutopriceReview, error)
	ApplyAction(ctx context.Context, sessionID, positionID, actorID, action, comment string) (*repository.AutopriceReview, error)
}

// AutopriceReviewHandler — подтверждение авторасценки (тест).
type AutopriceReviewHandler struct {
	store autopriceStore
}

// NewAutopriceReviewHandler creates an AutopriceReviewHandler.
func NewAutopriceReviewHandler(store autopriceStore) *AutopriceReviewHandler {
	return &AutopriceReviewHandler{store: store}
}

// autopriceError — ошибка контракта: {error: code, message: русский текст} + extras.
func autopriceError(w http.ResponseWriter, status int, code, message string, extras map[string]any) {
	body := map[string]any{"error": code, "message": message}
	for k, v := range extras {
		body[k] = v
	}
	autopriceJSON(w, status, body)
}

// autopriceJSON — ответ без кэширования: состояние подтверждения должно быть свежим.
func autopriceJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// autopriceRepoError — единое соответствие ошибок репозитория кодам ответа.
func autopriceRepoError(w http.ResponseWriter, r *http.Request, err error, detail string) {
	extras := autopriceBulkExtras(err)
	var zp *repository.AutopriceZeroPriceError
	var tr *repository.AutopriceTransitionError
	switch {
	case errors.As(err, &zp):
		autopriceError(w, http.StatusUnprocessableEntity, "zero_price",
			"Нельзя подтвердить: в позиции есть строки с нулевой ценой.",
			map[string]any{"zero_price_count": zp.Count})
	case errors.As(err, &tr):
		autopriceError(w, http.StatusConflict, "invalid_transition",
			"Действие недоступно из текущего статуса позиции.", nil)
	case errors.Is(err, repository.ErrAutopriceApproved):
		autopriceError(w, http.StatusConflict, "approved",
			"Позиция подтверждена: сначала снимите подтверждение (переоткрыть).", extras)
	case errors.Is(err, repository.ErrAutopriceRunCancelled):
		autopriceError(w, http.StatusConflict, "run_cancelled", "Прогон авторасценки отменён.", extras)
	case errors.Is(err, repository.ErrAutopriceRunNotFound):
		autopriceError(w, http.StatusNotFound, "run_not_found", "Прогон авторасценки не найден.", extras)
	case errors.Is(err, repository.ErrAutopriceTenderNotFound):
		autopriceError(w, http.StatusNotFound, "tender_not_found", "Тендер не найден.", extras)
	case errors.Is(err, repository.ErrAutopricePositionNotFound):
		autopriceError(w, http.StatusNotFound, "position_not_found", "Позиция не найдена в тендере прогона.", extras)
	case errors.Is(err, repository.ErrAutopriceReviewNotFound):
		autopriceError(w, http.StatusNotFound, "review_not_found", "Позиция не загружена в этот прогон.", extras)
	default:
		apierr.InternalFromErr(w, r, err, detail)
	}
}

func autopriceBadRequest(w http.ResponseWriter, message string) {
	autopriceError(w, http.StatusBadRequest, "bad_request", message, nil)
}

// autopriceUser возвращает пользователя или пишет 401.
func autopriceUser(w http.ResponseWriter, r *http.Request) *middleware.AuthUser {
	u := middleware.UserFromContext(r.Context())
	if u == nil {
		autopriceError(w, http.StatusUnauthorized, "unauthorized", "Требуется вход в систему.", nil)
	}
	return u
}

// autopriceIDs читает и проверяет uuid из URL; при ошибке пишет 400.
func autopriceIDs(w http.ResponseWriter, r *http.Request, names ...string) ([]string, bool) {
	out := make([]string, 0, len(names))
	for _, n := range names {
		v := chi.URLParam(r, n)
		if !uuidPatchRe.MatchString(v) {
			autopriceBadRequest(w, n+": ожидается UUID")
			return nil, false
		}
		out = append(out, v)
	}
	return out, true
}

// ─── Валидация вложенных JSON ───────────────────────────────────────────────

type autopriceQuestion struct {
	Text string `json:"text"`
}

type autopriceFinding struct {
	Kind       string `json:"kind"`
	Severity   string `json:"severity"`
	Text       string `json:"text"`
	Resolution string `json:"resolution"`
}

var (
	autopriceBasisValues      = map[string]bool{"PD_CONFIRMED": true, "ASSUMED": true, "NOT_IN_PD": true, "RESERVE": true}
	autopriceSeverityValues   = map[string]bool{"high": true, "medium": true, "low": true}
	autopriceResolutionValues = map[string]bool{"fixed": true, "not_duplicate": true, "moved": true, "other": true}
)

func isJSONNull(raw json.RawMessage) bool {
	return len(raw) == 0 || strings.TrimSpace(string(raw)) == "null"
}

// validateRefs: string[].
func validateRefs(raw json.RawMessage) string {
	var v []string
	if err := json.Unmarshal(raw, &v); err != nil {
		return "pd_refs: ожидается массив строк"
	}
	return ""
}

// validateQuestions: [{text, answer?, sent_to_customer?}].
func validateQuestions(raw json.RawMessage) string {
	var v []autopriceQuestion
	if err := json.Unmarshal(raw, &v); err != nil {
		return "questions: ожидается массив объектов {text, answer?, sent_to_customer?}"
	}
	for _, q := range v {
		if strings.TrimSpace(q.Text) == "" {
			return "questions: у каждого вопроса нужен text"
		}
	}
	return ""
}

// validateFindings: [{kind, severity, text, resolution?, ...}].
func validateFindings(raw json.RawMessage) string {
	var v []autopriceFinding
	if err := json.Unmarshal(raw, &v); err != nil {
		return "findings: ожидается массив объектов {kind, severity, text, resolution?}"
	}
	for _, f := range v {
		if strings.TrimSpace(f.Kind) == "" || strings.TrimSpace(f.Text) == "" {
			return "findings: у каждой находки нужны kind и text"
		}
		if !autopriceSeverityValues[f.Severity] {
			return "findings: severity должен быть high, medium или low"
		}
		if f.Resolution != "" && !autopriceResolutionValues[f.Resolution] {
			return "findings: resolution должен быть fixed, not_duplicate, moved или other"
		}
	}
	return ""
}

// ─── Прогоны ────────────────────────────────────────────────────────────────

type createAutopriceRunReq struct {
	Label     string  `json:"label"`
	SourceRef *string `json:"source_ref"`
}

// CreateRun handles POST /api/v1/tenders/{id}/autoprice-runs.
func (h *AutopriceReviewHandler) CreateRun(w http.ResponseWriter, r *http.Request) {
	user := autopriceUser(w, r)
	if user == nil {
		return
	}
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return
	}
	var req createAutopriceRunReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		autopriceBadRequest(w, "Некорректный JSON.")
		return
	}
	req.Label = strings.TrimSpace(req.Label)
	if req.Label == "" || len([]rune(req.Label)) > maxAutopriceLabelLen {
		autopriceBadRequest(w, "label: обязателен, до 200 символов.")
		return
	}
	run, err := h.store.CreateRun(r.Context(), ids[0], user.ID, req.Label, req.SourceRef)
	if err != nil {
		autopriceRepoError(w, r, err, "failed to create autoprice run")
		return
	}
	autopriceJSON(w, http.StatusCreated, run)
}

// ListRuns handles GET /api/v1/tenders/{id}/autoprice-runs.
func (h *AutopriceReviewHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return
	}
	runs, err := h.store.ListRuns(r.Context(), ids[0])
	if err != nil {
		autopriceRepoError(w, r, err, "failed to list autoprice runs")
		return
	}
	autopriceJSON(w, http.StatusOK, map[string]any{"runs": runs})
}

// ListTenders handles GET /api/v1/autoprice-tenders.
func (h *AutopriceReviewHandler) ListTenders(w http.ResponseWriter, r *http.Request) {
	tenders, err := h.store.ListTenders(r.Context())
	if err != nil {
		autopriceRepoError(w, r, err, "failed to list autoprice tenders")
		return
	}
	autopriceJSON(w, http.StatusOK, map[string]any{"tenders": tenders})
}

// ListReviews handles GET /api/v1/autoprice-runs/{sid}/reviews.
func (h *AutopriceReviewHandler) ListReviews(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "sid")
	if !ok {
		return
	}
	run, err := h.store.GetRun(r.Context(), ids[0])
	if err != nil {
		autopriceRepoError(w, r, err, "failed to load autoprice run")
		return
	}
	reviews, err := h.store.ListReviews(r.Context(), ids[0])
	if err != nil {
		autopriceRepoError(w, r, err, "failed to list autoprice reviews")
		return
	}
	autopriceJSON(w, http.StatusOK, map[string]any{"run": run, "reviews": reviews})
}

// ─── Позиция прогона ────────────────────────────────────────────────────────

type putAutopriceReviewReq struct {
	Basis     *string         `json:"basis"`
	PdRefs    json.RawMessage `json:"pd_refs"`
	PdNote    *string         `json:"pd_note"`
	Questions json.RawMessage `json:"questions"`
	Findings  json.RawMessage `json:"findings"`
	// VolumeSource: ключа нет — не менять, null — сбросить, объект — записать.
	VolumeSource json.RawMessage `json:"volume_source"`
}

// buildAutopriceReviewInput проверяет тело карточки и собирает вход репозитория.
// При ошибке возвращает имя поля (basis, pd_refs, questions, findings,
// volume_source) и текст.
func buildAutopriceReviewInput(req putAutopriceReviewReq) (in repository.AutopriceReviewInput, field, msg string) {
	if req.Basis != nil && !autopriceBasisValues[*req.Basis] {
		return in, "basis", "basis: PD_CONFIRMED, ASSUMED, NOT_IN_PD или RESERVE."
	}
	in = repository.AutopriceReviewInput{Basis: req.Basis, PdNote: req.PdNote}
	checks := []struct {
		field    string
		raw      json.RawMessage
		validate func(json.RawMessage) string
		dst      *json.RawMessage
	}{
		{"pd_refs", req.PdRefs, validateRefs, &in.PdRefs},
		{"questions", req.Questions, validateQuestions, &in.Questions},
		{"findings", req.Findings, validateFindings, &in.Findings},
	}
	for _, c := range checks {
		if isJSONNull(c.raw) {
			continue
		}
		if m := c.validate(c.raw); m != "" {
			return in, c.field, m
		}
		*c.dst = c.raw
	}
	set, vs, msg := buildVolumeSource(req.VolumeSource)
	if msg != "" {
		return in, "volume_source", msg
	}
	in.VolumeSourceSet, in.VolumeSource = set, vs
	return in, "", ""
}

// autopriceInvalidVolumeSource — 422 invalid_volume_source (PUT review и пакет).
func autopriceInvalidVolumeSource(w http.ResponseWriter, msg string, extras map[string]any) {
	autopriceError(w, http.StatusUnprocessableEntity, "invalid_volume_source", msg, extras)
}

// PutReview handles PUT /api/v1/autoprice-runs/{sid}/positions/{posId}/review.
func (h *AutopriceReviewHandler) PutReview(w http.ResponseWriter, r *http.Request) {
	user := autopriceUser(w, r)
	if user == nil {
		return
	}
	ids, ok := autopriceIDs(w, r, "sid", "posId")
	if !ok {
		return
	}
	var req putAutopriceReviewReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		autopriceBadRequest(w, "Некорректный JSON.")
		return
	}
	in, field, msg := buildAutopriceReviewInput(req)
	if field == "volume_source" {
		autopriceInvalidVolumeSource(w, msg, nil)
		return
	}
	if msg != "" {
		autopriceBadRequest(w, msg)
		return
	}
	review, err := h.store.UpsertReview(r.Context(), ids[0], ids[1], user.ID, in)
	if err != nil {
		autopriceRepoError(w, r, err, "failed to upsert autoprice review")
		return
	}
	autopriceJSON(w, http.StatusOK, review)
}

// GetPosition handles GET /api/v1/autoprice-runs/{sid}/positions/{posId}.
func (h *AutopriceReviewHandler) GetPosition(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "sid", "posId")
	if !ok {
		return
	}
	detail, err := h.store.GetPositionDetail(r.Context(), ids[0], ids[1])
	if err != nil {
		autopriceRepoError(w, r, err, "failed to load autoprice position")
		return
	}
	autopriceJSON(w, http.StatusOK, detail)
}

type patchAutopriceReviewReq struct {
	EngineerComment *string         `json:"engineer_comment"`
	Questions       json.RawMessage `json:"questions"`
	Findings        json.RawMessage `json:"findings"`
}

// PatchReview handles PATCH /api/v1/autoprice-runs/{sid}/positions/{posId}/review.
func (h *AutopriceReviewHandler) PatchReview(w http.ResponseWriter, r *http.Request) {
	user := autopriceUser(w, r)
	if user == nil {
		return
	}
	ids, ok := autopriceIDs(w, r, "sid", "posId")
	if !ok {
		return
	}
	var req patchAutopriceReviewReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		autopriceBadRequest(w, "Некорректный JSON.")
		return
	}
	patch := repository.AutopriceReviewPatch{EngineerComment: req.EngineerComment}
	if !isJSONNull(req.Questions) {
		if msg := validateQuestions(req.Questions); msg != "" {
			autopriceBadRequest(w, msg)
			return
		}
		patch.Questions = req.Questions
	}
	if !isJSONNull(req.Findings) {
		if msg := validateFindings(req.Findings); msg != "" {
			autopriceBadRequest(w, msg)
			return
		}
		patch.Findings = req.Findings
	}
	review, err := h.store.PatchReview(r.Context(), ids[0], ids[1], user.ID, patch)
	if err != nil {
		autopriceRepoError(w, r, err, "failed to patch autoprice review")
		return
	}
	autopriceJSON(w, http.StatusOK, review)
}

type autopriceActionReq struct {
	Action  string `json:"action"`
	Comment string `json:"comment"`
}

// Action handles POST /api/v1/autoprice-runs/{sid}/positions/{posId}/review/action.
// Подтверждать и переоткрывать могут только AutopriceApproverRoles; остальные
// действия — любой авторизованный пользователь.
func (h *AutopriceReviewHandler) Action(w http.ResponseWriter, r *http.Request) {
	user := autopriceUser(w, r)
	if user == nil {
		return
	}
	ids, ok := autopriceIDs(w, r, "sid", "posId")
	if !ok {
		return
	}
	var req autopriceActionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		autopriceBadRequest(w, "Некорректный JSON.")
		return
	}
	if !repository.IsAutopriceAction(req.Action) {
		autopriceBadRequest(w, "action: start, approve, return, needs_customer, exclude или reopen.")
		return
	}
	if (req.Action == "approve" || req.Action == "reopen") && !AutopriceApproverRoles[user.Role] {
		autopriceError(w, http.StatusForbidden, "forbidden",
			"Подтверждать и переоткрывать позиции может только ведущий инженер.", nil)
		return
	}
	req.Comment = strings.TrimSpace(req.Comment)
	if req.Action == "return" && req.Comment == "" {
		autopriceBadRequest(w, "comment: при возврате комментарий обязателен.")
		return
	}
	review, err := h.store.ApplyAction(r.Context(), ids[0], ids[1], user.ID, req.Action, req.Comment)
	if err != nil {
		autopriceRepoError(w, r, err, "failed to apply autoprice action")
		return
	}
	autopriceJSON(w, http.StatusOK, review)
}
