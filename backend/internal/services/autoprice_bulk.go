package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// autopriceBulkRepoer — граница репозитория пакетной записи авторасценки.
type autopriceBulkRepoer interface {
	BulkWrite(ctx context.Context, sessionID, actorID string, positions []repository.AutopriceBulkPosition) (*repository.AutopriceBulkResult, error)
}

// AutopriceBulkService — пакетная запись строк прогона авторасценки: тонкая
// обёртка над репозиторием, которая после успеха один раз сбрасывает кэши
// тендера и ставит пересчёт коммерции (как BoqService для одиночной записи).
type AutopriceBulkService struct {
	repo   autopriceBulkRepoer
	cache  *cache.InMem
	recalc Enqueuer
}

// NewAutopriceBulkService creates an AutopriceBulkService.
func NewAutopriceBulkService(repo autopriceBulkRepoer, c *cache.InMem) *AutopriceBulkService {
	return &AutopriceBulkService{repo: repo, cache: c}
}

// WithRecalcQueue подключает очередь пересчёта коммерции.
func (s *AutopriceBulkService) WithRecalcQueue(q Enqueuer) *AutopriceBulkService {
	s.recalc = q
	return s
}

// BulkWrite записывает пакет одной транзакцией. При ошибке побочных эффектов нет.
func (s *AutopriceBulkService) BulkWrite(ctx context.Context, sessionID, actorID string, positions []repository.AutopriceBulkPosition) (*repository.AutopriceBulkResult, error) {
	res, err := s.repo.BulkWrite(ctx, sessionID, actorID, positions)
	if err != nil {
		return nil, fmt.Errorf("autopriceBulkService.BulkWrite: %w", err)
	}
	if s.cache != nil {
		s.cache.Delete("tender:overview:" + res.TenderID)
		s.cache.DeleteByPrefix(tenderListKeyPrefix)
	}
	if s.recalc != nil && res.TenderID != "" {
		s.recalc.Enqueue(res.TenderID)
	}
	return res, nil
}
