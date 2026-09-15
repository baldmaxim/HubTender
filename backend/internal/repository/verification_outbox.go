package repository

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// MaxNotificationAttempts — после стольких неудачных попыток сообщение failed.
const MaxNotificationAttempts = 5

// PendingNotification — сообщение, взятое отправщиком.
type PendingNotification struct {
	ID       string
	Attempts int
}

// ClaimPending берёт до limit сообщений, которым пора уйти, и сдвигает им
// next_attempt_at вперёд — это аренда: второй отправщик (или этот же после
// рестарта посреди отправки) их не возьмёт, пока аренда не истечёт.
func (r *VerificationDispatchRepo) ClaimPending(ctx context.Context, limit int, lease time.Duration) ([]PendingNotification, error) {
	rows, err := r.pool.Query(ctx, `
		UPDATE public.verification_notifications n
		SET attempts = n.attempts + 1, next_attempt_at = now() + make_interval(secs => $2)
		WHERE n.id IN (
			SELECT id FROM public.verification_notifications
			WHERE status = 'pending' AND next_attempt_at <= now()
			ORDER BY created_at
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING n.id::text, n.attempts`, limit, lease.Seconds())
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.ClaimPending: %w", err)
	}
	defer rows.Close()
	var out []PendingNotification
	for rows.Next() {
		var p PendingNotification
		if err := rows.Scan(&p.ID, &p.Attempts); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// NotificationPayload — всё для текста сообщения.
type NotificationPayload struct {
	TenderID    string
	ChatID      int64 // 0 — адресат отвязал Telegram
	TenderTitle string
	SenderName  string
	Items       []NotificationPayloadItem
}

type NotificationPayloadItem struct {
	ItemID   string
	RuleCode string
	Position string
	Detail   string
}

// LoadPayload — содержимое сообщения. В него идут только находки, которые всё
// ещё открыты и не изменились с момента постановки в очередь: если инженер уже
// исправил строку, писать ему о ней незачем.
func (r *VerificationDispatchRepo) LoadPayload(ctx context.Context, notificationID string) (*NotificationPayload, error) {
	p := &NotificationPayload{}
	var chat *int64
	var version *int
	err := r.pool.QueryRow(ctx, `
		SELECT n.tender_id::text, tl.chat_id, COALESCE(t.title, ''), t.version, COALESCE(s.full_name, '')
		FROM public.verification_notifications n
		JOIN public.tenders t ON t.id = n.tender_id
		LEFT JOIN public.telegram_links tl ON tl.user_id = n.recipient_user_id
		LEFT JOIN public.users s ON s.id = n.created_by
		WHERE n.id = $1`, notificationID).Scan(&p.TenderID, &chat, &p.TenderTitle, &version, &p.SenderName)
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.LoadPayload: %w", err)
	}
	if chat != nil {
		p.ChatID = *chat
	}
	if version != nil && *version > 1 {
		p.TenderTitle += " (версия " + strconv.Itoa(*version) + ")"
	}
	rows, err := r.pool.Query(ctx, `
		SELECT i.id::text, f.rule_code,
		       COALESCE(NULLIF(btrim(f.item_no), ''), trim_scale(f.position_number)::text, ''),
		       f.detail
		FROM public.verification_notification_items i
		JOIN public.verification_findings f ON f.id = i.finding_id
		WHERE i.notification_id = $1 AND f.resolved_at IS NULL AND f.fingerprint = i.fingerprint
		ORDER BY f.rule_code, f.position_number NULLS LAST, i.id`, notificationID)
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.LoadPayload: items: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var it NotificationPayloadItem
		if err := rows.Scan(&it.ItemID, &it.RuleCode, &it.Position, &it.Detail); err != nil {
			return nil, err
		}
		p.Items = append(p.Items, it)
	}
	return p, rows.Err()
}

// MarkSent — сообщение доставлено.
func (r *VerificationDispatchRepo) MarkSent(ctx context.Context, id string, messageID int64) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.verification_notifications
		SET status = 'sent', sent_at = now(), telegram_message_id = $2, last_error = NULL
		WHERE id = $1`, id, messageID)
	if err != nil {
		return fmt.Errorf("dispatchRepo.MarkSent: %w", err)
	}
	return nil
}

// MarkClosed — сообщение не уйдёт (failed или skipped). Ключи антиповтора
// снимаются: следующая отправка тех же находок должна пройти.
func (r *VerificationDispatchRepo) MarkClosed(ctx context.Context, id, status, reason string) error {
	if status != "failed" && status != "skipped" {
		return fmt.Errorf("dispatchRepo.MarkClosed: статус %q", status)
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("dispatchRepo.MarkClosed: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `
		UPDATE public.verification_notifications SET status = $2, last_error = $3 WHERE id = $1`,
		id, status, reason); err != nil {
		return fmt.Errorf("dispatchRepo.MarkClosed: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.verification_notification_items SET dedup_key = NULL WHERE notification_id = $1`, id); err != nil {
		return fmt.Errorf("dispatchRepo.MarkClosed: items: %w", err)
	}
	return tx.Commit(ctx)
}

// MarkRetry — временная ошибка, повтор через delay.
func (r *VerificationDispatchRepo) MarkRetry(ctx context.Context, id, reason string, delay time.Duration) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.verification_notifications
		SET last_error = $2, next_attempt_at = now() + make_interval(secs => $3)
		WHERE id = $1`, id, reason, delay.Seconds())
	if err != nil {
		return fmt.Errorf("dispatchRepo.MarkRetry: %w", err)
	}
	return nil
}

// CallbackItem — элемент рассылки, на кнопку которого нажали.
type CallbackItem struct {
	RecipientUserID    string
	TenderID           string
	RuleCode           string
	EntityID           string
	SentFingerprint    string
	CurrentFingerprint string
	Resolved           bool
}

// ErrCallbackItemNotFound — элемента нет (находку удалили вместе с тендером).
var ErrCallbackItemNotFound = errors.New("dispatch: элемент рассылки не найден")

func (r *VerificationDispatchRepo) GetCallbackItem(ctx context.Context, itemID string) (*CallbackItem, error) {
	c := &CallbackItem{}
	err := r.pool.QueryRow(ctx, `
		SELECT i.recipient_user_id::text, f.tender_id::text, f.rule_code, f.entity_id::text,
		       i.fingerprint, f.fingerprint, f.resolved_at IS NOT NULL
		FROM public.verification_notification_items i
		JOIN public.verification_findings f ON f.id = i.finding_id
		WHERE i.id = $1`, itemID).
		Scan(&c.RecipientUserID, &c.TenderID, &c.RuleCode, &c.EntityID,
			&c.SentFingerprint, &c.CurrentFingerprint, &c.Resolved)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCallbackItemNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.GetCallbackItem: %w", err)
	}
	return c, nil
}

// SetItemVerdict — ответ адресата на элемент рассылки.
func (r *VerificationDispatchRepo) SetItemVerdict(ctx context.Context, itemID, verdict string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.verification_notification_items SET verdict = $2, verdict_at = now() WHERE id = $1`,
		itemID, verdict)
	if err != nil {
		return fmt.Errorf("dispatchRepo.SetItemVerdict: %w", err)
	}
	return nil
}
