package services

import (
	"context"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/repository"
)

// VerificationRunner — фоновый прогон каталога правил по тендеру. Подключается
// к RecalcQueue как Recalculator: очередь уже умеет схлопывать всплески правок
// и ограничивать параллельность, заводить вторую такую же не нужно.
//
// Прогон идёт через QualityService.Report, поэтому результат сразу кладётся в
// кэш и открытая страница получает свежие находки без повторного прогона.
type VerificationRunner struct {
	svc *QualityService
}

func NewVerificationRunner(svc *QualityService) *VerificationRunner {
	return &VerificationRunner{svc: svc}
}

// RecalcTender реализует Recalculator.
func (r *VerificationRunner) RecalcTender(ctx context.Context, tenderID string) error {
	_, err := r.svc.Report(ctx, tenderID, ReportOptions{Refresh: true, Trigger: repository.RunTriggerAuto})
	return err
}

// VerificationRetentionConfig — очистка старых прогонов проверки.
type VerificationRetentionConfig struct {
	Enabled  bool
	Interval time.Duration
	KeepFor  time.Duration
}

func DefaultVerificationRetentionConfig() VerificationRetentionConfig {
	return VerificationRetentionConfig{Enabled: true, Interval: 6 * time.Hour, KeepFor: 30 * 24 * time.Hour}
}

type verificationPruner interface {
	PruneVerificationRuns(ctx context.Context, olderThan time.Duration) (int64, error)
}

// VerificationRetentionService раз в Interval удаляет прогоны старше KeepFor.
// Фоновые прогоны пишут строку на каждый пересчёт; без очистки таблица растёт
// бесконечно, хотя для истории нужны только находки и последняя отметка.
type VerificationRetentionService struct {
	repo   verificationPruner
	cfg    VerificationRetentionConfig
	logger zerolog.Logger
}

func NewVerificationRetentionService(repo verificationPruner, cfg VerificationRetentionConfig, logger zerolog.Logger) *VerificationRetentionService {
	return &VerificationRetentionService{repo: repo, cfg: cfg, logger: logger}
}

// Run блокирует до отмены ctx.
func (s *VerificationRetentionService) Run(ctx context.Context) {
	if !s.cfg.Enabled || s.cfg.Interval <= 0 || s.cfg.KeepFor <= 0 {
		s.logger.Info().Msg("verification runs retention disabled")
		return
	}
	s.PruneOnce(ctx)
	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.PruneOnce(ctx)
		}
	}
}

// PruneOnce — один проход очистки; ошибка только логируется.
func (s *VerificationRetentionService) PruneOnce(ctx context.Context) {
	n, err := s.repo.PruneVerificationRuns(ctx, s.cfg.KeepFor)
	if err != nil {
		if ctx.Err() == nil {
			s.logger.Warn().Err(err).Msg("verification runs retention failed")
		}
		return
	}
	if n > 0 {
		s.logger.Info().Int64("deleted", n).Msg("verification runs pruned")
	}
}
