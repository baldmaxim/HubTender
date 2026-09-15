package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// VerificationDispatchRepo — адресация находок и очередь сообщений в Telegram.
type VerificationDispatchRepo struct {
	pool *pgxpool.Pool
}

func NewVerificationDispatchRepo(pool *pgxpool.Pool) *VerificationDispatchRepo {
	return &VerificationDispatchRepo{pool: pool}
}

// Кто адресат находки — пишется в элемент рассылки, чтобы на вопрос «почему это
// пришло мне» был ответ.
const (
	ResolverItemAuthor     = "item_author"
	ResolverPositionAuthor = "position_author"
	ResolverSender         = "sender"
)

// MaxDispatchFindings — предел одной отправки.
const MaxDispatchFindings = 500

// DispatchTarget — находка и её адресат.
type DispatchTarget struct {
	FindingID   string
	Fingerprint string
	UserID      string
	Resolver    string
}

// ErrDispatchEmpty — среди выбранных нет открытых находок этого тендера.
var ErrDispatchEmpty = errors.New("dispatch: нет открытых находок для отправки")

// ResolveRecipients находит адресата каждой открытой находки: автор последней
// правки строки, иначе самый частый автор строк позиции, иначе отправивший.
// Правки без автора (changed_by NULL) не учитываются.
func (r *VerificationDispatchRepo) ResolveRecipients(
	ctx context.Context, tenderID string, findingIDs []string, senderID string,
) ([]DispatchTarget, error) {
	rows, err := r.pool.Query(ctx, `
		WITH f AS (
			SELECT vf.id, vf.entity_type, vf.entity_id, vf.client_position_id, vf.fingerprint
			FROM public.verification_findings vf
			WHERE vf.tender_id = $1 AND vf.id = ANY($2::uuid[]) AND vf.resolved_at IS NULL
		)
		SELECT f.id::text, f.fingerprint,
		       ia.changed_by::text, pa.changed_by::text
		FROM f
		LEFT JOIN LATERAL (
			SELECT au.changed_by
			FROM public.boq_items_audit au
			WHERE f.entity_type = 'boq_item' AND au.boq_item_id = f.entity_id AND au.changed_by IS NOT NULL
			ORDER BY au.changed_at DESC
			LIMIT 1
		) ia ON true
		LEFT JOIN LATERAL (
			SELECT au.changed_by
			FROM public.boq_items_audit au
			-- Только когда автора строки нет: иначе группировка по аудиту позиции
			-- считается зря для каждой находки (на проде 4 с против 90 мс).
			WHERE ia.changed_by IS NULL
			  AND f.client_position_id IS NOT NULL
			  AND (au.new_data ->> 'client_position_id') = f.client_position_id::text
			  AND au.changed_by IS NOT NULL
			GROUP BY au.changed_by
			ORDER BY count(*) DESC, max(au.changed_at) DESC
			LIMIT 1
		) pa ON true
		ORDER BY f.id`, tenderID, findingIDs)
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.ResolveRecipients: %w", err)
	}
	defer rows.Close()
	var out []DispatchTarget
	for rows.Next() {
		var t DispatchTarget
		var item, pos *string
		if err := rows.Scan(&t.FindingID, &t.Fingerprint, &item, &pos); err != nil {
			return nil, fmt.Errorf("dispatchRepo.ResolveRecipients: scan: %w", err)
		}
		switch {
		case item != nil:
			t.UserID, t.Resolver = *item, ResolverItemAuthor
		case pos != nil:
			t.UserID, t.Resolver = *pos, ResolverPositionAuthor
		default:
			t.UserID, t.Resolver = senderID, ResolverSender
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// DispatchRecipient — сводка по адресату для предпросмотра.
type DispatchRecipient struct {
	UserID      string         `json:"user_id"`
	FullName    string         `json:"full_name"`
	Linked      bool           `json:"linked"`
	Findings    int            `json:"findings"`
	AlreadySent int            `json:"already_sent"`
	ByResolver  map[string]int `json:"by_resolver"`
}

func dedupKey(t DispatchTarget) string {
	return t.UserID + "|" + t.FindingID + "|" + t.Fingerprint
}

// Summarize группирует находки по адресатам: ФИО, привязан ли Telegram и сколько
// из них уже уходило этому адресату с тем же отпечатком.
func (r *VerificationDispatchRepo) Summarize(ctx context.Context, targets []DispatchTarget) ([]DispatchRecipient, error) {
	return summarize(ctx, r.pool, targets)
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func summarize(ctx context.Context, q querier, targets []DispatchTarget) ([]DispatchRecipient, error) {
	keys := make([]string, len(targets))
	userSet := map[string]bool{}
	var users []string
	for i, t := range targets {
		keys[i] = dedupKey(t)
		if !userSet[t.UserID] {
			userSet[t.UserID] = true
			users = append(users, t.UserID)
		}
	}
	sent, err := sentDedupKeys(ctx, q, keys)
	if err != nil {
		return nil, err
	}

	byUser := map[string]*DispatchRecipient{}
	rows, err := q.Query(ctx, `
		SELECT u.id::text, COALESCE(u.full_name, ''), tl.chat_id IS NOT NULL
		FROM public.users u
		LEFT JOIN public.telegram_links tl ON tl.user_id = u.id
		WHERE u.id = ANY($1::uuid[])`, users)
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.summarize: users: %w", err)
	}
	for rows.Next() {
		rec := &DispatchRecipient{ByResolver: map[string]int{}}
		if err := rows.Scan(&rec.UserID, &rec.FullName, &rec.Linked); err != nil {
			rows.Close()
			return nil, err
		}
		byUser[rec.UserID] = rec
	}
	rows.Close()

	out := make([]DispatchRecipient, 0, len(users))
	for _, uid := range users {
		rec, ok := byUser[uid]
		if !ok {
			rec = &DispatchRecipient{UserID: uid, ByResolver: map[string]int{}}
		}
		for _, t := range targets {
			if t.UserID != uid {
				continue
			}
			rec.Findings++
			rec.ByResolver[t.Resolver]++
			if sent[dedupKey(t)] {
				rec.AlreadySent++
			}
		}
		out = append(out, *rec)
	}
	return out, nil
}

// sentDedupKeys — какие из ключей уже стоят в очереди или отправлены.
func sentDedupKeys(ctx context.Context, q querier, keys []string) (map[string]bool, error) {
	rows, err := q.Query(ctx, `
		SELECT dedup_key FROM public.verification_notification_items WHERE dedup_key = ANY($1::text[])`, keys)
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo: dedup: %w", err)
	}
	defer rows.Close()
	sent := map[string]bool{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err != nil {
			return nil, err
		}
		sent[k] = true
	}
	return sent, rows.Err()
}

// DispatchResult — итог постановки в очередь.
type DispatchResult struct {
	Recipients []DispatchRecipient `json:"recipients"`
	Queued     int                 `json:"queued"`
	Messages   int                 `json:"messages"`
	Duplicates int                 `json:"duplicates"`
	Unlinked   int                 `json:"unlinked"`
}

// Enqueue ставит сообщения в очередь: адресатам с привязанным Telegram, без
// находок, которые уже уходили им с тем же отпечатком; по perMessage находок.
func (r *VerificationDispatchRepo) Enqueue(
	ctx context.Context, tenderID, senderID string, targets []DispatchTarget, perMessage int,
) (*DispatchResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("dispatchRepo.Enqueue: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	recipients, err := summarize(ctx, tx, targets)
	if err != nil {
		return nil, err
	}
	res := &DispatchResult{Recipients: recipients}
	keys := make([]string, len(targets))
	for i, t := range targets {
		keys[i] = dedupKey(t)
	}
	sentKeys, err := sentDedupKeys(ctx, tx, keys)
	if err != nil {
		return nil, err
	}

	for _, rec := range recipients {
		var batch []DispatchTarget
		for _, t := range targets {
			if t.UserID != rec.UserID {
				continue
			}
			switch {
			case !rec.Linked:
				res.Unlinked++
			case sentKeys[dedupKey(t)]:
				res.Duplicates++
			default:
				batch = append(batch, t)
			}
		}
		for start := 0; start < len(batch); start += perMessage {
			end := min(start+perMessage, len(batch))
			if err := insertNotification(ctx, tx, tenderID, senderID, rec.UserID, batch[start:end]); err != nil {
				return nil, err
			}
			res.Messages++
			res.Queued += end - start
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("dispatchRepo.Enqueue: commit: %w", err)
	}
	return res, nil
}

func insertNotification(ctx context.Context, tx pgx.Tx, tenderID, senderID, userID string, items []DispatchTarget) error {
	var id string
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.verification_notifications (tender_id, recipient_user_id, created_by)
		VALUES ($1, $2, $3) RETURNING id::text`, tenderID, userID, senderID).Scan(&id); err != nil {
		return fmt.Errorf("dispatchRepo.Enqueue: notification: %w", err)
	}
	fids, prints, resolvers, keys := make([]string, len(items)), make([]string, len(items)),
		make([]string, len(items)), make([]string, len(items))
	for i, t := range items {
		fids[i], prints[i], resolvers[i], keys[i] = t.FindingID, t.Fingerprint, t.Resolver, dedupKey(t)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.verification_notification_items
			(notification_id, finding_id, recipient_user_id, fingerprint, resolver, dedup_key)
		SELECT $1::uuid, x.finding_id, $2::uuid, x.fingerprint, x.resolver, x.dedup_key
		FROM unnest($3::uuid[], $4::text[], $5::text[], $6::text[])
		     AS x(finding_id, fingerprint, resolver, dedup_key)`,
		id, userID, fids, prints, resolvers, keys); err != nil {
		return fmt.Errorf("dispatchRepo.Enqueue: items: %w", err)
	}
	return nil
}
