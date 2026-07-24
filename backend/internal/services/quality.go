package services

import (
	"context"
	"fmt"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// qualityRepoer is the interface QualityService depends on.
type qualityRepoer interface {
	Run(ctx context.Context, tenderID string) (*repository.QualityReport, error)
	SetVerdict(ctx context.Context, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
	Export(ctx context.Context) ([]repository.ExportRow, error)
}

// QualityService прогоняет каталог правил по тендеру и кэширует результат.
//
// Прогон читает весь набор строк тендера, поэтому на крупных тендерах он не бесплатен.
// Кэш снимает повторную нагрузку при обычной навигации; кнопка «Перепроверить» и любая
// правка данных тендера его сбрасывают.
type QualityService struct {
	repo  qualityRepoer
	cache *cache.InMem
	ttl   time.Duration
}

// NewQualityService creates a QualityService.
func NewQualityService(repo *repository.QualityRepo, c *cache.InMem) *QualityService {
	return &QualityService{repo: repo, cache: c, ttl: 10 * time.Minute}
}

func qualityCacheKey(tenderID string) string { return "quality:" + tenderID }

// Report возвращает находки по тендеру. refresh=true обходит кэш.
func (s *QualityService) Report(ctx context.Context, tenderID string, refresh bool) (*repository.QualityReport, error) {
	key := qualityCacheKey(tenderID)

	if !refresh && s.cache != nil {
		if v, ok := s.cache.Get(key); ok {
			if rep, cast := v.(*repository.QualityReport); cast {
				return rep, nil
			}
		}
	}

	rep, err := s.repo.Run(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("qualityService.Report: %w", err)
	}
	if s.cache != nil {
		s.cache.Set(key, rep, s.ttl)
	}
	return rep, nil
}

// Invalidate сбрасывает кэш находок тендера. Вызывается при правке данных тендера.
func (s *QualityService) Invalidate(tenderID string) {
	if s.cache != nil {
		s.cache.Delete(qualityCacheKey(tenderID))
	}
}

// SetVerdict сохраняет решение инженера и сбрасывает кэш, чтобы находка сразу
// перешла в разряд подтверждённых.
func (s *QualityService) SetVerdict(
	ctx context.Context,
	tenderID, ruleCode, entityID, fingerprint, verdict string,
	note *string,
	changedBy *string,
) error {
	if err := s.repo.SetVerdict(ctx, tenderID, ruleCode, entityID, fingerprint, verdict, note, changedBy); err != nil {
		return err
	}
	s.Invalidate(tenderID)
	return nil
}

// Export отдаёт вердикты по всей базе — вход для замера точности правил.
func (s *QualityService) Export(ctx context.Context) ([]repository.ExportRow, error) {
	return s.repo.Export(ctx)
}
