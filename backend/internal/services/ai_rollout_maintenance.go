package services

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 2.6 (§8/§21): периодический maintenance по паттерну recovery-сервиса
// этапа 2.4 — startup-скан + ticker. Multi-instance-safe: обе операции —
// идемпотентные UPDATE/DELETE по критерию.
//
//   * reservation recovery: просроченные reserved → released (crash-защита);
//   * retention cleanup: ledger/feedback старше retention удаляются батчами
//     (active reservations и evaluation summaries не трогаются; aliases,
//     memory, BOQ и import sessions не затрагиваются вовсе).

// AIMaintenanceConfig — конфигурация maintenance.
type AIMaintenanceConfig struct {
	Enabled      bool
	ScanInterval time.Duration
	// UsageRetention/FeedbackRetention: default 90 дней (§21). Feedback
	// удаляется каскадом вместе с ledger-строкой (FK ON DELETE CASCADE).
	UsageRetention time.Duration
	CleanupBatch   int
}

// DefaultAIMaintenanceConfig — задокументированные default'ы (§21).
func DefaultAIMaintenanceConfig() AIMaintenanceConfig {
	return AIMaintenanceConfig{
		Enabled:        true,
		ScanInterval:   60 * time.Second,
		UsageRetention: 90 * 24 * time.Hour,
		CleanupBatch:   500,
	}
}

// aiMaintenanceStore — минимальный контракт maintenance.
type aiMaintenanceStore interface {
	RecoverExpiredReservations(ctx context.Context, featureCode string) (int64, error)
	CleanupExpiredUsage(ctx context.Context, featureCode string, retention time.Duration, batchSize int) (int64, error)
}

// AIRolloutMaintenanceService — фоновый воркер.
type AIRolloutMaintenanceService struct {
	store  aiMaintenanceStore
	cfg    AIMaintenanceConfig
	logger zerolog.Logger

	mu           sync.Mutex
	lastScanAt   time.Time
	lastRecover  int64
	lastCleanup  int64
	totalRecover int64
	totalCleanup int64
}

// NewAIRolloutMaintenanceService creates the maintenance worker.
func NewAIRolloutMaintenanceService(store aiMaintenanceStore, cfg AIMaintenanceConfig, logger zerolog.Logger) *AIRolloutMaintenanceService {
	if cfg.ScanInterval <= 0 {
		cfg.ScanInterval = 60 * time.Second
	}
	if cfg.UsageRetention <= 0 {
		cfg.UsageRetention = 90 * 24 * time.Hour
	}
	if cfg.CleanupBatch <= 0 {
		cfg.CleanupBatch = 500
	}
	return &AIRolloutMaintenanceService{store: store, cfg: cfg, logger: logger}
}

// Start — startup-скан + периодический ticker до отмены ctx.
func (s *AIRolloutMaintenanceService) Start(ctx context.Context) {
	if !s.cfg.Enabled {
		s.logger.Info().Str("operation", "ai_maintenance").Msg("ai rollout maintenance disabled")
		return
	}
	s.logger.Info().
		Str("operation", "ai_maintenance").
		Dur("scan_interval", s.cfg.ScanInterval).
		Dur("usage_retention", s.cfg.UsageRetention).
		Msg("ai rollout maintenance started")
	go func() {
		s.scan(ctx)
		ticker := time.NewTicker(s.cfg.ScanInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.scan(ctx)
			}
		}
	}()
}

// ScanOnce — один проход (для тестов и health-диагностики).
func (s *AIRolloutMaintenanceService) ScanOnce(ctx context.Context) {
	s.scan(ctx)
}

func (s *AIRolloutMaintenanceService) scan(ctx context.Context) {
	scanCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	recovered, err := s.store.RecoverExpiredReservations(scanCtx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		s.logger.Warn().Err(err).Str("operation", "ai_maintenance").Msg("reservation recovery failed")
	}
	cleaned, err := s.store.CleanupExpiredUsage(scanCtx, repository.AIFeatureNomenclatureRerank, s.cfg.UsageRetention, s.cfg.CleanupBatch)
	if err != nil {
		s.logger.Warn().Err(err).Str("operation", "ai_maintenance").Msg("usage cleanup failed")
	}

	s.mu.Lock()
	s.lastScanAt = time.Now()
	s.lastRecover = recovered
	s.lastCleanup = cleaned
	s.totalRecover += recovered
	s.totalCleanup += cleaned
	s.mu.Unlock()

	if recovered > 0 || cleaned > 0 {
		s.logger.Info().
			Str("operation", "ai_maintenance").
			Int64("reservations_recovered", recovered).
			Int64("usage_rows_cleaned", cleaned).
			Msg("ai rollout maintenance scan")
	}
}

// Diagnostics — безопасные счётчики для health (§22).
func (s *AIRolloutMaintenanceService) Diagnostics() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	last := ""
	if !s.lastScanAt.IsZero() {
		last = s.lastScanAt.UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"enabled":               s.cfg.Enabled,
		"scan_interval_seconds": int(s.cfg.ScanInterval.Seconds()),
		"usage_retention_days":  int(s.cfg.UsageRetention.Hours() / 24),
		"last_scan_at":          last,
		"last_recovered":        s.lastRecover,
		"last_cleaned":          s.lastCleanup,
		"total_recovered":       s.totalRecover,
		"total_cleaned":         s.totalCleanup,
	}
}
