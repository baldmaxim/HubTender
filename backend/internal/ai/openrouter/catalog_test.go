package openrouter

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeLister — DI-заглушка клиента для кэша.
type fakeLister struct {
	mu     sync.Mutex
	models []rawModel
	err    error
	calls  int32
	delay  time.Duration
}

func (f *fakeLister) ListUserModels(ctx context.Context) ([]rawModel, error) {
	atomic.AddInt32(&f.calls, 1)
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	out := make([]rawModel, len(f.models))
	copy(out, f.models)
	return out, nil
}

func (f *fakeLister) set(models []rawModel, err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.models, f.err = models, err
}

func mkRaw(id, prompt, completion string, expiration *string, inMods, outMods []string) rawModel {
	var m rawModel
	src := modelJSON(id, prompt, completion, expiration)
	if err := json.Unmarshal([]byte(src), &m); err != nil {
		panic(err)
	}
	if inMods != nil {
		m.Architecture.InputModalities = inMods
	}
	if outMods != nil {
		m.Architecture.OutputModalities = outMods
	}
	return m
}

// 19-20. Первая загрузка + cache hit (второй Get не ходит в сеть).
func TestCatalogFirstLoadAndCacheHit(t *testing.T) {
	f := &fakeLister{models: []rawModel{mkRaw("prov/a", "0.000001", "0.000002", nil, nil, nil)}}
	cc := NewCatalogCache(f, time.Minute)
	snap := cc.Get(context.Background(), false)
	if snap.Status != CatalogFresh || len(snap.Models) != 1 || snap.FetchedAt == nil || snap.ExpiresAt == nil {
		t.Fatalf("first load: %+v", snap)
	}
	_ = cc.Get(context.Background(), false)
	if atomic.LoadInt32(&f.calls) != 1 {
		t.Fatalf("cache hit must not refetch, calls=%d", f.calls)
	}
}

// 21. Manual refresh форсирует запрос.
func TestCatalogManualRefresh(t *testing.T) {
	f := &fakeLister{models: []rawModel{mkRaw("prov/a", "0", "0", nil, nil, nil)}}
	cc := NewCatalogCache(f, time.Minute)
	_ = cc.Get(context.Background(), false)
	f.set([]rawModel{mkRaw("prov/a", "0", "0", nil, nil, nil), mkRaw("prov/b", "0", "0", nil, nil, nil)}, nil)
	snap := cc.Get(context.Background(), true)
	if len(snap.Models) != 2 || atomic.LoadInt32(&f.calls) != 2 {
		t.Fatalf("manual refresh failed: models=%d calls=%d", len(snap.Models), f.calls)
	}
}

// 22. Конкурентный refresh дедуплицируется singleflight'ом.
func TestCatalogConcurrentRefreshSingleflight(t *testing.T) {
	f := &fakeLister{models: []rawModel{mkRaw("prov/a", "0", "0", nil, nil, nil)}, delay: 100 * time.Millisecond}
	cc := NewCatalogCache(f, time.Minute)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = cc.Get(context.Background(), true)
		}()
	}
	wg.Wait()
	if calls := atomic.LoadInt32(&f.calls); calls != 1 {
		t.Fatalf("singleflight failed: %d upstream calls for 8 concurrent refreshes", calls)
	}
}

// 23. Stale cache fallback: после успешной загрузки провайдер падает —
// отдаём кэш со статусом stale и safe-кодом ошибки.
func TestCatalogStaleFallback(t *testing.T) {
	f := &fakeLister{models: []rawModel{mkRaw("prov/a", "0", "0", nil, nil, nil)}}
	cc := NewCatalogCache(f, time.Minute)
	first := cc.Get(context.Background(), false)
	if first.Status != CatalogFresh {
		t.Fatalf("first: %+v", first)
	}
	f.set(nil, ErrUnavailable)
	snap := cc.Get(context.Background(), true)
	if snap.Status != CatalogStale || len(snap.Models) != 1 || snap.FetchedAt == nil {
		t.Fatalf("stale fallback: %+v", snap)
	}
	if snap.LastErrorCode != "unavailable" {
		t.Fatalf("last_error_code = %q", snap.LastErrorCode)
	}
}

// 24. Нет кэша + провайдер недоступен → unavailable (без моделей).
func TestCatalogUnavailableWithoutCache(t *testing.T) {
	f := &fakeLister{err: ErrUnauthorized}
	cc := NewCatalogCache(f, time.Minute)
	snap := cc.Get(context.Background(), false)
	if snap.Status != CatalogUnavailable || snap.Models != nil || snap.FetchedAt != nil {
		t.Fatalf("unavailable: %+v", snap)
	}
	if snap.LastErrorCode != "unauthorized" {
		t.Fatalf("last_error_code = %q", snap.LastErrorCode)
	}
}

// 25. Router-модели (author openrouter, отрицательная цена) фильтруются.
func TestCatalogRouterFiltered(t *testing.T) {
	auto := mkRaw("openrouter/auto", "-1", "-1", nil, nil, nil)
	negative := mkRaw("prov/dynamic", "-0.5", "0.000001", nil, nil, nil)
	normal := mkRaw("prov/a", "0.000001", "0.000002", nil, nil, nil)
	models := FilterCatalog([]rawModel{auto, negative, normal}, time.Now())
	if len(models) != 1 || models[0].ID != "prov/a" {
		t.Fatalf("router filtering failed: %+v", models)
	}
	if !IsRouterModel(auto) || !IsRouterModel(negative) || IsRouterModel(normal) {
		t.Fatal("IsRouterModel misclassified")
	}
}

// 26. Истёкшие модели фильтруются; будущая expiration остаётся с датой.
func TestCatalogExpiredFiltered(t *testing.T) {
	past := time.Now().Add(-24 * time.Hour).Format("2006-01-02")
	future := time.Now().Add(90 * 24 * time.Hour).Format("2006-01-02")
	expired := mkRaw("prov/old", "0", "0", &past, nil, nil)
	expiring := mkRaw("prov/soon", "0", "0", &future, nil, nil)
	models := FilterCatalog([]rawModel{expired, expiring}, time.Now())
	if len(models) != 1 || models[0].ID != "prov/soon" {
		t.Fatalf("expiration filtering failed: %+v", models)
	}
	if models[0].ExpirationDate == nil || *models[0].ExpirationDate != future {
		t.Fatal("future expiration date must be preserved")
	}
}

// 26b. Не text→text модели фильтруются (§6).
func TestCatalogNonTextFiltered(t *testing.T) {
	imageIn := mkRaw("prov/vision-only", "0", "0", nil, []string{"image"}, []string{"text"})
	imageOut := mkRaw("prov/image-gen", "0", "0", nil, []string{"text"}, []string{"image"})
	multi := mkRaw("prov/multi", "0", "0", nil, []string{"text", "image"}, []string{"text"})
	models := FilterCatalog([]rawModel{imageIn, imageOut, multi}, time.Now())
	if len(models) != 1 || models[0].ID != "prov/multi" {
		t.Fatalf("modality filtering failed: %+v", models)
	}
}

// 27. Стабильный порядок: по ID.
func TestCatalogStableOrdering(t *testing.T) {
	models := FilterCatalog([]rawModel{
		mkRaw("prov/c", "0", "0", nil, nil, nil),
		mkRaw("prov/a", "0", "0", nil, nil, nil),
		mkRaw("prov/b", "0", "0", nil, nil, nil),
	}, time.Now())
	if models[0].ID != "prov/a" || models[1].ID != "prov/b" || models[2].ID != "prov/c" {
		t.Fatalf("ordering: %+v", models)
	}
}

// 30 (часть). FindModel по exact ID без сети.
func TestCatalogFindModel(t *testing.T) {
	f := &fakeLister{models: []rawModel{mkRaw("prov/a", "0", "0", nil, nil, nil)}}
	cc := NewCatalogCache(f, time.Minute)
	_ = cc.Get(context.Background(), false)
	if _, ok := cc.FindModel("prov/a"); !ok {
		t.Fatal("FindModel must find cached model")
	}
	if _, ok := cc.FindModel("prov/none"); ok {
		t.Fatal("FindModel must not invent models")
	}
	if !cc.HasCache() {
		t.Fatal("HasCache must be true after load")
	}
}

// Free-вариант помечается, structured-outputs сигнал считывается.
func TestCatalogNormalizeFlags(t *testing.T) {
	free := mkRaw("prov/a:free", "0", "0", nil, nil, nil)
	norm := NormalizeModel(free)
	if !norm.IsFreeVariant {
		t.Fatal("free variant must be flagged")
	}
	if !norm.StructuredOutputs {
		t.Fatal("structured_outputs from supported_parameters must be indicated")
	}
	if norm.Author != "prov" {
		t.Fatalf("author = %q", norm.Author)
	}
	if norm.PricePer1MInputTokens != "0" {
		t.Fatalf("price/1M = %q", norm.PricePer1MInputTokens)
	}
	if norm.ContextLength == nil || *norm.ContextLength != 128000 ||
		norm.MaxCompletionTokens == nil || *norm.MaxCompletionTokens != 16000 {
		t.Fatalf("context/max output not normalized: %+v", norm)
	}
}

// Ошибка контекста прокидывается и не кэшируется как успех.
func TestCatalogContextCancelled(t *testing.T) {
	f := &fakeLister{models: []rawModel{mkRaw("prov/a", "0", "0", nil, nil, nil)}, delay: time.Second}
	cc := NewCatalogCache(f, time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	snap := cc.Get(ctx, false)
	if snap.Status != CatalogUnavailable {
		t.Fatalf("cancelled fetch must be unavailable: %+v", snap)
	}
	if !errors.Is(ctx.Err(), context.DeadlineExceeded) {
		t.Fatal("sanity: ctx must be expired")
	}
}
