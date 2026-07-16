package handlers

import (
	"net/http"

	"github.com/su10/hubtender/backend/internal/services"
)

// AIHealthHandler — этап 2.6 (§22): GET /health/ai — операционная
// диагностика rollout. ТОЛЬКО безопасные поля: без API key, user ID,
// row text, prompts/responses и финансовых данных.
type AIHealthHandler struct {
	svc   *services.AIAdminService
	maint *services.AIRolloutMaintenanceService
}

// NewAIHealthHandler creates an AIHealthHandler.
func NewAIHealthHandler(svc *services.AIAdminService, maint *services.AIRolloutMaintenanceService) *AIHealthHandler {
	return &AIHealthHandler{svc: svc, maint: maint}
}

// Diagnostics — редактированная сводка состояния.
func (h *AIHealthHandler) Diagnostics(w http.ResponseWriter, r *http.Request) {
	out := map[string]any{}

	if view, err := h.svc.GetRollout(r.Context()); err == nil {
		modelID := ""
		if view.SelectedModelID != nil {
			modelID = *view.SelectedModelID
		}
		out["rollout_mode"] = view.Mode
		out["selected_model"] = modelID
		out["model_test_status"] = view.ModelTestStatus
		out["live_evaluation_current"] = view.LiveEvaluation != nil && view.LiveEvaluation.Current && view.LiveEvaluation.GatesPassed
		out["pilot_users_count"] = view.PilotUsersCount
		out["cost_unit"] = view.CostUnit
		if view.Circuit != nil {
			out["circuit_state"] = view.Circuit.State
			out["circuit_failures"] = view.Circuit.ConsecutiveFailures
			if view.Circuit.LastFailureCode != nil {
				out["last_provider_failure_code"] = *view.Circuit.LastFailureCode
			}
			if view.Circuit.LastSuccessAt != nil {
				out["last_provider_success_at"] = view.Circuit.LastSuccessAt
			}
		}
	} else {
		out["rollout"] = "unavailable"
	}

	if usage, err := h.svc.UsageSummary(r.Context()); err == nil {
		out["requests_today"] = usage.RequestsToday
		out["rows_today"] = usage.RowsToday
		out["requests_month"] = usage.RequestsMonth
		out["provider_cost_month"] = usage.ProviderCostMonth
		out["estimated_cost_month"] = usage.EstimatedCostMonth
		out["active_reservations"] = usage.ActiveReservations
		out["oldest_reservation_age_seconds"] = usage.OldestReservationSec
	}

	if h.maint != nil {
		out["maintenance"] = h.maint.Diagnostics()
	}

	conn := h.svc.Status(r.Context())
	out["key_status"] = conn.Connection
	if conn.CheckedAt != nil {
		out["key_status_checked_at"] = conn.CheckedAt
	}

	renderJSON(w, r, http.StatusOK, out)
}
