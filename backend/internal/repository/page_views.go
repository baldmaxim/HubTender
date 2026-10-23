package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PageViewsRepo — учёт просмотров страниц портала (public.page_views).
type PageViewsRepo struct {
	pool *pgxpool.Pool
}

// NewPageViewsRepo creates a PageViewsRepo.
func NewPageViewsRepo(pool *pgxpool.Pool) *PageViewsRepo {
	return &PageViewsRepo{pool: pool}
}

// PageStatsRow — итог по странице за период.
type PageStatsRow struct {
	Page         string `json:"page"`
	Views        int    `json:"views"`
	Users        int    `json:"users"`
	LastViewedAt string `json:"last_viewed_at"`
}

// PageStatsCell — просмотры страницы за один день (по Москве).
type PageStatsCell struct {
	Page  string `json:"page"`
	Day   string `json:"day"`
	Views int    `json:"views"`
	Users int    `json:"users"`
}

// PageStats — ответ «Использование портала».
type PageStats struct {
	Days  int             `json:"days"`
	From  string          `json:"from"`
	To    string          `json:"to"`
	Pages []PageStatsRow  `json:"pages"`
	Cells []PageStatsCell `json:"cells"`
}

// Insert записывает один просмотр страницы.
func (r *PageViewsRepo) Insert(ctx context.Context, userID, page string) error {
	if _, err := r.pool.Exec(ctx,
		`INSERT INTO public.page_views (user_id, page) VALUES ($1::uuid, $2)`,
		userID, page,
	); err != nil {
		return fmt.Errorf("pageViewsRepo.Insert: %w", err)
	}
	return nil
}

// Stats собирает итоги и по-дневную раскладку за последние days суток.
//
// Сутки считаются по Москве явно: сессионный пояс БД на это полагаться не
// должен. Период включает сегодняшний день: from = сегодня − (days−1).
func (r *PageViewsRepo) Stats(ctx context.Context, days int) (*PageStats, error) {
	var from, to time.Time
	if err := r.pool.QueryRow(ctx, `
SELECT ((now() AT TIME ZONE 'Europe/Moscow')::date - ($1::int - 1)),
       (now() AT TIME ZONE 'Europe/Moscow')::date`, days).Scan(&from, &to); err != nil {
		return nil, fmt.Errorf("pageViewsRepo.Stats bounds: %w", err)
	}

	// Нижняя граница — полночь первого дня по Москве, в абсолютном времени.
	const since = `(($1::date)::timestamp AT TIME ZONE 'Europe/Moscow')`

	// Пользователи по странице за период считаются отдельным запросом, а не
	// суммой по дням: один человек за неделю — один пользователь, не семь.
	rows, err := r.pool.Query(ctx, `
SELECT page, COUNT(*)::int, COUNT(DISTINCT user_id)::int,
       to_char(MAX(viewed_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
FROM public.page_views
WHERE viewed_at >= `+since+`
GROUP BY page
ORDER BY COUNT(*) DESC, page`, from)
	if err != nil {
		return nil, fmt.Errorf("pageViewsRepo.Stats pages: %w", err)
	}
	defer rows.Close()
	pages := make([]PageStatsRow, 0)
	for rows.Next() {
		var p PageStatsRow
		if err := rows.Scan(&p.Page, &p.Views, &p.Users, &p.LastViewedAt); err != nil {
			return nil, fmt.Errorf("pageViewsRepo.Stats pages scan: %w", err)
		}
		pages = append(pages, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("pageViewsRepo.Stats pages rows: %w", err)
	}

	cellRows, err := r.pool.Query(ctx, `
SELECT page,
       to_char((viewed_at AT TIME ZONE 'Europe/Moscow')::date, 'YYYY-MM-DD') AS day,
       COUNT(*)::int, COUNT(DISTINCT user_id)::int
FROM public.page_views
WHERE viewed_at >= `+since+`
GROUP BY page, day
ORDER BY page, day`, from)
	if err != nil {
		return nil, fmt.Errorf("pageViewsRepo.Stats cells: %w", err)
	}
	defer cellRows.Close()
	cells := make([]PageStatsCell, 0)
	for cellRows.Next() {
		var c PageStatsCell
		if err := cellRows.Scan(&c.Page, &c.Day, &c.Views, &c.Users); err != nil {
			return nil, fmt.Errorf("pageViewsRepo.Stats cells scan: %w", err)
		}
		cells = append(cells, c)
	}
	if err := cellRows.Err(); err != nil {
		return nil, fmt.Errorf("pageViewsRepo.Stats cells rows: %w", err)
	}

	return &PageStats{
		Days:  days,
		From:  from.Format("2006-01-02"),
		To:    to.Format("2006-01-02"),
		Pages: pages,
		Cells: cells,
	}, nil
}
