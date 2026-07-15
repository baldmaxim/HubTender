package handlers

import (
	"net/http"

	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// RecalcHealthHandler — этап 2.4 (§3): GET /health/recalc — безопасные
// диагностические счётчики recovery (stale/calculating/failed counts, возраст
// самых старых, последний скан). Без финансовых данных и BOQ-контента.
type RecalcHealthHandler struct {
	recovery *services.FinancialCalculationRecoveryService
}

// NewRecalcHealthHandler creates a RecalcHealthHandler.
func NewRecalcHealthHandler(recovery *services.FinancialCalculationRecoveryService) *RecalcHealthHandler {
	return &RecalcHealthHandler{recovery: recovery}
}

// Diagnostics handles GET /health/recalc.
func (h *RecalcHealthHandler) Diagnostics(w http.ResponseWriter, r *http.Request) {
	diag, err := h.recovery.Diagnostics(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "recalc diagnostics failed")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: diag})
}
