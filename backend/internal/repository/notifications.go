package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NotificationsRepo handles reads/writes for the notifications table.
type NotificationsRepo struct {
	pool *pgxpool.Pool
}

// NewNotificationsRepo creates a NotificationsRepo.
func NewNotificationsRepo(pool *pgxpool.Pool) *NotificationsRepo {
	return &NotificationsRepo{pool: pool}
}

// NotificationInput captures the writable columns for a notifications row.
// The Yandex baseline schema has no user_id column — notifications are
// system-wide; per-user routing is done via related_entity_* fields.
type NotificationInput struct {
	UserID  *string // accepted for API compatibility, currently ignored
	Type    string
	Title   string
	Message string
}

// NotificationRow is one row of public.notifications (read shape).
type NotificationRow struct {
	ID                string    `json:"id"`
	Type              string    `json:"type"`
	Title             string    `json:"title"`
	Message           string    `json:"message"`
	RelatedEntityType *string   `json:"related_entity_type"`
	RelatedEntityID   *string   `json:"related_entity_id"`
	IsRead            bool      `json:"is_read"`
	CreatedAt         time.Time `json:"created_at"`
}

// Insert writes one row. is_read defaults to false at the SQL level.
func (r *NotificationsRepo) Insert(ctx context.Context, in NotificationInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.notifications (type, title, message, is_read)
		VALUES ($1, $2, $3, false)
	`, in.Type, in.Title, in.Message)
	if err != nil {
		return fmt.Errorf("notificationsRepo.Insert: %w", err)
	}
	return nil
}

// List returns the most recent `limit` notifications, newest first.
func (r *NotificationsRepo) List(ctx context.Context, limit int) ([]NotificationRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id, type, title, message, related_entity_type, related_entity_id,
		       is_read, created_at
		FROM public.notifications
		ORDER BY created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, fmt.Errorf("notificationsRepo.List: query: %w", err)
	}
	defer rows.Close()

	var out []NotificationRow
	for rows.Next() {
		var n NotificationRow
		if err := rows.Scan(&n.ID, &n.Type, &n.Title, &n.Message,
			&n.RelatedEntityType, &n.RelatedEntityID, &n.IsRead, &n.CreatedAt); err != nil {
			return nil, fmt.Errorf("notificationsRepo.List: scan: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("notificationsRepo.List: rows: %w", err)
	}
	return out, nil
}

// DeleteAll removes every row from public.notifications.
func (r *NotificationsRepo) DeleteAll(ctx context.Context) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM public.notifications`); err != nil {
		return fmt.Errorf("notificationsRepo.DeleteAll: %w", err)
	}
	return nil
}
