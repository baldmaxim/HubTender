package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Этап 2.6: admin-only rollout endpoints (под RequireRoles в routes.go) +
// расширенная user-capability. Frontend не может передать mode/model/
// provider/budget/quota/circuit override — принимаются только described
// поля; всё остальное игнорируется/валидируется.

// renderAIRolloutError — RFC7807-маппинг rollout-ошибок.
func renderAIRolloutError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, services.ErrAIRolloutTransitionInvalid):
		apierr.AIRolloutTransitionInvalid().Render(w)
	case errors.Is(err, services.ErrAIRolloutGateFailed):
		apierr.AIRolloutGateFailed(err.Error()).Render(w)
	case errors.Is(err, services.ErrAIRolloutConfirmMismatch):
		apierr.AIRolloutConfirmationMismatch().Render(w)
	case errors.Is(err, services.ErrAIPilotSelfAdd):
		apierr.AIPilotSelfAddForbidden().Render(w)
	case errors.Is(err, services.ErrAIPilotUserNotFound):
		apierr.AIPilotUserNotFound().Render(w)
	case errors.Is(err, services.ErrAIEvalLiveGate):
		apierr.AIEvalLiveGateNotMet().Render(w)
	case errors.Is(err, services.ErrAIEvalMode):
		apierr.BadRequest("недопустимый режим evaluation").Render(w)
	default:
		renderAIError(w, r, err)
	}
}

// RolloutState — GET /api/v1/admin/ai/nomenclature/rollout.
func (h *AIAdminHandler) RolloutState(w http.ResponseWriter, r *http.Request) {
	view, err := h.svc.GetRollout(r.Context())
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// RolloutSettings — PUT /api/v1/admin/ai/nomenclature/rollout/settings.
// Только операционные лимиты/бюджет; hard-гейты (§16) не настраиваются.
func (h *AIAdminHandler) RolloutSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		DailyRequestLimit         *int    `json:"daily_request_limit"`
		DailyRowLimit             *int    `json:"daily_row_limit"`
		MonthlyBudgetUSD          *string `json:"monthly_budget_usd"` // decimal-строка; "" = снять
		RequestMaxReservedCost    *string `json:"request_max_reserved_cost"`
		CircuitFailureThreshold   *int    `json:"circuit_failure_threshold"`
		CircuitCooldownSeconds    *int    `json:"circuit_cooldown_seconds"`
		ReservationTimeoutSeconds *int    `json:"reservation_timeout_seconds"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil {
		apierr.BadRequest("некорректное тело запроса").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	view, err := h.svc.UpdateRolloutOperationalSettings(r.Context(), repository.AIRolloutSettingsPatch{
		DailyRequestLimit:         req.DailyRequestLimit,
		DailyRowLimit:             req.DailyRowLimit,
		MonthlyBudgetUSD:          req.MonthlyBudgetUSD,
		RequestMaxReservedCost:    req.RequestMaxReservedCost,
		CircuitFailureThreshold:   req.CircuitFailureThreshold,
		CircuitCooldownSeconds:    req.CircuitCooldownSeconds,
		ReservationTimeoutSeconds: req.ReservationTimeoutSeconds,
	}, authUser.ID)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// RolloutTransition — POST /api/v1/admin/ai/nomenclature/rollout/transition.
// Принимает ТОЛЬКО target/confirmation/reason (§17): model/provider/prompt
// через этот endpoint не передаются.
func (h *AIAdminHandler) RolloutTransition(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Target       string `json:"target"`
		Confirmation string `json:"confirmation"`
		Reason       string `json:"reason"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		apierr.BadRequest("некорректное тело запроса").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	view, err := h.svc.TransitionRollout(r.Context(), strings.TrimSpace(req.Target), req.Confirmation, req.Reason, authUser.ID)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// RolloutEmergencyOff — POST /api/v1/admin/ai/nomenclature/rollout/emergency-off.
// Всегда доступен: не требует OpenRouter, гейтов и confirmation-фразы.
func (h *AIAdminHandler) RolloutEmergencyOff(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req)
	authUser := middleware.UserFromContext(r.Context())
	view, err := h.svc.EmergencyOffRollout(r.Context(), req.Reason, authUser.ID)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// PilotUsersList — GET /api/v1/admin/ai/nomenclature/pilot-users (admin-only).
func (h *AIAdminHandler) PilotUsersList(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.ListPilot(r.Context())
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: list})
}

// PilotUsersAdd — POST /api/v1/admin/ai/nomenclature/pilot-users.
// user_id — только существующий пользователь (admin users API);
// самодобавление запрещено.
func (h *AIAdminHandler) PilotUsersAdd(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID                  string     `json:"user_id"`
		BulkConfirmationAllowed bool       `json:"bulk_confirmation_allowed"`
		ExpiresAt               *time.Time `json:"expires_at"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil || strings.TrimSpace(req.UserID) == "" {
		apierr.BadRequest("user_id обязателен").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	p, err := h.svc.AddPilotUser(r.Context(), strings.TrimSpace(req.UserID), req.BulkConfirmationAllowed, req.ExpiresAt, authUser.ID)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: p})
}

// PilotUsersPatch — PATCH /api/v1/admin/ai/nomenclature/pilot-users/{userId}.
func (h *AIAdminHandler) PilotUsersPatch(w http.ResponseWriter, r *http.Request) {
	userID := chi.URLParam(r, "userId")
	var req struct {
		IsActive                  *bool      `json:"is_active"`
		DailyRequestLimitOverride *int       `json:"daily_request_limit_override"`
		DailyRowLimitOverride     *int       `json:"daily_row_limit_override"`
		BulkConfirmationAllowed   *bool      `json:"bulk_confirmation_allowed"`
		ExpiresAt                 *time.Time `json:"expires_at"`
		ClearExpiresAt            bool       `json:"clear_expires_at"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&req); err != nil {
		apierr.BadRequest("некорректное тело запроса").Render(w)
		return
	}
	p, err := h.svc.PatchPilot(r.Context(), userID, repository.AIPilotPatch{
		IsActive:                  req.IsActive,
		DailyRequestLimitOverride: req.DailyRequestLimitOverride,
		DailyRowLimitOverride:     req.DailyRowLimitOverride,
		BulkConfirmationAllowed:   req.BulkConfirmationAllowed,
		ExpiresAt:                 req.ExpiresAt,
		ClearExpiresAt:            req.ClearExpiresAt,
	})
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: p})
}

// PilotUsersRemove — DELETE /api/v1/admin/ai/nomenclature/pilot-users/{userId}.
func (h *AIAdminHandler) PilotUsersRemove(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.RemovePilot(r.Context(), chi.URLParam(r, "userId")); err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: map[string]bool{"removed": true}})
}

// RolloutUsage — GET /api/v1/admin/ai/nomenclature/usage.
func (h *AIAdminHandler) RolloutUsage(w http.ResponseWriter, r *http.Request) {
	sum, err := h.svc.UsageSummary(r.Context())
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: map[string]any{
		"summary":   sum,
		"cost_unit": services.AICostUnit,
	}})
}

// RolloutEvaluations — GET /api/v1/admin/ai/nomenclature/evaluations.
func (h *AIAdminHandler) RolloutEvaluations(w http.ResponseWriter, r *http.Request) {
	list, err := h.svc.Evaluations(r.Context(), 10)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: list})
}

// RolloutEvaluate — POST /api/v1/admin/ai/nomenclature/evaluate.
// Live-режим гейтится сервисом (env-флаг, ключ, модель, rollout=evaluation,
// подтверждение стоимости).
func (h *AIAdminHandler) RolloutEvaluate(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Mode        string `json:"mode"` // deterministic | mock | live
		ConfirmCost bool   `json:"confirm_live_provider_cost"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		apierr.BadRequest("некорректное тело запроса").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	result, summary, err := h.svc.RunEvaluation(r.Context(), req.Mode, authUser.ID, req.ConfirmCost, true)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: map[string]any{
		"result":  result,
		"summary": summary,
	}})
}

// CircuitReset — POST /api/v1/admin/ai/nomenclature/circuit/reset.
func (h *AIAdminHandler) CircuitReset(w http.ResponseWriter, r *http.Request) {
	c, err := h.svc.ResetCircuit(r.Context())
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: c})
}

// PilotCapability — GET /api/v1/ai/nomenclature-capability (расширение 2.6):
// только состояние ТЕКУЩЕГО пользователя, без allowlist/ledger/секретов.
func (h *AIAdminHandler) PilotCapability(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	view, err := h.svc.PilotCapability(r.Context(), authUser.ID)
	if err != nil {
		renderAIRolloutError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}
