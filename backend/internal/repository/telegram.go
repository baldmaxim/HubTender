package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TelegramRepo — привязка пользователей к чату с ботом и состояние поллера.
type TelegramRepo struct {
	pool *pgxpool.Pool
}

func NewTelegramRepo(pool *pgxpool.Pool) *TelegramRepo {
	return &TelegramRepo{pool: pool}
}

// TelegramLink — привязка пользователя.
type TelegramLink struct {
	Username *string   `json:"telegram_username"`
	LinkedAt time.Time `json:"linked_at"`
}

// ErrTelegramTokenInvalid — токен привязки не найден, истёк или уже использован.
var ErrTelegramTokenInvalid = errors.New("telegram: токен привязки недействителен")

// HashLinkToken — в базе хранится только sha256 токена: утечка таблицы не даёт
// привязать чужой аккаунт.
func HashLinkToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// GetLink — привязка пользователя; nil, если её нет.
func (r *TelegramRepo) GetLink(ctx context.Context, userID string) (*TelegramLink, error) {
	var l TelegramLink
	err := r.pool.QueryRow(ctx, `
		SELECT telegram_username, linked_at FROM public.telegram_links WHERE user_id = $1`, userID).
		Scan(&l.Username, &l.LinkedAt)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, fmt.Errorf("telegramRepo.GetLink: %w", err)
	}
	return &l, nil
}

// CreateLinkToken сохраняет хэш нового токена; старые неиспользованные токены
// пользователя гасятся, чтобы в обороте была одна ссылка.
func (r *TelegramRepo) CreateLinkToken(ctx context.Context, userID, token string, ttl time.Duration) (time.Time, error) {
	expires := time.Now().Add(ttl)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return time.Time{}, fmt.Errorf("telegramRepo.CreateLinkToken: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		DELETE FROM public.telegram_link_tokens
		WHERE user_id = $1 AND (used_at IS NULL OR expires_at < now() - interval '1 day')`, userID); err != nil {
		return time.Time{}, fmt.Errorf("telegramRepo.CreateLinkToken: cleanup: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.telegram_link_tokens (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
		HashLinkToken(token), userID, expires); err != nil {
		return time.Time{}, fmt.Errorf("telegramRepo.CreateLinkToken: insert: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return time.Time{}, fmt.Errorf("telegramRepo.CreateLinkToken: commit: %w", err)
	}
	return expires, nil
}

// ConsumeLinkToken гасит токен и привязывает чат к его владельцу. Чат, ранее
// привязанный к другому пользователю, отвязывается от него. Возвращает ФИО.
func (r *TelegramRepo) ConsumeLinkToken(ctx context.Context, token string, chatID int64, username string) (string, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("telegramRepo.ConsumeLinkToken: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var userID string
	err = tx.QueryRow(ctx, `
		UPDATE public.telegram_link_tokens SET used_at = now()
		WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
		RETURNING user_id::text`, HashLinkToken(token)).Scan(&userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTelegramTokenInvalid
	}
	if err != nil {
		return "", fmt.Errorf("telegramRepo.ConsumeLinkToken: token: %w", err)
	}
	var uname *string
	if username != "" {
		uname = &username
	}
	if _, err := tx.Exec(ctx, `DELETE FROM public.telegram_links WHERE chat_id = $1 AND user_id <> $2`,
		chatID, userID); err != nil {
		return "", fmt.Errorf("telegramRepo.ConsumeLinkToken: unlink chat: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.telegram_links (user_id, chat_id, telegram_username) VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET chat_id = EXCLUDED.chat_id, telegram_username = EXCLUDED.telegram_username, linked_at = now()`,
		userID, chatID, uname); err != nil {
		return "", fmt.Errorf("telegramRepo.ConsumeLinkToken: link: %w", err)
	}
	var name string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(full_name, '') FROM public.users WHERE id = $1`, userID).
		Scan(&name); err != nil {
		return "", fmt.Errorf("telegramRepo.ConsumeLinkToken: user: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("telegramRepo.ConsumeLinkToken: commit: %w", err)
	}
	return name, nil
}

// Unlink отвязывает пользователя.
func (r *TelegramRepo) Unlink(ctx context.Context, userID string) error {
	if _, err := r.pool.Exec(ctx, `DELETE FROM public.telegram_links WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("telegramRepo.Unlink: %w", err)
	}
	return nil
}

// UnlinkChat отвязывает чат (/stop в боте). Возвращает, была ли привязка.
func (r *TelegramRepo) UnlinkChat(ctx context.Context, chatID int64) (bool, error) {
	tag, err := r.pool.Exec(ctx, `DELETE FROM public.telegram_links WHERE chat_id = $1`, chatID)
	if err != nil {
		return false, fmt.Errorf("telegramRepo.UnlinkChat: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// UserByChat — пользователь привязанного чата; "" — чат не привязан.
func (r *TelegramRepo) UserByChat(ctx context.Context, chatID int64) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `SELECT user_id::text FROM public.telegram_links WHERE chat_id = $1`, chatID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("telegramRepo.UserByChat: %w", err)
	}
	return id, nil
}

// GetOffset — offset getUpdates; 0 — поллер ещё не запускался.
func (r *TelegramRepo) GetOffset(ctx context.Context) (int64, error) {
	var off int64
	err := r.pool.QueryRow(ctx, `SELECT update_offset FROM public.telegram_bot_state WHERE id = 1`).Scan(&off)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, fmt.Errorf("telegramRepo.GetOffset: %w", err)
	}
	return off, nil
}

// SetOffset сохраняет offset: обработанные обновления не придут повторно после рестарта.
func (r *TelegramRepo) SetOffset(ctx context.Context, offset int64) error {
	if _, err := r.pool.Exec(ctx, `
		INSERT INTO public.telegram_bot_state (id, update_offset, updated_at) VALUES (1, $1, now())
		ON CONFLICT (id) DO UPDATE SET update_offset = EXCLUDED.update_offset, updated_at = now()`,
		offset); err != nil {
		return fmt.Errorf("telegramRepo.SetOffset: %w", err)
	}
	return nil
}
