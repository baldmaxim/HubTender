package repository

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Рассылка замечаний: адресация по аудиту, антиповтор, очередь и привязка Telegram.
//
//	HUBTENDER_TEST_DATABASE_URL=… go test ./internal/repository/ -run DispatchIntegration -v

func dispatchUser(t *testing.T, pool *pgxpool.Pool, name string) string {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.roles (code, name) VALUES ('engineer', 'Инженер') ON CONFLICT (code) DO NOTHING`); err != nil {
		t.Fatalf("role: %v", err)
	}
	var id string
	if err := pool.QueryRow(ctx, `
		INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), gen_random_uuid()::text || '@itest')
		RETURNING id::text`).Scan(&id); err != nil {
		t.Fatalf("auth user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.users (id, full_name, email, role_code) VALUES ($1::uuid, $2::text, 'itest-' || $1::text || '@example.com', 'engineer')`,
		id, name); err != nil {
		t.Fatalf("user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, id)
	})
	return id
}

func dispatchAudit(t *testing.T, pool *pgxpool.Pool, itemID, positionID, userID string, ago time.Duration) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		INSERT INTO public.boq_items_audit (boq_item_id, operation_type, changed_at, changed_by, new_data)
		VALUES ($1::uuid, 'INSERT', now() - make_interval(secs => $4), $3::uuid,
		        jsonb_build_object('client_position_id', $2::text))`,
		itemID, positionID, userID, ago.Seconds()); err != nil {
		t.Fatalf("audit: %v", err)
	}
}

func TestDispatchIntegration_ResolveEnqueueSend(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	f := newVRFixture(t, pool)
	rep := vrRun(t, NewQualityRepo(pool), f.tenderID, RunTriggerView)

	author, frequent, sender := dispatchUser(t, pool, "Автор строки"), dispatchUser(t, pool, "Автор позиции"),
		dispatchUser(t, pool, "Проверяющий")

	q := findFinding(rep, "Q", f.r2)
	u := findFinding(rep, "U", f.p1)
	if q == nil || u == nil || q.FindingID == nil || u.FindingID == nil {
		t.Fatalf("нет находок Q/U в фикстуре: %+v", rep.Findings)
	}
	// Строка r2: последняя правка — author (раньше правил frequent).
	dispatchAudit(t, pool, f.r2, f.p2, frequent, time.Hour)
	dispatchAudit(t, pool, f.r2, f.p2, author, time.Minute)
	// Позиция p1: frequent правил её строки дважды, author — один раз.
	var p1Row string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM public.boq_items WHERE client_position_id = $1 LIMIT 1`,
		f.p1).Scan(&p1Row); err != nil {
		t.Fatal(err)
	}
	dispatchAudit(t, pool, p1Row, f.p1, frequent, 3*time.Hour)
	dispatchAudit(t, pool, p1Row, f.p1, frequent, 2*time.Hour)
	dispatchAudit(t, pool, p1Row, f.p1, author, time.Hour)

	repo := NewVerificationDispatchRepo(pool)
	ids := []string{*q.FindingID, *u.FindingID}
	targets, err := repo.ResolveRecipients(ctx, f.tenderID, ids, sender)
	if err != nil || len(targets) != 2 {
		t.Fatalf("адресация: %+v %v", targets, err)
	}
	for _, tg := range targets {
		switch tg.FindingID {
		case *q.FindingID:
			if tg.UserID != author || tg.Resolver != ResolverItemAuthor {
				t.Fatalf("Q должна уйти автору последней правки строки: %+v", tg)
			}
		case *u.FindingID:
			// U — находка по позиции: у неё нет строки, адресат — самый частый автор строк.
			if tg.UserID != frequent || tg.Resolver != ResolverPositionAuthor {
				t.Fatalf("U должна уйти самому частому автору позиции: %+v", tg)
			}
		}
	}

	// Без привязки Telegram ничего не ставится.
	res, err := repo.Enqueue(ctx, f.tenderID, sender, targets, 10)
	if err != nil || res.Queued != 0 || res.Unlinked != 2 {
		t.Fatalf("без привязки: %+v %v", res, err)
	}

	tg := NewTelegramRepo(pool)
	for i, uid := range []string{author, frequent} {
		if _, err := tg.CreateLinkToken(ctx, uid, "tok-"+uid, time.Minute); err != nil {
			t.Fatal(err)
		}
		if _, err := tg.ConsumeLinkToken(ctx, "tok-"+uid, 9000000+int64(i), "u"); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tg.ConsumeLinkToken(ctx, "tok-"+author, 1, ""); err != ErrTelegramTokenInvalid {
		t.Fatalf("токен сработал повторно: %v", err)
	}

	res, err = repo.Enqueue(ctx, f.tenderID, sender, targets, 10)
	if err != nil || res.Queued != 2 || res.Messages != 2 {
		t.Fatalf("постановка: %+v %v", res, err)
	}
	res, err = repo.Enqueue(ctx, f.tenderID, sender, targets, 10)
	if err != nil || res.Queued != 0 || res.Duplicates != 2 {
		t.Fatalf("повтор той же находки с тем же отпечатком: %+v %v", res, err)
	}

	claimed, err := repo.ClaimPending(ctx, 10, time.Minute)
	if err != nil || len(claimed) < 2 {
		t.Fatalf("захват очереди: %+v %v", claimed, err)
	}
	if again, _ := repo.ClaimPending(ctx, 10, time.Minute); len(again) != 0 {
		t.Fatalf("арендованные сообщения захвачены повторно: %+v", again)
	}

	var sentToAuthor string
	for _, n := range claimed {
		p, err := repo.LoadPayload(ctx, n.ID)
		if err != nil {
			t.Fatal(err)
		}
		if p.ChatID == 0 || len(p.Items) != 1 || p.TenderTitle == "" {
			t.Fatalf("содержимое сообщения: %+v", p)
		}
		if p.ChatID == 9000000 {
			sentToAuthor = n.ID
			if err := repo.MarkSent(ctx, n.ID, 42); err != nil {
				t.Fatal(err)
			}
			item, err := repo.GetCallbackItem(ctx, p.Items[0].ItemID)
			if err != nil || item.RecipientUserID != author || item.RuleCode != "Q" ||
				item.SentFingerprint != item.CurrentFingerprint || item.Resolved {
				t.Fatalf("элемент для кнопки: %+v %v", item, err)
			}
			if err := repo.SetItemVerdict(ctx, p.Items[0].ItemID, "accepted"); err != nil {
				t.Fatal(err)
			}
		} else if err := repo.MarkClosed(ctx, n.ID, "failed", "403"); err != nil {
			t.Fatal(err)
		}
	}
	if sentToAuthor == "" {
		t.Fatal("сообщение автору не найдено")
	}

	// Неотправленное (failed) снимает антиповтор — повторная отправка проходит.
	res, err = repo.Enqueue(ctx, f.tenderID, sender, targets, 10)
	if err != nil || res.Queued != 1 || res.Duplicates != 1 {
		t.Fatalf("после failed: %+v %v", res, err)
	}

	if ok, err := tg.UnlinkChat(ctx, 9000001); err != nil || !ok {
		t.Fatalf("/stop: %v %v", ok, err)
	}
	if uid, _ := tg.UserByChat(ctx, 9000001); uid != "" {
		t.Fatal("чат остался привязан после /stop")
	}
}
