package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

// Пилот «Расценивание по реальному аналогу». Маршруты — JWT-группа; права те же,
// что у штатной записи строк BOQ (отдельного серверного гейта по ролям или
// дедлайну у неё нет). Формат ошибок — как у авторасценки:
// {"error": "ANALOG_*", "message": "...", ...extras}.

const maxAnalogBody = 64 << 10 // 64 КБ: тело — несколько полей

// analogStore — граница сервиса аналогов.
type analogStore interface {
	Search(ctx context.Context, positionID, query string, limit int) (*services.AnalogSearchResponse, error)
	GetSource(ctx context.Context, sourcePositionID string) (*repository.AnalogSource, error)
	Preview(ctx context.Context, in repository.AnalogExecuteInput) (*repository.AnalogPreview, error)
	Apply(ctx context.Context, in repository.AnalogExecuteInput) (*repository.AnalogApplyResult, error)
	ListApplications(ctx context.Context, positionID string) ([]repository.AnalogApplication, error)
	Revert(ctx context.Context, applicationID, userID string) (*repository.AnalogApplication, error)
	Next(ctx context.Context, positionID string) (*repository.AnalogNext, error)
}

// AnalogHandler обслуживает маршруты пилота «аналог».
type AnalogHandler struct {
	store analogStore
}

// NewAnalogHandler creates an AnalogHandler.
func NewAnalogHandler(store analogStore) *AnalogHandler {
	return &AnalogHandler{store: store}
}

// analogBadRequest — тело запроса не прошло проверку.
func analogBadRequest(w http.ResponseWriter, message string) {
	autopriceError(w, http.StatusBadRequest, "ANALOG_BAD_REQUEST", message, nil)
}

// analogStatus — HTTP-статус по коду ошибки пилота.
func analogStatus(code string) int {
	switch code {
	case repository.AnalogCodeTargetNotFound, repository.AnalogCodeSourceNotFound,
		repository.AnalogCodeApplicationAbsent:
		return http.StatusNotFound
	case repository.AnalogCodeStale, repository.AnalogCodeTargetLocked, repository.AnalogCodeTargetHasRows,
		repository.AnalogCodeIdempotencyClash, repository.AnalogCodeForeignChildren, repository.AnalogCodeNotActive:
		return http.StatusConflict
	}
	return http.StatusBadRequest
}

// analogFail переводит ошибку сервиса в ответ контракта.
func analogFail(w http.ResponseWriter, r *http.Request, err error, detail string) {
	var ae *repository.AnalogError
	var fx *calc.MissingFXRateError
	var pe *repository.InvalidBoqParentError
	switch {
	case errors.As(err, &ae):
		autopriceError(w, analogStatus(ae.Code), ae.Code, ae.Message, ae.Extras)
	case errors.As(err, &fx):
		autopriceError(w, http.StatusBadRequest, "MISSING_FX_RATE",
			"Не задан курс валюты "+fx.Currency+" для тендера: расчёт заблокирован. Задайте курс в карточке тендера.",
			map[string]any{"currency": fx.Currency})
	case errors.As(err, &pe):
		autopriceError(w, http.StatusUnprocessableEntity, "INVALID_BOQ_PARENT",
			"В позиции-аналоге есть строка с некорректной привязкой к работе: перенос невозможен.",
			map[string]any{"item_id": pe.ItemID, "parent_item_id": pe.ParentItemID})
	default:
		autopriceRepoError(w, r, err, detail)
	}
}

// analogBody — тело предпросмотра и применения.
type analogBody struct {
	SourcePositionID string `json:"source_position_id"`
	Scale            *struct {
		Mode   string   `json:"mode"`
		Factor *float64 `json:"factor"`
	} `json:"scale"`
	CopyPrices     *bool  `json:"copy_prices"`
	PreviewToken   string `json:"preview_token"`
	IdempotencyKey string `json:"idempotency_key"`
}

// parseAnalogBody проверяет тело без обращения к БД. apply=true дополнительно
// требует preview_token и idempotency_key. Ошибка — *repository.AnalogError
// (ANALOG_SCALE_INVALID) либо текст для ANALOG_BAD_REQUEST.
func parseAnalogBody(raw []byte, apply bool) (repository.AnalogRequest, string, string, error) {
	var b analogBody
	if err := json.Unmarshal(raw, &b); err != nil {
		return repository.AnalogRequest{}, "", "", errors.New("Некорректный JSON.")
	}
	var req repository.AnalogRequest
	if !uuidPatchRe.MatchString(b.SourcePositionID) {
		return req, "", "", errors.New("source_position_id: ожидается UUID.")
	}
	if b.Scale == nil || b.Scale.Mode == "" {
		return req, "", "", errors.New("scale.mode: обязателен (none, volume_ratio или factor).")
	}
	if b.CopyPrices == nil {
		return req, "", "", errors.New("copy_prices: обязателен (true или false).")
	}
	if e := repository.ValidateAnalogScaleSyntax(b.Scale.Mode, b.Scale.Factor); e != nil {
		return req, "", "", e
	}
	req = repository.AnalogRequest{
		SourcePositionID: strings.ToLower(b.SourcePositionID),
		ScaleMode:        b.Scale.Mode,
		ScaleFactor:      b.Scale.Factor,
		CopyPrices:       *b.CopyPrices,
	}
	if !apply {
		return req, "", "", nil
	}
	if !repository.ValidAnalogToken(b.PreviewToken) {
		return req, "", "", errors.New("preview_token: обязателен, берётся из предпросмотра.")
	}
	if !uuidPatchRe.MatchString(b.IdempotencyKey) {
		return req, "", "", errors.New("idempotency_key: ожидается UUID.")
	}
	return req, b.PreviewToken, strings.ToLower(b.IdempotencyKey), nil
}

// readAnalogInput читает тело и собирает вход репозитория; при ошибке пишет ответ.
func (h *AnalogHandler) readAnalogInput(w http.ResponseWriter, r *http.Request, apply bool) (repository.AnalogExecuteInput, bool) {
	user := autopriceUser(w, r)
	if user == nil {
		return repository.AnalogExecuteInput{}, false
	}
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return repository.AnalogExecuteInput{}, false
	}
	var raw json.RawMessage
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxAnalogBody)).Decode(&raw); err != nil {
		analogBadRequest(w, "Некорректный JSON.")
		return repository.AnalogExecuteInput{}, false
	}
	req, token, key, err := parseAnalogBody(raw, apply)
	if err != nil {
		var ae *repository.AnalogError
		if errors.As(err, &ae) {
			autopriceError(w, analogStatus(ae.Code), ae.Code, ae.Message, ae.Extras)
		} else {
			analogBadRequest(w, err.Error())
		}
		return repository.AnalogExecuteInput{}, false
	}
	return repository.AnalogExecuteInput{
		PositionID: strings.ToLower(ids[0]), UserID: user.ID, Request: req,
		PreviewToken: token, IdempotencyKey: key,
	}, true
}

// Search handles GET /api/v1/positions/{id}/analogs?q=&limit=.
func (h *AnalogHandler) Search(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return
	}
	limit := 0
	if v := r.URL.Query().Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			analogBadRequest(w, "limit: ожидается целое число от 1 до 30.")
			return
		}
		limit = n
	}
	resp, err := h.store.Search(r.Context(), strings.ToLower(ids[0]), r.URL.Query().Get("q"), limit)
	if err != nil {
		analogFail(w, r, err, "не удалось найти аналоги")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: resp})
}

// GetSource handles GET /api/v1/analogs/sources/{srcId}.
func (h *AnalogHandler) GetSource(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "srcId")
	if !ok {
		return
	}
	src, err := h.store.GetSource(r.Context(), strings.ToLower(ids[0]))
	if err != nil {
		analogFail(w, r, err, "не удалось загрузить позицию-аналог")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: src})
}

// Preview handles POST /api/v1/positions/{id}/analog:preview.
func (h *AnalogHandler) Preview(w http.ResponseWriter, r *http.Request) {
	in, ok := h.readAnalogInput(w, r, false)
	if !ok {
		return
	}
	res, err := h.store.Preview(r.Context(), in)
	if err != nil {
		analogFail(w, r, err, "не удалось построить предпросмотр аналога")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: res})
}

// Apply handles POST /api/v1/positions/{id}/analog:apply.
func (h *AnalogHandler) Apply(w http.ResponseWriter, r *http.Request) {
	in, ok := h.readAnalogInput(w, r, true)
	if !ok {
		return
	}
	res, err := h.store.Apply(r.Context(), in)
	if err != nil {
		analogFail(w, r, err, "не удалось применить аналог")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: res})
}

// ListApplications handles GET /api/v1/positions/{id}/analog-applications.
func (h *AnalogHandler) ListApplications(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return
	}
	apps, err := h.store.ListApplications(r.Context(), strings.ToLower(ids[0]))
	if err != nil {
		analogFail(w, r, err, "не удалось загрузить решения по аналогам")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: apps})
}

// Revert handles POST /api/v1/analog-applications/{id}/revert.
func (h *AnalogHandler) Revert(w http.ResponseWriter, r *http.Request) {
	user := autopriceUser(w, r)
	if user == nil {
		return
	}
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return
	}
	app, err := h.store.Revert(r.Context(), strings.ToLower(ids[0]), user.ID)
	if err != nil {
		analogFail(w, r, err, "не удалось отменить решение по аналогу")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: app})
}

// Next handles GET /api/v1/positions/{id}/analog-next.
func (h *AnalogHandler) Next(w http.ResponseWriter, r *http.Request) {
	ids, ok := autopriceIDs(w, r, "id")
	if !ok {
		return
	}
	next, err := h.store.Next(r.Context(), strings.ToLower(ids[0]))
	if err != nil {
		analogFail(w, r, err, "не удалось найти следующую позицию")
		return
	}
	autopriceJSON(w, http.StatusOK, dataEnvelope{Data: next})
}
