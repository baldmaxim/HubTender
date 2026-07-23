package handlers

import (
	"context"
	"encoding/json"
	"math"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Границы на размер payload: снижение — ручная операция инженера, десятки
// итераций и тысячи позиций перекрывают любой реальный тендер с запасом.
// Нужны, чтобы битый или враждебный запрос не положил jsonb-колонку.
const (
	maxFIDiscountRules       = 200
	maxFIDiscountPositionIDs = 10000
)

// fiDiscountsServicer is the interface FIDiscountsHandler depends on.
type fiDiscountsServicer interface {
	Get(ctx context.Context, tenderID string) (*repository.FIDiscountsRow, error)
	Upsert(ctx context.Context, tenderID string, in repository.FIDiscountsRow, userID string) (*repository.FIDiscountsRow, error)
}

// FIDiscountsHandler serves /api/v1/tenders/{id}/fi-discounts.
type FIDiscountsHandler struct {
	svc fiDiscountsServicer
}

// NewFIDiscountsHandler creates an FIDiscountsHandler.
func NewFIDiscountsHandler(svc fiDiscountsServicer) *FIDiscountsHandler {
	return &FIDiscountsHandler{svc: svc}
}

// Get handles GET /api/v1/tenders/{id}/fi-discounts.
// Тендер без настроек отдаётся как {enabled:false, rules:[]} — фронт в этом
// случае идёт по обычному пути расчёта без снижения.
func (h *FIDiscountsHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	row, err := h.svc.Get(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to load FI discounts")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

// Put handles PUT /api/v1/tenders/{id}/fi-discounts.
// Body: {"enabled": bool, "rules": [{"amount": number, "positionIds": [uuid]}]}.
func (h *FIDiscountsHandler) Put(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var in repository.FIDiscountsRow
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}

	if msg := validateFIDiscountRules(in.Rules); msg != "" {
		apierr.BadRequest(msg).Render(w)
		return
	}
	if in.Mode != "" && in.Mode != "discount" && in.Mode != "zeroing" {
		apierr.BadRequest("mode must be 'discount' or 'zeroing'").Render(w)
		return
	}
	if len(in.ZeroedPositionIDs) > maxFIDiscountPositionIDs {
		apierr.BadRequest("too many zeroed positions").Render(w)
		return
	}

	row, err := h.svc.Upsert(r.Context(), tenderID, in, authUser.ID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to save FI discounts")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

// validateFIDiscountRules returns an empty string when rules are acceptable,
// otherwise a human-readable reason for a 400.
//
// Верхняя граница суммы здесь не проверяется: потолок скидки зависит от прямых
// затрат и каскада наценок тендера, считается на фронте и не воспроизводим
// дёшево в хендлере. Здесь ловим только структурно невалидное.
func validateFIDiscountRules(rules []repository.FIDiscountRule) string {
	if len(rules) > maxFIDiscountRules {
		return "too many discount rules"
	}
	for _, rule := range rules {
		if math.IsNaN(rule.Amount) || math.IsInf(rule.Amount, 0) || rule.Amount <= 0 {
			return "rule amount must be a positive number"
		}
		if len(rule.PositionIDs) == 0 {
			return "rule must reference at least one position"
		}
		if len(rule.PositionIDs) > maxFIDiscountPositionIDs {
			return "too many positions in a single rule"
		}
	}
	return ""
}
