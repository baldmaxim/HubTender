package services

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// qualityRepoer is the interface QualityService depends on.
type qualityRepoer interface {
	RunAndPersist(ctx context.Context, tenderID, trigger string, triggeredBy *string) (*repository.QualityReport, error, error)
	SetVerdict(ctx context.Context, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
	SetVerdicts(ctx context.Context, tenderID string, in []repository.VerdictInput,
		changedBy *string) error
	RecordVerdictEvents(ctx context.Context, tenderID string, in []repository.VerdictInput,
		actor *string) error
	Export(ctx context.Context) ([]repository.ExportRow, error)
}

// QualityService прогоняет каталог правил по тендеру, сохраняет состояние находок
// и кэширует результат.
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

// ReportOptions — параметры запроса находок.
type ReportOptions struct {
	// Refresh обходит кэш — «Перепроверить» и автообновление по realtime.
	Refresh bool
	// Trigger — источник прогона (repository.RunTrigger*). Пусто = view.
	Trigger string
	// UserID — кто запросил; пишется в прогон.
	UserID *string
}

// Report возвращает находки по тендеру.
//
// Отметка «Проверка завершена» (Trigger = checkpoint) всегда прогоняет правила
// заново: иначе базовая точка новизны встала бы на устаревший кэшированный
// результат.
func (s *QualityService) Report(ctx context.Context, tenderID string, opts ReportOptions) (*repository.QualityReport, error) {
	trigger := opts.Trigger
	if trigger == "" {
		trigger = repository.RunTriggerView
	}
	key := qualityCacheKey(tenderID)

	if !opts.Refresh && trigger != repository.RunTriggerCheckpoint && s.cache != nil {
		if v, ok := s.cache.Get(key); ok {
			if rep, cast := v.(*repository.QualityReport); cast {
				return rep, nil
			}
		}
	}

	rep, persistErr, err := s.repo.RunAndPersist(ctx, tenderID, trigger, opts.UserID)
	if err != nil {
		return nil, fmt.Errorf("qualityService.Report: %w", err)
	}
	if persistErr != nil {
		// Находки отдаём без истории: страница работает и без неё, а причина видна
		// в логах (обычно — не применена миграция verification_findings).
		log.Warn().Err(persistErr).Str("tender_id", tenderID).Str("trigger", trigger).
			Msg("quality: прогон не сохранён, находки отданы без истории")
		if trigger == repository.RunTriggerCheckpoint {
			return nil, fmt.Errorf("qualityService.Report: отметка проверки не сохранена: %w", persistErr)
		}
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
	s.recordVerdictEvents(ctx, tenderID, []repository.VerdictInput{{
		RuleCode: ruleCode, EntityID: entityID, Fingerprint: fingerprint, Verdict: verdict, Note: note,
	}}, changedBy)
	return nil
}

// SetVerdicts сохраняет пачку решений инженера («принять всю группу») и один раз
// сбрасывает кэш.
func (s *QualityService) SetVerdicts(
	ctx context.Context,
	tenderID string,
	in []repository.VerdictInput,
	changedBy *string,
) error {
	if err := s.repo.SetVerdicts(ctx, tenderID, in, changedBy); err != nil {
		return err
	}
	s.Invalidate(tenderID)
	s.recordVerdictEvents(ctx, tenderID, in, changedBy)
	return nil
}

// recordVerdictEvents — история вердиктов, по возможности. Сам вердикт уже
// сохранён; сбой истории не должен превращать успешное действие в ошибку.
func (s *QualityService) recordVerdictEvents(
	ctx context.Context,
	tenderID string,
	in []repository.VerdictInput,
	actor *string,
) {
	if err := s.repo.RecordVerdictEvents(ctx, tenderID, in, actor); err != nil {
		log.Warn().Err(err).Str("tender_id", tenderID).Int("count", len(in)).
			Msg("quality: вердикт сохранён, но в историю находок не записан")
	}
}

// Export отдаёт вердикты по всей базе — вход для замера точности правил.
func (s *QualityService) Export(ctx context.Context) ([]repository.ExportRow, error) {
	return s.repo.Export(ctx)
}
