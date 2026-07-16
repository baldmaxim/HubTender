package openrouter

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// ── Нормализация и фильтрация каталога (§5/§6 задания) ──────────────────────

// routerAuthor — модели с author-сегментом OpenRouter — динамические
// router/alias-псевдомодели (openrouter/auto и т.п.), а не фиксированные
// модели. Metadata-признак: автор каталога — сам OpenRouter, плюс
// отрицательные (динамические) цены. Оба признака — из фактических данных
// каталога, не из хрупкого regex по названию.
const routerAuthor = "openrouter"

// IsRouterModel — определение router/alias по metadata (§6).
func IsRouterModel(m rawModel) bool {
	if modelAuthor(m.ID) == routerAuthor {
		return true
	}
	if isNegativePrice(m.Pricing.Prompt) || isNegativePrice(m.Pricing.Completion) {
		return true
	}
	return false
}

func modelAuthor(id string) string {
	if i := strings.IndexByte(id, '/'); i > 0 {
		return id[:i]
	}
	return ""
}

func hasString(list []string, want string) bool {
	for _, s := range list {
		if s == want {
			return true
		}
	}
	return false
}

// isExpired — expiration_date в прошлом (UTC-день). Пустая дата = бессрочно.
func isExpired(expiration *string, now time.Time) bool {
	if expiration == nil || strings.TrimSpace(*expiration) == "" {
		return false
	}
	raw := strings.TrimSpace(*expiration)
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return !t.After(now)
		}
	}
	// Непарсимая дата — модель не скрываем, но и не считаем истёкшей.
	return false
}

// NormalizeModel — rawModel → Model (server-calculated display-поля).
func NormalizeModel(m rawModel) Model {
	maxCompletion := m.TopProvider.MaxCompletionTokens
	ctxLen := m.ContextLength
	if ctxLen == nil {
		ctxLen = m.TopProvider.ContextLength
	}
	modality := ""
	if m.Architecture.Modality != nil {
		modality = *m.Architecture.Modality
	}
	tokenizer := ""
	if m.Architecture.Tokenizer != nil {
		tokenizer = *m.Architecture.Tokenizer
	}
	return Model{
		ID:                  m.ID,
		CanonicalSlug:       m.CanonicalSlug,
		Name:                m.Name,
		Description:         m.Description,
		CreatedAt:           time.Unix(m.Created, 0).UTC().Format(time.RFC3339),
		ExpirationDate:      m.ExpirationDate,
		ContextLength:       ctxLen,
		MaxCompletionTokens: maxCompletion,
		InputModalities:     m.Architecture.InputModalities,
		OutputModalities:    m.Architecture.OutputModalities,
		Modality:            modality,
		Tokenizer:           tokenizer,

		PromptPricePerToken:     m.Pricing.Prompt,
		CompletionPricePerToken: m.Pricing.Completion,
		RequestPrice:            m.Pricing.Request,
		PricePer1MInputTokens:   PricePer1M(m.Pricing.Prompt),
		PricePer1MOutputTokens:  PricePer1M(m.Pricing.Completion),

		SupportedParameters: m.SupportedParameters,
		IsModerated:         m.TopProvider.IsModerated,
		// Предварительный catalog-сигнал structured outputs (§6): фактическая
		// поддержка подтверждается только HUBTender model test.
		StructuredOutputs: hasString(m.SupportedParameters, "structured_outputs") ||
			hasString(m.SupportedParameters, "response_format"),
		IsFreeVariant: strings.HasSuffix(m.ID, ":free") ||
			(isZeroPrice(m.Pricing.Prompt) && isZeroPrice(m.Pricing.Completion)),
		Author: modelAuthor(m.ID),
	}
}

// FilterCatalog — правила §6: только модели текущего ключа с text-входом и
// text-выходом, не истёкшие, без router/alias-псевдомоделей. Free-варианты
// остаются (UI помечает предупреждением). Порядок стабильный: по ID.
func FilterCatalog(raw []rawModel, now time.Time) []Model {
	out := make([]Model, 0, len(raw))
	for _, m := range raw {
		if IsRouterModel(m) {
			continue
		}
		if !hasString(m.Architecture.InputModalities, "text") ||
			!hasString(m.Architecture.OutputModalities, "text") {
			continue
		}
		if isExpired(m.ExpirationDate, now) {
			continue
		}
		out = append(out, NormalizeModel(m))
	}
	sort.Slice(out, func(a, b int) bool { return out[a].ID < out[b].ID })
	return out
}

// ── Server-side in-memory catalog cache (§7 задания) ────────────────────────

// CatalogTTL — default TTL кэша каталога.
const CatalogTTL = 15 * time.Minute

// CatalogStatus — состояние источника каталога для admin UI.
const (
	CatalogFresh       = "fresh"
	CatalogStale       = "stale"
	CatalogUnavailable = "unavailable"
)

// CatalogSnapshot — то, что уходит в admin API.
type CatalogSnapshot struct {
	Models        []Model    `json:"models"`
	Status        string     `json:"status"` // fresh | stale | unavailable
	FetchedAt     *time.Time `json:"fetched_at"`
	ExpiresAt     *time.Time `json:"expires_at"`
	LastErrorCode string     `json:"last_error_code,omitempty"` // safe code (§20)
}

// modelsLister — DI-интерфейс клиента для тестов кэша.
type modelsLister interface {
	ListUserModels(ctx context.Context) ([]rawModel, error)
}

// CatalogCache — in-memory кэш каталога с TTL, manual refresh и
// singleflight-дедупликацией конкурентных обновлений (§7). В PostgreSQL
// каталог НЕ сохраняется; после рестарта кэш пуст — это допустимо.
type CatalogCache struct {
	client modelsLister
	ttl    time.Duration
	now    func() time.Time

	mu        sync.RWMutex
	models    []Model
	fetchedAt time.Time
	lastErr   string

	group singleflight.Group
}

// NewCatalogCache — кэш поверх клиента.
func NewCatalogCache(client modelsLister, ttl time.Duration) *CatalogCache {
	if ttl <= 0 {
		ttl = CatalogTTL
	}
	return &CatalogCache{client: client, ttl: ttl, now: time.Now}
}

// Get — каталог из кэша; при истечении TTL или forceRefresh — обновление
// (конкурентные вызовы дедуплицируются). При недоступности OpenRouter:
// есть кэш → status=stale + время последнего обновления; нет кэша →
// status=unavailable (+ безопасный код ошибки).
func (cc *CatalogCache) Get(ctx context.Context, forceRefresh bool) CatalogSnapshot {
	cc.mu.RLock()
	hasCache := !cc.fetchedAt.IsZero()
	fresh := hasCache && cc.now().Before(cc.fetchedAt.Add(cc.ttl))
	cc.mu.RUnlock()

	if !forceRefresh && fresh {
		return cc.snapshot(CatalogFresh, "")
	}

	_, err, _ := cc.group.Do("models", func() (any, error) {
		// Перепроверка под singleflight: другой запрос мог только что
		// обновить кэш (для forceRefresh обновляем всегда).
		cc.mu.RLock()
		stillFresh := !cc.fetchedAt.IsZero() && cc.now().Before(cc.fetchedAt.Add(cc.ttl))
		cc.mu.RUnlock()
		if stillFresh && !forceRefresh {
			return nil, nil
		}
		raw, ferr := cc.client.ListUserModels(ctx)
		if ferr != nil {
			cc.mu.Lock()
			cc.lastErr = StatusCode(ferr)
			cc.mu.Unlock()
			return nil, ferr
		}
		models := FilterCatalog(raw, cc.now())
		cc.mu.Lock()
		cc.models = models
		cc.fetchedAt = cc.now()
		cc.lastErr = ""
		cc.mu.Unlock()
		return nil, nil
	})

	cc.mu.RLock()
	hasCache = !cc.fetchedAt.IsZero()
	cc.mu.RUnlock()

	switch {
	case err == nil:
		return cc.snapshot(CatalogFresh, "")
	case hasCache:
		return cc.snapshot(CatalogStale, StatusCode(err))
	default:
		return cc.snapshot(CatalogUnavailable, StatusCode(err))
	}
}

// FindModel — модель по exact ID из текущего кэша (без сетевого вызова).
func (cc *CatalogCache) FindModel(id string) (Model, bool) {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	for _, m := range cc.models {
		if m.ID == id {
			return m, true
		}
	}
	return Model{}, false
}

// HasCache — был ли хоть один успешный fetch.
func (cc *CatalogCache) HasCache() bool {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	return !cc.fetchedAt.IsZero()
}

func (cc *CatalogCache) snapshot(status, errCode string) CatalogSnapshot {
	cc.mu.RLock()
	defer cc.mu.RUnlock()
	snap := CatalogSnapshot{Status: status, LastErrorCode: errCode}
	if !cc.fetchedAt.IsZero() {
		fetched := cc.fetchedAt
		expires := cc.fetchedAt.Add(cc.ttl)
		snap.FetchedAt = &fetched
		snap.ExpiresAt = &expires
		snap.Models = make([]Model, len(cc.models))
		copy(snap.Models, cc.models)
	}
	return snap
}
