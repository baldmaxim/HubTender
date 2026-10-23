package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// UsageAdminRoles — кто видит статистику «Использование портала».
var UsageAdminRoles = map[string]bool{
	"administrator": true,
	"developer":     true,
	"director":      true,
}

const (
	pageViewMaxLen      = 200
	pageViewMaxBody     = 1024
	pageStatsDefaultDay = 30
	pageStatsMaxDays    = 180
)

// pageViewsServicer — граница сервиса.
type pageViewsServicer interface {
	Record(ctx context.Context, userID, page string) error
	Stats(ctx context.Context, days int) (*repository.PageStats, error)
}

// PageViewsHandler обслуживает /api/v1/usage/page-view и /api/v1/admin/usage/page-stats.
type PageViewsHandler struct {
	svc pageViewsServicer
}

// NewPageViewsHandler creates a PageViewsHandler.
func NewPageViewsHandler(svc pageViewsServicer) *PageViewsHandler {
	return &PageViewsHandler{svc: svc}
}

type pageViewReq struct {
	Page string `json:"page"`
}

// validatePageViewPath проверяет ключ страницы: путь-шаблон без query и фрагмента.
func validatePageViewPath(page string) error {
	switch {
	case !strings.HasPrefix(page, "/"):
		return errors.New("page must start with '/'")
	case utf8.RuneCountInString(page) > pageViewMaxLen:
		return errors.New("page is too long")
	case strings.ContainsAny(page, "?#"):
		return errors.New("page must not contain '?' or '#'")
	}
	return nil
}

// parsePageStatsDays разбирает ?days=: пусто — 30, иначе целое 1..180.
func parsePageStatsDays(raw string) (int, error) {
	if raw == "" {
		return pageStatsDefaultDay, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > pageStatsMaxDays {
		return 0, errors.New("days must be an integer between 1 and 180")
	}
	return n, nil
}

// Record handles POST /api/v1/usage/page-view.
//
// Учёт вторичен: сбой записи логируется, но пользователю всё равно 204.
func (h *PageViewsHandler) Record(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req pageViewReq
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, pageViewMaxBody)).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := validatePageViewPath(req.Page); err != nil {
		apierr.BadRequest(err.Error()).Render(w)
		return
	}

	if err := h.svc.Record(r.Context(), authUser.ID, req.Page); err != nil {
		log.Warn().Err(err).Str("user_id", authUser.ID).Str("page", req.Page).Msg("page view not recorded")
	}
	w.WriteHeader(http.StatusNoContent)
}

// Stats handles GET /api/v1/admin/usage/page-stats?days=30.
func (h *PageViewsHandler) Stats(w http.ResponseWriter, r *http.Request) {
	days, err := parsePageStatsDays(r.URL.Query().Get("days"))
	if err != nil {
		apierr.BadRequest(err.Error()).Render(w)
		return
	}
	stats, err := h.svc.Stats(r.Context(), days)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "не удалось загрузить статистику использования")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: stats})
}
