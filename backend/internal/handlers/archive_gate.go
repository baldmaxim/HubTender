package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/su10/hubtender/backend/internal/apikey"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// apiAccessGate — настройки выдачи API, управляемые из «Настройки → Доступ к API».
type apiAccessGate interface {
	EnsureEndpointEnabled(ctx context.Context, endpoint string) error
	Settings(ctx context.Context) (*repository.ApiAccessSettings, error)
}

// Идентификаторы эндпоинтов для тумблеров.
const (
	endpointArchiveSearch  = "archive.search"
	endpointArchiveRead    = "archive.read"
	endpointArchiveSuggest = "archive.suggest"
	endpointArchiveCompose = "archive.compose"
)

// allow проверяет тумблер эндпоинта и, для машинного вызова, область ключа.
// Возвращает false, когда ответ уже отправлен и обработку надо прекратить.
func (h *ArchiveHandler) allow(w http.ResponseWriter, r *http.Request, endpoint, scope string) bool {
	if h.gate != nil {
		if err := h.gate.EnsureEndpointEnabled(r.Context(), endpoint); err != nil {
			if errors.Is(err, services.ErrEndpointDisabled) {
				setCallError(r.Context(), "ENDPOINT_DISABLED")
				apierr.ServiceUnavailable("эндпоинт отключён администратором").Render(w)
				return false
			}
			// Настройки не прочитались — это отказ инфраструктуры, а не отказ
			// в доступе: не выдаём данные вслепую.
			apierr.InternalFromErr(w, r, err, "не удалось прочитать настройки доступа к API")
			return false
		}
	}

	// Ограничения области действуют только на машинный доступ: у человека с
	// JWT прав ровно столько, сколько даёт его роль и список страниц.
	if p := middleware.APIKeyFromContext(r.Context()); p != nil && !p.HasScope(scope) {
		setCallError(r.Context(), "API_KEY_SCOPE_DENIED")
		apierr.Forbidden("ключу не выдана область " + scope).Render(w)
		return false
	}
	return true
}

// allowTender проверяет, что ключ не ограничен другим списком тендеров.
func (h *ArchiveHandler) allowTender(w http.ResponseWriter, r *http.Request, tenderID string) bool {
	p := middleware.APIKeyFromContext(r.Context())
	if p == nil || p.AllowsTender(tenderID) {
		return true
	}
	setCallError(r.Context(), "API_KEY_TENDER_DENIED")
	apierr.Forbidden("ключу не разрешён этот тендер").Render(w)
	return false
}

// limits возвращает действующие потолки. Настройки недоступны — берём
// зашитые значения: поиск не должен падать из-за административной таблицы.
func (h *ArchiveHandler) limits(ctx context.Context) (searchLimit, candidateLimit, suggestQueries int) {
	searchLimit = services.MaxArchiveSearchLimit
	candidateLimit = repository.MaxCandidateLimit
	suggestQueries = services.MaxSuggestQueries
	if h.gate == nil {
		return
	}
	st, err := h.gate.Settings(ctx)
	if err != nil || st == nil {
		return
	}
	return st.MaxSearchLimit, st.MaxCandidateLimit, st.MaxSuggestQueries
}

// clampPositive прижимает запрошенное значение к потолку; 0 = «по умолчанию».
func clampPositive(requested, max int) int {
	if max <= 0 {
		return requested
	}
	if requested <= 0 || requested > max {
		return max
	}
	return requested
}

// setCallError помечает код ошибки для журнала вызовов.
func setCallError(ctx context.Context, code string) {
	if s := middleware.CallStatFromContext(ctx); s != nil {
		s.ErrorCode = code
	}
}

// Область, требуемая эндпоинтом.
const (
	scopeRead  = apikey.ScopeArchiveRead
	scopeWrite = apikey.ScopeArchiveWrite
)
