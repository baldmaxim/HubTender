package services

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// Recalculator performs the actual per-tender commercial recalc. Implemented by
// CommercialRecalcService.
type Recalculator interface {
	RecalcTender(ctx context.Context, tenderID string) error
}

// Enqueuer is the minimal surface mutation services depend on to request a
// background commercial-cost recalc for a tender. Implemented by RecalcQueue.
type Enqueuer interface {
	Enqueue(tenderID string)
}

// TenderCacheInvalidator сбрасывает производные кэши тендера. Реализуется
// QualityService.
//
// Кэш находок «Проверки данных» живёт 10 минут, а сбрасывался только при
// сохранении вердикта: ни одна правка BOQ его не трогала. На странице это не
// замечали, потому что фронт при realtime-событии перечитывает с refresh=1, но
// любой серверный или машинный потребитель (внешний агент по ключу) получал
// устаревшие находки до истечения TTL.
//
// Точка врезки выбрана здесь: Enqueue уже вызывается со всех финансовых путей
// записи, поэтому одна привязка закрывает их все.
type TenderCacheInvalidator interface {
	Invalidate(tenderID string)
}

// RecalcQueue coalesces recalc requests per tender behind a debounce timer and
// runs them on a bounded worker pool. Mutation services call Enqueue after they
// change a commercial-cost input (BOQ items, markup config, currency rates);
// the queue owns the recalc itself.
//
// The queue's own writes never call Enqueue, so there is no feedback loop; the
// recalc is additionally idempotent (diff-before-write), so a redundant Enqueue
// is a cheap no-op.
type RecalcQueue struct {
	rec      Recalculator
	logger   zerolog.Logger
	debounce time.Duration
	ctx      context.Context

	mu     sync.Mutex
	timers map[string]*time.Timer
	closed bool
	inval  TenderCacheInvalidator

	sem chan struct{}  // bounds concurrent recalcs
	wg  sync.WaitGroup // tracks in-flight recalcs for graceful Close
}

// NewRecalcQueue builds a queue. debounce coalesces bursts (e.g. a multi-item
// edit or a bulk import) into a single recalc; maxConcurrent caps parallel
// per-tender recalcs. ctx should be the server root context.
func NewRecalcQueue(ctx context.Context, rec Recalculator, debounce time.Duration, maxConcurrent int, logger zerolog.Logger) *RecalcQueue {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &RecalcQueue{
		rec:      rec,
		logger:   logger,
		debounce: debounce,
		ctx:      ctx,
		timers:   make(map[string]*time.Timer),
		sem:      make(chan struct{}, maxConcurrent),
	}
}

// SetInvalidator привязывает сброс производных кэшей тендера. Необязателен:
// без него очередь работает как раньше. Вызывать один раз при сборке, до старта
// приёма запросов.
func (q *RecalcQueue) SetInvalidator(inval TenderCacheInvalidator) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.inval = inval
}

func (q *RecalcQueue) invalidate(tenderID string) {
	q.mu.Lock()
	inval := q.inval
	q.mu.Unlock()
	if inval != nil {
		inval.Invalidate(tenderID)
	}
}

// Enqueue schedules a recalc for tenderID after the debounce window. Repeated
// calls within the window reset the timer (last-writer-wins coalescing).
func (q *RecalcQueue) Enqueue(tenderID string) {
	if tenderID == "" {
		return
	}
	// Данные уже изменились — производные кэши устарели, не дожидаясь пересчёта.
	q.invalidate(tenderID)

	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed {
		return
	}
	if t, ok := q.timers[tenderID]; ok {
		t.Reset(q.debounce)
		return
	}
	q.timers[tenderID] = time.AfterFunc(q.debounce, func() { q.fire(tenderID) })
}

func (q *RecalcQueue) fire(tenderID string) {
	q.mu.Lock()
	if q.closed {
		q.mu.Unlock()
		return
	}
	delete(q.timers, tenderID)
	q.wg.Add(1)
	q.mu.Unlock()

	go func() {
		defer q.wg.Done()
		select {
		case q.sem <- struct{}{}:
		case <-q.ctx.Done():
			return
		}
		defer func() { <-q.sem }()

		if q.ctx.Err() != nil {
			return
		}
		if err := q.rec.RecalcTender(q.ctx, tenderID); err != nil {
			q.logger.Error().Err(err).Str("tender_id", tenderID).Msg("commercial recalc failed")
		}
		// Пересчёт переписал производные суммы — сбрасываем кэш и после него, а не
		// только на входе: правила I и J сравнивают хранимые итоги с пересчётом.
		q.invalidate(tenderID)
	}()
}

// Close stops pending timers and waits for in-flight recalcs to finish. Call
// during graceful shutdown before the DB pool is closed.
func (q *RecalcQueue) Close() {
	q.mu.Lock()
	q.closed = true
	for id, t := range q.timers {
		t.Stop()
		delete(q.timers, id)
	}
	q.mu.Unlock()
	q.wg.Wait()
}
