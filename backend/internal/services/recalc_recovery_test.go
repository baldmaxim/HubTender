package services

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ─── стабы (§4: детерминизм без sleep) ───────────────────────────────────────

type stubRecoveryStore struct {
	mu         sync.Mutex
	candidates []repository.RecoveryCandidate
	// reclaimResult по tenderID; отсутствие = false (lock held / уже сменился)
	reclaimResult map[string]bool
	reclaimCalls  []string
	listErr       error
	pages         [][]repository.RecoveryCandidate // при заданных pages — постранично
	pageIdx       int
}

func (s *stubRecoveryStore) ListCandidates(_ context.Context, _ time.Duration, _ string, _ int) ([]repository.RecoveryCandidate, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listErr != nil {
		return nil, s.listErr
	}
	if s.pages != nil {
		if s.pageIdx >= len(s.pages) {
			return nil, nil
		}
		p := s.pages[s.pageIdx]
		s.pageIdx++
		return p, nil
	}
	out := s.candidates
	s.candidates = nil // один проход: второй лист пуст
	return out, nil
}

func (s *stubRecoveryStore) Reclaim(_ context.Context, tenderID string, _ time.Duration) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reclaimCalls = append(s.reclaimCalls, tenderID)
	return s.reclaimResult[tenderID], nil
}

func (s *stubRecoveryStore) Health(context.Context) (repository.RecalcHealthSnapshot, error) {
	return repository.RecalcHealthSnapshot{}, nil
}

type enqueueRecorder struct {
	mu    sync.Mutex
	ids   []string
	block map[string]bool // true = «enqueue не принят» (§4.2)
}

func (e *enqueueRecorder) fn(id string) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.block[id] {
		return false
	}
	e.ids = append(e.ids, id)
	return true
}

func newTestRecovery(store recoveryStore, enq func(string) bool) *FinancialCalculationRecoveryService {
	cfg := DefaultRecoveryConfig()
	cfg.BatchSize = 2
	return newRecoveryServiceForTest(store, enq, cfg, zerolog.Nop())
}

// §4.1/§18.1: stale-кандидат (потерянный enqueue) → enqueue.
func TestRecoveryStaleEnqueued(t *testing.T) {
	store := &stubRecoveryStore{candidates: []repository.RecoveryCandidate{
		{TenderID: "t-stale", Status: "stale"},
	}}
	enq := &enqueueRecorder{}
	stats := newTestRecovery(store, enq.fn).ScanOnce(context.Background())
	if stats.Stale != 1 || stats.Enqueued != 1 || stats.EnqueueFailed != 0 {
		t.Fatalf("stats=%+v", stats)
	}
	if len(enq.ids) != 1 || enq.ids[0] != "t-stale" {
		t.Fatalf("enqueue ids=%v", enq.ids)
	}
}

// §4.2/§18.5: enqueue неуспешен → тендер остаётся stale, следующий скан
// повторяет попытку; статус не переводится в calculated/failed.
func TestRecoveryEnqueueFailureRetriedNextScan(t *testing.T) {
	enq := &enqueueRecorder{block: map[string]bool{"t-1": true}}
	store := &stubRecoveryStore{candidates: []repository.RecoveryCandidate{{TenderID: "t-1", Status: "stale"}}}
	svc := newTestRecovery(store, enq.fn)
	stats := svc.ScanOnce(context.Background())
	if stats.EnqueueFailed != 1 || stats.Enqueued != 0 {
		t.Fatalf("first scan stats=%+v", stats)
	}
	// Следующий скан: очередь ожила — тендер всё ещё stale в store.
	enq.mu.Lock()
	enq.block = nil
	enq.mu.Unlock()
	store.mu.Lock()
	store.candidates = []repository.RecoveryCandidate{{TenderID: "t-1", Status: "stale"}}
	store.mu.Unlock()
	stats2 := svc.ScanOnce(context.Background())
	if stats2.Enqueued != 1 {
		t.Fatalf("retry scan stats=%+v", stats2)
	}
}

// §4.3/§18.2: calculating старше timeout, lock свободен → reclaim + enqueue.
func TestRecoveryStuckCalculatingReclaimed(t *testing.T) {
	store := &stubRecoveryStore{
		candidates:    []repository.RecoveryCandidate{{TenderID: "t-stuck", Status: "calculating", AgeSeconds: 3600}},
		reclaimResult: map[string]bool{"t-stuck": true},
	}
	enq := &enqueueRecorder{}
	stats := newTestRecovery(store, enq.fn).ScanOnce(context.Background())
	if stats.Reclaimed != 1 || stats.Enqueued != 1 {
		t.Fatalf("stats=%+v", stats)
	}
	if len(store.reclaimCalls) != 1 {
		t.Fatalf("reclaim calls=%v", store.reclaimCalls)
	}
}

// §4.5/§18.3: lock ещё удерживается (или статус уже сменился) → no-op, без
// enqueue и без перевода статуса.
func TestRecoveryLockHeldNotTouched(t *testing.T) {
	store := &stubRecoveryStore{
		candidates:    []repository.RecoveryCandidate{{TenderID: "t-live", Status: "calculating", AgeSeconds: 3600}},
		reclaimResult: map[string]bool{}, // Reclaim → false
	}
	enq := &enqueueRecorder{}
	stats := newTestRecovery(store, enq.fn).ScanOnce(context.Background())
	if stats.Reclaimed != 0 || stats.Enqueued != 0 || stats.NoOp != 1 {
		t.Fatalf("stats=%+v", stats)
	}
}

// §4.6/§18.4: два instances — reclaim CAS отдаёт кандидата ровно одному.
func TestRecoveryMultiInstanceSingleWinner(t *testing.T) {
	var mu sync.Mutex
	claimed := false
	shared := func() *stubRecoveryStore {
		return &stubRecoveryStore{
			candidates: []repository.RecoveryCandidate{{TenderID: "t-x", Status: "calculating", AgeSeconds: 999}},
		}
	}
	// Общий CAS: первый Reclaim → true, остальные → false (модель уникального
	// UPDATE ... WHERE status='calculating').
	casReclaim := func(store *stubRecoveryStore) {
		store.reclaimResult = nil
		// заменяем метод через обёртку ниже
	}
	_ = casReclaim
	storeA, storeB := shared(), shared()
	cas := func(id string) bool {
		mu.Lock()
		defer mu.Unlock()
		if claimed {
			return false
		}
		claimed = true
		return true
	}
	wrapA := &casStore{stubRecoveryStore: storeA, cas: cas}
	wrapB := &casStore{stubRecoveryStore: storeB, cas: cas}
	enqA, enqB := &enqueueRecorder{}, &enqueueRecorder{}
	var wg sync.WaitGroup
	var statsA, statsB RecoveryScanStats
	wg.Add(2)
	go func() { defer wg.Done(); statsA = newTestRecovery(wrapA, enqA.fn).ScanOnce(context.Background()) }()
	go func() { defer wg.Done(); statsB = newTestRecovery(wrapB, enqB.fn).ScanOnce(context.Background()) }()
	wg.Wait()
	if statsA.Reclaimed+statsB.Reclaimed != 1 {
		t.Fatalf("ровно один instance должен reclaim'ить: A=%+v B=%+v", statsA, statsB)
	}
	if len(enqA.ids)+len(enqB.ids) != 1 {
		t.Fatalf("ровно один enqueue: A=%v B=%v", enqA.ids, enqB.ids)
	}
}

type casStore struct {
	*stubRecoveryStore
	cas func(string) bool
}

func (s *casStore) Reclaim(_ context.Context, tenderID string, _ time.Duration) (bool, error) {
	return s.cas(tenderID), nil
}

// §4.9-10/§18.6-7: calculated/failed не являются кандидатами — store-запрос их
// не возвращает; незнакомый статус в выдаче → безопасный no-op без enqueue.
func TestRecoveryIgnoresNonCandidates(t *testing.T) {
	store := &stubRecoveryStore{candidates: []repository.RecoveryCandidate{
		{TenderID: "t-done", Status: "calculated"},
		{TenderID: "t-failed", Status: "failed"},
	}}
	enq := &enqueueRecorder{}
	stats := newTestRecovery(store, enq.fn).ScanOnce(context.Background())
	if stats.Enqueued != 0 || stats.Reclaimed != 0 || stats.NoOp != 2 {
		t.Fatalf("stats=%+v", stats)
	}
	if len(enq.ids) != 0 {
		t.Fatal("failed/calculated не должны enqueue'иться (retry storm)")
	}
}

// §4.12: batch pagination — все страницы обрабатываются за один скан.
func TestRecoveryBatchPagination(t *testing.T) {
	store := &stubRecoveryStore{pages: [][]repository.RecoveryCandidate{
		{{TenderID: "t-01", Status: "stale"}, {TenderID: "t-02", Status: "stale"}},
		{{TenderID: "t-03", Status: "stale"}, {TenderID: "t-04", Status: "stale"}},
		{{TenderID: "t-05", Status: "stale"}},
	}}
	enq := &enqueueRecorder{}
	stats := newTestRecovery(store, enq.fn).ScanOnce(context.Background())
	if stats.Scanned != 5 || stats.Enqueued != 5 {
		t.Fatalf("stats=%+v", stats)
	}
}

// Ошибка store не роняет процесс и фиксируется в diagnostics.
func TestRecoveryScanErrorRecorded(t *testing.T) {
	store := &stubRecoveryStore{listErr: errors.New("db down")}
	svc := newTestRecovery(store, (&enqueueRecorder{}).fn)
	svc.ScanOnce(context.Background())
	svc.mu.Lock()
	defer svc.mu.Unlock()
	if svc.lastScanErr == "" {
		t.Fatal("last scan error must be recorded")
	}
}

// Disabled-конфигурация: Run завершается сразу, скан не выполняется.
func TestRecoveryDisabled(t *testing.T) {
	store := &stubRecoveryStore{candidates: []repository.RecoveryCandidate{{TenderID: "t", Status: "stale"}}}
	enq := &enqueueRecorder{}
	cfg := DefaultRecoveryConfig()
	cfg.Enabled = false
	svc := newRecoveryServiceForTest(store, enq.fn, cfg, zerolog.Nop())
	done := make(chan struct{})
	go func() { svc.Run(context.Background()); close(done) }()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("disabled Run must return immediately")
	}
	if len(enq.ids) != 0 {
		t.Fatal("disabled recovery must not enqueue")
	}
}
