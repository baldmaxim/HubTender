package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NotificationsRepo handles inserts into the notifications table.
type NotificationsRepo struct {
	pool *pgxpool.Pool
}

// NewNotificationsRepo creates a NotificationsRepo.
func NewNotificationsRepo(pool *pgxpool.Pool) *NotificationsRepo {
	return &NotificationsRepo{pool: pool}
}

// NotificationInput captures the writable columns for a notifications row.
// UserID is optional — system-wide notifications leave it NULL.
type NotificationInput struct {
	UserID  *string
	Type    string
	Title   string
	Message string
}

// Insert writes one row. is_read defaults to false at the SQL level.
func (r *NotificationsRepo) Insert(ctx context.Context, in NotificationInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.notifications (user_id, type, title, message, is_read)
		VALUES ($1, $2, $3, $4, false)
	`, in.UserID, in.Type, in.Title, in.Message)
	if err != nil {
		return fmt.Errorf("notificationsRepo.Insert: %w", err)
	}
	return nil
}
