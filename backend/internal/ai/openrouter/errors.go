package openrouter

import (
	"errors"
	"fmt"
)

// Типизированные ошибки OpenRouter-слоя (§20 задания). Наружу (RFC7807)
// уходят только стабильные коды — raw provider body/URL/key не пересекают
// границу пакета.
var (
	// ErrNotConfigured — OPENROUTER_API_KEY не задан. Приложение работает.
	ErrNotConfigured = errors.New("openrouter: not configured")
	// ErrUnauthorized — ключ отклонён (401).
	ErrUnauthorized = errors.New("openrouter: unauthorized")
	// ErrPaymentRequired — недостаточно кредитов (402).
	ErrPaymentRequired = errors.New("openrouter: payment required")
	// ErrRateLimited — 429.
	ErrRateLimited = errors.New("openrouter: rate limited")
	// ErrUnavailable — сеть/5xx/timeout/redirect — временная недоступность.
	ErrUnavailable = errors.New("openrouter: unavailable")
	// ErrInvalidResponse — тело не соответствует официальной схеме.
	ErrInvalidResponse = errors.New("openrouter: invalid response")
	// ErrUpstreamTimeout — 504 от LLM-прокси: исчерпан его серверный дедлайн
	// (deadline_exceeded / attempt_timeout / network_error). Отдельный sentinel
	// нужен, чтобы `/health/ai` и usage-ledger не врали про причину отказа.
	ErrUpstreamTimeout error = upstreamTimeoutError{}
	// ErrEndpointUnsupported — эндпоинта нет у текущего транспорта (у LLM-прокси
	// отсутствуют GET /key и GET /models/user). Это КОНФИГУРАЦИЯ, а не сбой:
	// вызывающий обязан выбрать другой источник данных, а не ретраить.
	ErrEndpointUnsupported = errors.New("openrouter: endpoint not supported by transport")
	// ErrIdempotencyKeyRequired — вызов без X-Idempotency-Key в режиме, где он
	// обязателен. Машинная замена код-ревью: ретраи есть, и без ключа каждый
	// повтор уходит upstream новым платным вызовом.
	ErrIdempotencyKeyRequired = errors.New("openrouter: idempotency key required")
)

// upstreamTimeoutError ОБЯЗАН оборачивать ErrUnavailable: на
// errors.Is(err, ErrUnavailable) завязаны существующие ветки классификации,
// StatusCode() и circuit breaker.
type upstreamTimeoutError struct{}

func (upstreamTimeoutError) Error() string { return "openrouter: upstream timeout" }
func (upstreamTimeoutError) Unwrap() error { return ErrUnavailable }

// StatusCode — стабильный безопасный код для admin API/логов (§20/§21).
// Никогда не содержит upstream-текста.
func StatusCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, ErrNotConfigured):
		return "not_configured"
	case errors.Is(err, ErrUnauthorized):
		return "unauthorized"
	case errors.Is(err, ErrPaymentRequired):
		return "payment_required"
	case errors.Is(err, ErrRateLimited):
		return "rate_limited"
	case errors.Is(err, ErrInvalidResponse):
		return "invalid_response"
	default:
		return "unavailable"
	}
}

// apiError — внутренняя ошибка HTTP-уровня. message не показывается
// пользователю; участвует только в server-side error chain (без тела ответа).
type apiError struct {
	httpStatus int
	code       int
	sentinel   error
}

func (e *apiError) Error() string {
	return fmt.Sprintf("openrouter: http %d (code %d): %v", e.httpStatus, e.code, e.sentinel)
}

func (e *apiError) Unwrap() error { return e.sentinel }

// classifyHTTPStatus — маппинг официальных статусов OpenRouter на sentinel.
func classifyHTTPStatus(status int) error {
	switch {
	case status == 401 || status == 403:
		return ErrUnauthorized
	case status == 402:
		return ErrPaymentRequired
	case status == 429:
		return ErrRateLimited
	case status == 504:
		// Ветка обязана стоять ДО общего 5xx: 504 у прокси означает исчерпанный
		// серверный дедлайн, а не «провайдер сломался».
		return ErrUpstreamTimeout
	case status >= 500 || status == 408 || status == 524 || status == 529:
		return ErrUnavailable
	default:
		// 400/404/413/422 — невалидный запрос/модель: не retry (§4.14).
		return ErrInvalidResponse
	}
}

// retryableStatus — единственный допустимый transient retry (§4.13):
// 429 (с учётом Retry-After) и 5xx. 400/401/402/422 не ретраятся.
func retryableStatus(status int) bool {
	return status == 429 || status >= 500
}
