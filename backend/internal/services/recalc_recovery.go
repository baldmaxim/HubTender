package services

import (
	"context"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 2.4 (§2): FinancialCalculationRecoveryService — минимальный recovery
// без новой job-платформы.
//
//   - stale-тендер (потерянный enqueue) → повторный enqueue; наличие старого
//     cached total успехом НЕ считается — только CAS текущей ревизии;
//   - calculating старше timeout при СВОБОДНОМ advisory lock → атомарный
//     reclaim в stale + enqueue (repository.ReclaimStuckCalculating);
//   - calculated (rev==rev) — не трогается (кандидатом не является);
//   - failed — НЕ ретраится автоматически (§2.D): новый input change сам
//     переводит его в stale; retry storm исключён.
//
// Multi-instance: reclaim выполняется под per-tender advisory try-lock + CAS;
// дубль enqueue от двух инстансов безопасен (worker сериализуется тем же
// advisory lock и no-op'ится по ревизии).

// RecoveryConfig — конфигурация recovery (§2).
type RecoveryConfig struct {
	Enabled            bool
	ScanInterval       time.Duration // период сканов после startup
	CalculatingTimeout time.Duration // сколько calculating считается живым
	BatchSize          int
}

// DefaultRecoveryConfig — значения по аудиту длительности расчётов: даже
// крупный тендер считается секунды (10k строк ≈ единицы секунд), поэтому
// 10 минут — консервативный timeout; скан раз в минуту дёшев (один SELECT).
func DefaultRecoveryConfig() RecoveryConfig {
	return RecoveryConfig{
		Enabled:            true,
		ScanInterval:       60 * time.Second,
		CalculatingTimeout: 10 * time.Minute,
		BatchSize:          100,
	}
}

// recoveryStore — DB-поверхность recovery (инъекция для unit-тестов).
type recoveryStore interface {
	ListCandidates(ctx context.Context, timeout time.Duration, afterID string, limit int) ([]repository.RecoveryCandidate, error)
	Reclaim(ctx context.Context, tenderID string, timeout time.Duration) (bool, error)
	Health(ctx context.Context) (repository.RecalcHealthSnapshot, error)
}

type pgRecoveryStore struct{ pool *pgxpool.Pool }

func (s pgRecoveryStore) ListCandidates(ctx context.Context, timeout time.Duration, afterID string, limit int) ([]repository.RecoveryCandidate, error) {
	return repository.ListRecalcRecoveryCandidates(ctx, s.pool, timeout, afterID, limit)
}
func (s pgRecoveryStore) Reclaim(ctx context.Context, tenderID string, timeout time.Duration) (bool, error) {
	return repository.ReclaimStuckCalculating(ctx, s.pool, tenderID, timeout)
}
func (s pgRecoveryStore) Health(ctx context.Context) (repository.RecalcHealthSnapshot, error) {
	return repository.ReadRecalcHealthSnapshot(ctx, s.pool)
}

// RecoveryScanStats — результат одного скана (§3, безопасные поля).
type RecoveryScanStats struct {
	Scanned            int       `json:"scanned_count"`
	Stale              int       `json:"stale_count"`
	CalculatingExpired int       `json:"calculating_expired_count"`
	Enqueued           int       `json:"enqueued_count"`
	EnqueueFailed      int       `json:"enqueue_failed_count"`
	Reclaimed          int       `json:"reclaimed_count"`
	NoOp               int       `json:"no_op_count"`
	OldestStaleAge     float64   `json:"oldest_stale_age_seconds"`
	OldestCalcAge      float64   `json:"oldest_calculating_age_seconds"`
	At                 time.Time `json:"at"`
}

// FinancialCalculationRecoveryService — см. заголовок файла.
type FinancialCalculationRecoveryService struct {
	store  recoveryStore
	queue  Enqueuer
	cfg    RecoveryConfig
	logger zerolog.Logger
	// enqueueProbe: RecalcQueue.Enqueue не возвращает ошибку; для
	// детерминированных тестов сбоя enqueue (§4.2) инъецируемая обёртка может
	// вернуть false = «enqueue не принят», тендер остаётся stale до следующего
	// скана.
	enqueue func(tenderID string) bool

	mu           sync.Mutex
	lastScan     *RecoveryScanStats
	lastScanErr  string
	lastScanTime time.Time
}

// NewFinancialCalculationRecoveryService wires the pg store + очередь recalc.
func NewFinancialCalculationRecoveryService(
	pool *pgxpool.Pool, queue Enqueuer, cfg RecoveryConfig, logger zerolog.Logger,
) *FinancialCalculationRecoveryService {
	s := &FinancialCalculationRecoveryService{
		store: pgRecoveryStore{pool: pool}, queue: queue, cfg: cfg, logger: logger,
	}
	s.enqueue = func(tenderID string) bool {
		if s.queue == nil {
			return false
		}
		s.queue.Enqueue(tenderID)
		return true
	}
	return s
}

// newRecoveryServiceForTest — полная инъекция (store/enqueue) для unit-тестов.
func newRecoveryServiceForTest(store recoveryStore, enqueue func(string) bool, cfg RecoveryConfig, logger zerolog.Logger) *FinancialCalculationRecoveryService {
	return &FinancialCalculationRecoveryService{store: store, cfg: cfg, logger: logger, enqueue: enqueue}
}

// Run — §2: один скан сразу после startup, затем периодически. Блокируется до
// ctx.Done(); запускать в отдельной goroutine из main.
func (s *FinancialCalculationRecoveryService) Run(ctx context.Context) {
	if !s.cfg.Enabled {
		s.logger.Info().Msg("financial calculation recovery disabled by config")
		return
	}
	s.logger.Info().
		Dur("scan_interval", s.cfg.ScanInterval).
		Dur("calculating_timeout", s.cfg.CalculatingTimeout).
		Int("batch_size", s.cfg.BatchSize).
		Msg("financial calculation recovery started")
	// Startup-скан (§2.1) — потерянные enqueue/зависшие calculating с прошлого
	// запуска процесса.
	s.ScanOnce(ctx)
	ticker := time.NewTicker(s.cfg.ScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.ScanOnce(ctx)
		}
	}
}

// ScanOnce — один полный проход по кандидатам (batch pagination §4.12).
func (s *FinancialCalculationRecoveryService) ScanOnce(ctx context.Context) RecoveryScanStats {
	stats := RecoveryScanStats{At: time.Now().UTC()}
	afterID := ""
	for {
		batch, err := s.store.ListCandidates(ctx, s.cfg.CalculatingTimeout, afterID, s.cfg.BatchSize)
		if err != nil {
			s.recordScan(stats, err)
			s.logger.Error().Err(err).Str("operation", "recalc_recovery_scan").
				Msg("recovery scan failed")
			return stats
		}
		if len(batch) == 0 {
			break
		}
		for _, cand := range batch {
			stats.Scanned++
			switch cand.Status {
			case "stale":
				stats.Stale++
				// §2.A: потерянный enqueue — просто enqueue заново; дубль
				// безопасен (advisory lock + revision no-op у воркера).
				if s.enqueue(cand.TenderID) {
					stats.Enqueued++
				} else {
					// §2: enqueue неуспешен → тендер ОСТАЁТСЯ stale, следующий
					// скан повторит; статус не трогаем.
					stats.EnqueueFailed++
				}
			case "calculating":
				stats.CalculatingExpired++
				if cand.AgeSeconds > stats.OldestCalcAge {
					stats.OldestCalcAge = cand.AgeSeconds
				}
				// §2.B: reclaim только при свободном advisory lock + CAS.
				reclaimed, err := s.store.Reclaim(ctx, cand.TenderID, s.cfg.CalculatingTimeout)
				if err != nil {
					s.logger.Error().Err(err).Str("operation", "recalc_recovery_reclaim").
						Str("tender_id", cand.TenderID).Msg("reclaim failed")
					continue
				}
				if !reclaimed {
					stats.NoOp++ // lock удерживается либо статус уже сменился
					continue
				}
				stats.Reclaimed++
				if s.enqueue(cand.TenderID) {
					stats.Enqueued++
				} else {
					stats.EnqueueFailed++ // остался stale — подберёт следующий скан
				}
			default:
				stats.NoOp++
			}
		}
		afterID = batch[len(batch)-1].TenderID
		if len(batch) < s.cfg.BatchSize {
			break
		}
	}
	if snap, err := s.store.Health(ctx); err == nil {
		stats.OldestStaleAge = snap.OldestStaleAgeSeconds
		if snap.OldestCalcAgeSeconds > stats.OldestCalcAge {
			stats.OldestCalcAge = snap.OldestCalcAgeSeconds
		}
	}
	s.recordScan(stats, nil)
	s.logger.Info().
		Str("operation", "recalc_recovery_scan").
		Int("scanned_count", stats.Scanned).
		Int("stale_count", stats.Stale).
		Int("calculating_expired_count", stats.CalculatingExpired).
		Int("enqueued_count", stats.Enqueued).
		Int("enqueue_failed_count", stats.EnqueueFailed).
		Int("reclaimed_count", stats.Reclaimed).
		Int("no_op_count", stats.NoOp).
		Float64("oldest_stale_age_seconds", stats.OldestStaleAge).
		Float64("oldest_calculating_age_seconds", stats.OldestCalcAge).
		Msg("recovery scan finished")
	return stats
}

func (s *FinancialCalculationRecoveryService) recordScan(stats RecoveryScanStats, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastScan = &stats
	s.lastScanTime = stats.At
	if err != nil {
		s.lastScanErr = err.Error()
	} else {
		s.lastScanErr = ""
	}
}

// Diagnostics — §3: health/readiness выдача (без финансовых данных).
type RecoveryDiagnostics struct {
	Health       repository.RecalcHealthSnapshot `json:"recalc"`
	LastScan     *RecoveryScanStats              `json:"last_scan,omitempty"`
	LastScanTime time.Time                       `json:"last_scan_time"`
	LastScanErr  string                          `json:"last_scan_error,omitempty"`
}

// Diagnostics возвращает текущие счётчики + сведения о последнем скане.
func (s *FinancialCalculationRecoveryService) Diagnostics(ctx context.Context) (RecoveryDiagnostics, error) {
	snap, err := s.store.Health(ctx)
	if err != nil {
		return RecoveryDiagnostics{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return RecoveryDiagnostics{
		Health: snap, LastScan: s.lastScan,
		LastScanTime: s.lastScanTime, LastScanErr: s.lastScanErr,
	}, nil
}
