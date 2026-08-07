package openrouter

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// Транспорт LLM-вызова: прямой OpenRouter либо собственный LLM-прокси.
//
// Прокси нужен там, где у хоста нет исходящего доступа к openrouter.ai. Он
// OpenAI-совместим по /chat/completions, но НЕ отдаёт ни GET /key, ни
// GET /models/user, и молча вырезает из тела поля model/models/provider/route/
// transforms/plugins/stream/stream_options/debug. Всё, что из этого следует,
// собрано в transportProfile — единственном месте, где режимы расходятся.
//
// Режим задаётся ТОЛЬКО server config. Из request/frontend он не принимается —
// тот же инвариант, что и для base URL и модели.

type Transport string

const (
	// TransportOpenRouter — прямые вызовы openrouter.ai (режим по умолчанию).
	TransportOpenRouter Transport = "openrouter"
	// TransportProxyLLM — вызовы через LLM-прокси, вариант A (модель выбирает
	// прокси; в поле model уходит заглушка ProxyModelID).
	TransportProxyLLM Transport = "proxy_llm"
)

// String — каноническое значение режима для env/логов/admin API.
func String(t Transport) string { return string(t) }

// ParseTransport — строгий разбор значения env. Опечатка обязана быть громкой:
// молчаливый откат на openrouter означал бы вызовы в сеть, которой у хоста нет.
func ParseTransport(s string) (Transport, error) {
	switch Transport(strings.ToLower(strings.TrimSpace(s))) {
	case "", TransportOpenRouter:
		return TransportOpenRouter, nil
	case TransportProxyLLM:
		return TransportProxyLLM, nil
	default:
		return "", fmt.Errorf("openrouter: unknown transport %q (want %q or %q)",
			s, TransportOpenRouter, TransportProxyLLM)
	}
}

// transportProfile — поведенческие отличия режима.
type transportProfile struct {
	// supportsKeyAPI / supportsCatalog — есть ли у транспорта GET /key и
	// GET /models/user. У прокси их нет, и вызывать их бессмысленно: 404
	// приехал бы как «провайдер недоступен» и навсегда заблокировал активацию.
	supportsKeyAPI  bool
	supportsCatalog bool
	// sendProvider — отправлять ли объект provider (ZDR, data_collection).
	// У прокси он вырезается; отправлять его «на всякий случай» значило бы
	// маскировать потерю гарантии — не отправляем осознанно.
	sendProvider bool
	// requireIdempotencyKey — вызов без X-Idempotency-Key считается ошибкой
	// программиста: ретраи есть, а без ключа каждый повтор оплачивается заново.
	requireIdempotencyKey bool
	// sendVendorHeaders — маркетинговые HTTP-Referer / X-Title OpenRouter.
	// Прокси их не использует, а X-Title протекает как метаданные.
	sendVendorHeaders bool
	// allowUIKey — можно ли брать ключ из БД (UI-ключ). Для прокси нельзя:
	// там лежит sk-or-…, который прокси отвергнет с 401 при зелёной админке.
	allowUIKey bool
	// retryOn502 — 502 у прокси означает upstream_response_too_large, отказ
	// детерминированный: ретрай только сожжёт бюджет.
	retryOn502 bool
}

func (t Transport) profile() transportProfile {
	if t == TransportProxyLLM {
		return transportProfile{
			supportsKeyAPI:        false,
			supportsCatalog:       false,
			sendProvider:          false,
			requireIdempotencyKey: true,
			sendVendorHeaders:     false,
			allowUIKey:            false,
			retryOn502:            false,
		}
	}
	return transportProfile{
		supportsKeyAPI:        true,
		supportsCatalog:       true,
		sendProvider:          true,
		requireIdempotencyKey: false,
		sendVendorHeaders:     true,
		allowUIKey:            true,
		retryOn502:            true,
	}
}

// ── Base URL ─────────────────────────────────────────────────────────────────

// NormalizeProxyBaseURL приводит базу прокси к ORIGIN без хвостовых слэшей.
//
// Origin, а не «…/api/v1», по двум причинам: /healthz живёт вне /api/v1, а
// оператор в конфиге может дать любую из двух форм — без нормализации получим
// /api/v1/api/v1/chat/completions. requireHTTPS включается в production:
// http-база означала бы Bearer-токен открытым текстом.
func NormalizeProxyBaseURL(raw string, requireHTTPS bool) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", fmt.Errorf("openrouter: proxy base URL is empty")
	}
	u, err := url.Parse(strings.TrimRight(s, "/"))
	if err != nil {
		return "", fmt.Errorf("openrouter: invalid proxy base URL")
	}
	if u.Host == "" {
		return "", fmt.Errorf("openrouter: proxy base URL has no host")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if requireHTTPS {
			return "", fmt.Errorf("openrouter: proxy base URL must use https in production")
		}
	default:
		return "", fmt.Errorf("openrouter: proxy base URL scheme must be http(s)")
	}
	if u.User != nil {
		return "", fmt.Errorf("openrouter: proxy base URL must not contain credentials")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("openrouter: proxy base URL must not contain query or fragment")
	}
	// Оператор мог дать и origin, и SDK-форму с /api/v1 — принимаем обе.
	p := strings.TrimRight(u.Path, "/")
	p = strings.TrimSuffix(p, "/api/v1")
	if strings.Trim(p, "/") != "" {
		return "", fmt.Errorf("openrouter: proxy base URL must be an origin (optionally with /api/v1)")
	}
	return u.Scheme + "://" + u.Host, nil
}

// chatBaseURL — база, которую получает HTTP-клиент. У прокси путь до
// chat-эндпоинта — /api/v1, у OpenRouter он уже входит в официальный base.
func chatBaseURL(t Transport, origin string) string {
	if t == TransportProxyLLM {
		return origin + "/api/v1"
	}
	return origin
}

// ── Ошибки прокси ────────────────────────────────────────────────────────────

// proxyErrorEnvelope — конверт ошибки САМОГО прокси: {"error":{"code","message"}},
// где code — СТРОКА ("queue_full"), в отличие от числового кода OpenRouter.
// Ошибки OpenRouter прокси пробрасывает как есть, без конверта, поэтому пустой
// результат здесь — норма, а не сбой разбора.
type proxyErrorEnvelope struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// proxyErrorCode — стабильный код ошибки прокси для логов. Ориентир при выборе
// поведения — HTTP-статус (SKILL §7); код читается опционально, для диагностики.
// Наружу пользователю не отдаётся: message прокси может содержать upstream-текст.
func proxyErrorCode(data []byte) string {
	var env proxyErrorEnvelope
	if json.Unmarshal(data, &env) != nil {
		return ""
	}
	return env.Error.Code
}
