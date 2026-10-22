package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type verificationBotServicer interface {
	HandleUpdate(ctx context.Context, u telegram.Update) ([]services.BotAction, error)
	Claim(ctx context.Context, botUsername string, limit int) ([]services.BotOutMessage, error)
	ReportResult(ctx context.Context, id string, r services.SendResult) (string, error)
}

// VerificationBotHandler — рассылка замечаний «Проверки данных» для внешнего
// Telegram-бота по машинному ключу (api/VERIFICATION_BOT.md). Ответы — {data},
// ошибки — RFC 7807 с машинным code: VERIFICATION_BOT_INVALID_REQUEST,
// VERIFICATION_BOT_NOT_FOUND.
type VerificationBotHandler struct {
	svc verificationBotServicer
}

func NewVerificationBotHandler(svc verificationBotServicer) *VerificationBotHandler {
	return &VerificationBotHandler{svc: svc}
}

func (h *VerificationBotHandler) decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, registryBodyLimit)).Decode(v); err != nil {
		registryProblem(w, r, http.StatusBadRequest, "VERIFICATION_BOT_INVALID_REQUEST", "Тело запроса — JSON-объект до 64 КБ.")
		return false
	}
	return true
}

type verificationBotUpdateRequest struct {
	Update *telegram.Update `json:"update"`
}

// PostUpdates handles POST /api/v1/verification-bot/updates — одно обновление
// Telegram; в ответ действия, которые бот должен выполнить.
func (h *VerificationBotHandler) PostUpdates(w http.ResponseWriter, r *http.Request) {
	var req verificationBotUpdateRequest
	if !h.decode(w, r, &req) {
		return
	}
	if req.Update == nil {
		registryProblem(w, r, http.StatusBadRequest, "VERIFICATION_BOT_INVALID_REQUEST", "update: ожидается обновление Telegram.")
		return
	}
	actions, err := h.svc.HandleUpdate(r.Context(), *req.Update)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "verification bot update failed")
		return
	}
	middleware.SetCallItems(r.Context(), len(actions), false)
	renderRegistry(w, r, http.StatusOK, map[string]any{"actions": actions})
}

type verificationBotClaimRequest struct {
	BotUsername string `json:"bot_username"`
	Limit       int    `json:"limit"`
}

// PostClaim handles POST /api/v1/verification-bot/claim — сообщения очереди,
// которые пора отправить; заодно отметка «бот в сети».
func (h *VerificationBotHandler) PostClaim(w http.ResponseWriter, r *http.Request) {
	var req verificationBotClaimRequest
	if !h.decode(w, r, &req) {
		return
	}
	messages, err := h.svc.Claim(r.Context(), req.BotUsername, req.Limit)
	switch {
	case errors.Is(err, services.ErrBotUsernameInvalid):
		registryProblem(w, r, http.StatusBadRequest, "VERIFICATION_BOT_INVALID_REQUEST",
			"bot_username: имя бота без «@», 5–32 символа (латиница, цифры, «_»).")
		return
	case err != nil:
		apierr.InternalFromErr(w, r, err, "verification bot claim failed")
		return
	}
	middleware.SetCallItems(r.Context(), len(messages), false)
	renderRegistry(w, r, http.StatusOK, map[string]any{"messages": messages})
}

// PostResult handles POST /api/v1/verification-bot/notifications/{id}/result —
// итог отправки сообщения; повтор по закрытому сообщению безвреден.
func (h *VerificationBotHandler) PostResult(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if !uuidPatchRe.MatchString(id) {
		registryProblem(w, r, http.StatusBadRequest, "VERIFICATION_BOT_INVALID_REQUEST", "id: ожидается uuid сообщения")
		return
	}
	var req services.SendResult
	if !h.decode(w, r, &req) {
		return
	}
	status, err := h.svc.ReportResult(r.Context(), strings.ToLower(id), req)
	switch {
	case errors.Is(err, repository.ErrNotificationNotFound):
		registryProblem(w, r, http.StatusNotFound, "VERIFICATION_BOT_NOT_FOUND", "Сообщения нет в очереди.")
		return
	case err != nil:
		apierr.InternalFromErr(w, r, err, "verification bot result failed")
		return
	}
	middleware.SetCallItems(r.Context(), 1, false)
	renderRegistry(w, r, http.StatusOK, map[string]string{"status": status})
}
