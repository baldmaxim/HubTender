package openrouter

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL — официальный OpenRouter API base (§3 задания).
const DefaultBaseURL = "https://openrouter.ai/api/v1"

// AllowedBaseURLs — явный allowlist официальных base URLs. Других регионов
// OpenRouter официально не публикует; появление EU-endpoint = осознанное
// расширение этого списка (server config, никогда не UI/request).
var AllowedBaseURLs = map[string]bool{
	DefaultBaseURL: true,
}

// Лимиты чтения тел ответов (§4.4): каталог моделей объёмный, остальное — нет.
const (
	maxKeyBodyBytes    = 1 << 20  // 1 MiB
	maxModelsBodyBytes = 32 << 20 // 32 MiB (до 1000 моделей на страницу)
	maxChatBodyBytes   = 4 << 20  // 4 MiB
	// modelsPageLimit — официальный максимум limit для /models/user.
	modelsPageLimit = 1000
	// maxModelPages — предохранитель от бесконечной pagination.
	maxModelPages = 20
)

// Config — server-only конфигурация клиента. APIKey никогда не логируется
// и не сериализуется (нет json-тегов; String() ключ не печатает).
type Config struct {
	APIKey      string
	BaseURL     string // валидируется по AllowedBaseURLs в config-слое (production)
	HTTPReferer string // необязательный маркетинговый заголовок OpenRouter
	AppTitle    string
	Timeout     time.Duration // общий таймаут одного вызова (default 30s)
}

// Client — изолированный HTTP-клиент OpenRouter (§4). Все вызовы server-side;
// base URL/модель/prompt из запросов пользователей не принимаются.
type Client struct {
	cfg      Config
	baseURL  *url.URL
	http     *http.Client
	timeNow  func() time.Time // DI для тестов
	sleepFor func(d time.Duration, ctx context.Context) error
}

// New строит клиент. Пустой APIKey допустим — вызовы вернут ErrNotConfigured
// (§3: приложение обязано запускаться без ключа).
func New(cfg Config, opts ...Option) (*Client, error) {
	if strings.TrimSpace(cfg.BaseURL) == "" {
		cfg.BaseURL = DefaultBaseURL
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = 30 * time.Second
	}
	base, err := url.Parse(strings.TrimRight(cfg.BaseURL, "/"))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, fmt.Errorf("openrouter: invalid base URL")
	}
	c := &Client{
		cfg:     cfg,
		baseURL: base,
		timeNow: time.Now,
		sleepFor: func(d time.Duration, ctx context.Context) error {
			t := time.NewTimer(d)
			defer t.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-t.C:
				return nil
			}
		},
	}
	c.http = &http.Client{
		// Redirect на другой host не выполняется НИКОГДА (§4.10). Redirect
		// в пределах того же host OpenRouter не использует — отклоняем все:
		// предсказуемо и исключает SSRF-подобные цепочки.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return fmt.Errorf("openrouter: redirect refused (to %s)", req.URL.Host)
		},
		Timeout: cfg.Timeout,
		// Transport по умолчанию: системный пул + полная TLS-валидация (§4.9).
	}
	for _, o := range opts {
		o(c)
	}
	return c, nil
}

// Option — DI-хуки (§4.12): подмена http.Client в тестах.
type Option func(*Client)

// WithHTTPClient — тестовая подмена транспорта (fake OpenRouter server).
func WithHTTPClient(h *http.Client) Option {
	return func(c *Client) {
		redirectGuard := c.http.CheckRedirect
		c.http = h
		if c.http.CheckRedirect == nil {
			c.http.CheckRedirect = redirectGuard
		}
	}
}

// Configured — задан ли API key (единственное, что видит admin API: §3).
func (c *Client) Configured() bool { return strings.TrimSpace(c.cfg.APIKey) != "" }

// BaseHost — host base URL для безопасного лога (без ключа/пути).
func (c *Client) BaseHost() string { return c.baseURL.Host }

// ── HTTP core ────────────────────────────────────────────────────────────────

// doJSON — один вызов с общим таймаутом, лимитом тела и одним transient
// retry (§4.13-14). out — указатель на envelope; тело при не-2xx парсится
// только для классификации и НИКОГДА не возвращается наружу.
func (c *Client) doJSON(ctx context.Context, method, path string, query url.Values, body any, out any, maxBody int64) error {
	if !c.Configured() {
		return ErrNotConfigured
	}
	ctx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()

	var payload []byte
	if body != nil {
		var err error
		payload, err = json.Marshal(body)
		if err != nil {
			return fmt.Errorf("openrouter: marshal request: %w", err)
		}
	}

	attempt := func() error {
		u := *c.baseURL
		u.Path = strings.TrimRight(u.Path, "/") + path
		if query != nil {
			u.RawQuery = query.Encode()
		}
		var reader io.Reader
		if payload != nil {
			reader = bytes.NewReader(payload)
		}
		req, err := http.NewRequestWithContext(ctx, method, u.String(), reader)
		if err != nil {
			return fmt.Errorf("openrouter: build request: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
		req.Header.Set("Accept", "application/json")
		if payload != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		if c.cfg.HTTPReferer != "" {
			req.Header.Set("HTTP-Referer", c.cfg.HTTPReferer)
		}
		if c.cfg.AppTitle != "" {
			req.Header.Set("X-Title", c.cfg.AppTitle)
		}

		resp, err := c.http.Do(req)
		if err != nil {
			return classifyTransportError(err)
		}
		defer resp.Body.Close()

		limited := io.LimitReader(resp.Body, maxBody+1)
		data, err := io.ReadAll(limited)
		if err != nil {
			return classifyTransportError(err)
		}
		if int64(len(data)) > maxBody {
			return fmt.Errorf("openrouter: response body exceeds limit: %w", ErrInvalidResponse)
		}

		if resp.StatusCode < 200 || resp.StatusCode > 299 {
			return httpError(resp, data)
		}
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("openrouter: decode response: %w", ErrInvalidResponse)
		}
		return nil
	}

	err := attempt()
	if err == nil {
		return nil
	}
	if wait, ok := retryDelay(err); ok {
		if deadline, has := ctx.Deadline(); has {
			remaining := deadline.Sub(c.timeNow())
			if wait >= remaining {
				return err // retry не влезает в общий таймаут — не ждём зря
			}
		}
		if serr := c.sleepFor(wait, ctx); serr != nil {
			return err
		}
		if rerr := attempt(); rerr == nil {
			return nil
		} else {
			return rerr
		}
	}
	return err
}

// httpError — типизация не-2xx: тело парсится только ради официального
// {"error":{code,message}} и НЕ пробрасывается наружу (§4.7).
func httpError(resp *http.Response, data []byte) error {
	sentinel := classifyHTTPStatus(resp.StatusCode)
	code := 0
	var env errorEnvelope
	if json.Unmarshal(data, &env) == nil {
		code = env.Error.Code
	}
	err := &apiError{httpStatus: resp.StatusCode, code: code, sentinel: sentinel}
	if resp.StatusCode == 429 {
		if d, ok := parseRetryAfter(resp.Header.Get("Retry-After")); ok {
			return &retryAfterError{apiError: err, after: d}
		}
	}
	return err
}

// retryAfterError — 429 с сервером-заданной паузой.
type retryAfterError struct {
	*apiError
	after time.Duration
}

// classifyTransportError — сетевые ошибки → ErrUnavailable (timeout — тоже
// unavailable, но помечаем retriable только temporary/timeout).
func classifyTransportError(err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("openrouter: timeout: %w", ErrUnavailable)
	}
	var nerr net.Error
	if errors.As(err, &nerr) && nerr.Timeout() {
		return &transientError{inner: fmt.Errorf("openrouter: network timeout: %w", ErrUnavailable)}
	}
	var uerr *url.Error
	if errors.As(err, &uerr) && strings.Contains(uerr.Err.Error(), "redirect refused") {
		// Redirect на неизвестный host — НЕ transient и не retry.
		return fmt.Errorf("openrouter: redirect refused: %w", ErrUnavailable)
	}
	return &transientError{inner: fmt.Errorf("openrouter: network error: %w", ErrUnavailable)}
}

// transientError — временная сетевая ошибка, допускающая один retry.
type transientError struct{ inner error }

func (e *transientError) Error() string { return e.inner.Error() }
func (e *transientError) Unwrap() error { return e.inner }

// retryDelay — решение о единственном retry (§4.13): transient network,
// 429 c Retry-After, 5xx. Всё остальное — нет.
func retryDelay(err error) (time.Duration, bool) {
	var ra *retryAfterError
	if errors.As(err, &ra) {
		return ra.after, true
	}
	var te *transientError
	if errors.As(err, &te) {
		return 500 * time.Millisecond, true
	}
	var ae *apiError
	if errors.As(err, &ae) && retryableStatus(ae.httpStatus) {
		return 500 * time.Millisecond, true
	}
	return 0, false
}

// parseRetryAfter — секунды либо HTTP-date.
func parseRetryAfter(v string) (time.Duration, bool) {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0, false
	}
	if secs, err := strconv.Atoi(v); err == nil && secs >= 0 {
		return time.Duration(secs) * time.Second, true
	}
	if t, err := http.ParseTime(v); err == nil {
		d := time.Until(t)
		if d < 0 {
			d = 0
		}
		return d, true
	}
	return 0, false
}

// ── Endpoint methods ─────────────────────────────────────────────────────────

// GetKeyStatus — GET /key: label/limit/usage. Ключ в ответе отсутствует.
func (c *Client) GetKeyStatus(ctx context.Context) (KeyStatus, error) {
	var env keyStatusEnvelope
	if err := c.doJSON(ctx, http.MethodGet, "/key", nil, nil, &env, maxKeyBodyBytes); err != nil {
		return KeyStatus{}, err
	}
	d := env.Data
	return KeyStatus{
		Label: d.Label, Limit: d.Limit, LimitRemaining: d.LimitRemaining,
		LimitReset: d.LimitReset, Usage: d.Usage, UsageDaily: d.UsageDaily,
		UsageWeekly: d.UsageWeekly, UsageMonthly: d.UsageMonthly,
		ByokUsage: d.ByokUsage, IsFreeTier: d.IsFreeTier, ExpiresAt: d.ExpiresAt,
	}, nil
}

// ListUserModels — GET /models/user со ВСЕЙ pagination (§5: не предполагаем
// одну страницу). Возвращает сырые модели; нормализация — в catalog.go.
func (c *Client) ListUserModels(ctx context.Context) ([]rawModel, error) {
	var all []rawModel
	offset := 0
	for page := 0; page < maxModelPages; page++ {
		q := url.Values{}
		q.Set("limit", strconv.Itoa(modelsPageLimit))
		if offset > 0 {
			q.Set("offset", strconv.Itoa(offset))
		}
		var env modelsEnvelope
		if err := c.doJSON(ctx, http.MethodGet, "/models/user", q, nil, &env, maxModelsBodyBytes); err != nil {
			return nil, err
		}
		all = append(all, env.Data...)
		if env.Links.Next == nil || *env.Links.Next == "" || len(env.Data) == 0 {
			return all, nil
		}
		offset += len(env.Data)
		if env.TotalCount > 0 && offset >= env.TotalCount {
			return all, nil
		}
	}
	return all, nil
}

// CreateChatCompletion — POST /chat/completions (non-streaming, без tools).
func (c *Client) CreateChatCompletion(ctx context.Context, req ChatRequest) (ChatResponse, error) {
	var env chatEnvelope
	if err := c.doJSON(ctx, http.MethodPost, "/chat/completions", nil, req, &env, maxChatBodyBytes); err != nil {
		return ChatResponse{}, err
	}
	if env.Error != nil {
		return ChatResponse{}, &apiError{httpStatus: 200, code: env.Error.Code, sentinel: classifyEmbeddedError(env.Error.Code)}
	}
	if len(env.Choices) == 0 {
		return ChatResponse{}, fmt.Errorf("openrouter: empty choices: %w", ErrInvalidResponse)
	}
	var content string
	if err := json.Unmarshal(env.Choices[0].Message.Content, &content); err != nil {
		return ChatResponse{}, fmt.Errorf("openrouter: non-text content: %w", ErrInvalidResponse)
	}
	return ChatResponse{ID: env.ID, Model: env.Model, Content: content, Usage: env.Usage}, nil
}

// classifyEmbeddedError — error-объект внутри 200-тела.
func classifyEmbeddedError(code int) error {
	if code >= 400 && code <= 599 {
		return classifyHTTPStatus(code)
	}
	return ErrInvalidResponse
}
