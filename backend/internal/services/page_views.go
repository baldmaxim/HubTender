package services

import (
	"context"
	"fmt"

	"github.com/su10/hubtender/backend/internal/repository"
)

// PageViewsService — тонкая обёртка над репозиторием просмотров страниц.
type PageViewsService struct {
	repo *repository.PageViewsRepo
}

// NewPageViewsService creates a PageViewsService.
func NewPageViewsService(repo *repository.PageViewsRepo) *PageViewsService {
	return &PageViewsService{repo: repo}
}

// Record записывает просмотр страницы пользователем.
func (s *PageViewsService) Record(ctx context.Context, userID, page string) error {
	if err := s.repo.Insert(ctx, userID, page); err != nil {
		return fmt.Errorf("pageViewsService.Record: %w", err)
	}
	return nil
}

// Stats возвращает статистику просмотров за days суток.
func (s *PageViewsService) Stats(ctx context.Context, days int) (*repository.PageStats, error) {
	st, err := s.repo.Stats(ctx, days)
	if err != nil {
		return nil, fmt.Errorf("pageViewsService.Stats: %w", err)
	}
	return st, nil
}
