package services

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeLinks struct {
	user       string
	consumedAt time.Time
	consumeErr error
	touched    string
	unlinkOK   bool
}

func (l *fakeLinks) ConsumeLinkToken(_ context.Context, _ string, _ int64, _ string, at time.Time) (string, error) {
	l.consumedAt = at
	return "Иванов <b>", l.consumeErr
}
func (l *fakeLinks) UnlinkChat(context.Context, int64) (bool, error)   { return l.unlinkOK, nil }
func (l *fakeLinks) UserByChat(context.Context, int64) (string, error) { return l.user, nil }
func (l *fakeLinks) TouchBot(_ context.Context, name string) error     { l.touched = name; return nil }

type fakeOutbox struct {
	item     *repository.CallbackItem
	itemErr  error
	payload  *repository.NotificationPayload
	payErr   error
	claimed  []repository.PendingNotification
	state    string
	attempts int
	status   string
	reason   string
	delay    time.Duration
	verdict  string
	sentID   int64
}

func (o *fakeOutbox) ClaimPending(context.Context, int, time.Duration) ([]repository.PendingNotification, error) {
	return o.claimed, nil
}
func (o *fakeOutbox) LoadPayload(context.Context, string) (*repository.NotificationPayload, error) {
	return o.payload, o.payErr
}
func (o *fakeOutbox) NotificationState(context.Context, string) (string, int, error) {
	if o.state == "" {
		return "", 0, repository.ErrNotificationNotFound
	}
	return o.state, o.attempts, nil
}
func (o *fakeOutbox) MarkSent(_ context.Context, _ string, id int64) error {
	o.status, o.sentID = "sent", id
	return nil
}
func (o *fakeOutbox) MarkClosed(_ context.Context, _, status, reason string) error {
	o.status, o.reason = status, reason
	return nil
}
func (o *fakeOutbox) MarkRetry(_ context.Context, _, reason string, delay time.Duration) error {
	o.status, o.reason, o.delay = "retry", reason, delay
	return nil
}
func (o *fakeOutbox) GetCallbackItem(context.Context, string) (*repository.CallbackItem, error) {
	return o.item, o.itemErr
}
func (o *fakeOutbox) SetItemVerdict(_ context.Context, _, v string) error { o.verdict = v; return nil }

type fakeVerdicts struct{ source, verdict, actor string }

func (v *fakeVerdicts) SetVerdictFrom(_ context.Context, source, _, _, _, _, verdict string, _ *string, by *string) error {
	v.source, v.verdict, v.actor = source, verdict, *by
	return nil
}

const itemID = "0f8fad5b-d9cb-469f-a165-70867728950e"

var botNow = time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)

func newTestBot(user string, item *repository.CallbackItem) (*VerificationBotService, *fakeLinks, *fakeOutbox, *fakeVerdicts) {
	l, o, v := &fakeLinks{user: user}, &fakeOutbox{item: item}, &fakeVerdicts{}
	b := NewVerificationBotService(l, o, v, "https://gp.su10.ru", zerolog.Nop())
	b.now = func() time.Time { return botNow }
	return b, l, o, v
}

func press(t *testing.T, b *VerificationBotService, data string) []BotAction {
	t.Helper()
	acts, err := b.HandleUpdate(context.Background(), telegram.Update{CallbackQuery: &telegram.CallbackQuery{
		ID: "cb", Data: data, Message: &telegram.Message{Chat: telegram.Chat{ID: 1, Type: "private"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return acts
}

func message(text string, date time.Time) telegram.Update {
	m := &telegram.Message{Chat: telegram.Chat{ID: 5, Type: "private"}, Text: text, From: &telegram.User{Username: "ivan"}}
	if !date.IsZero() {
		m.Date = date.Unix()
	}
	return telegram.Update{Message: m}
}

func TestVerificationBotCallback(t *testing.T) {
	base := repository.CallbackItem{
		RecipientUserID: "u1", TenderID: "t", RuleCode: "Q", EntityID: "e",
		SentFingerprint: "fp", CurrentFingerprint: "fp",
	}
	cases := []struct {
		name    string
		user    string
		mutate  func(*repository.CallbackItem)
		itemErr error
		data    string
		verdict string
		answer  string
	}{
		{"норма", "u1", nil, nil, "a:" + itemID, "accepted", "норма"},
		{"ошибка", "u1", nil, nil, "e:" + itemID, "error", "ошибка"},
		{"чужое замечание", "u2", nil, nil, "a:" + itemID, "", "другому"},
		{"строка изменилась", "u1", func(i *repository.CallbackItem) { i.CurrentFingerprint = "new" }, nil, "a:" + itemID, "", "изменилась"},
		{"уже исправлено", "u1", func(i *repository.CallbackItem) { i.Resolved = true }, nil, "a:" + itemID, "", "исправлено"},
		{"чат не привязан", "", nil, nil, "a:" + itemID, "", "не привязан"},
		{"битые данные", "u1", nil, nil, "a:1", "", "устарела"},
		{"замечания нет", "u1", nil, repository.ErrCallbackItemNotFound, "a:" + itemID, "", "больше не существует"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := base
			if tc.mutate != nil {
				tc.mutate(&item)
			}
			b, _, o, v := newTestBot(tc.user, &item)
			o.itemErr = tc.itemErr
			acts := press(t, b, tc.data)
			if v.verdict != tc.verdict || o.verdict != tc.verdict {
				t.Fatalf("вердикт %q/%q, ожидался %q", v.verdict, o.verdict, tc.verdict)
			}
			if tc.verdict != "" && (v.source != "telegram" || v.actor != "u1") {
				t.Fatalf("источник/автор вердикта: %+v", v)
			}
			if len(acts) != 1 || acts[0].Method != "answerCallbackQuery" || acts[0].CallbackQueryID != "cb" ||
				!strings.Contains(acts[0].Text, tc.answer) {
				t.Fatalf("ответ на кнопку: %+v", acts)
			}
		})
	}
}

func TestVerificationBotCallbackDBError(t *testing.T) {
	b, _, o, _ := newTestBot("u1", nil)
	o.itemErr = errors.New("db down")
	if _, err := b.HandleUpdate(context.Background(), telegram.Update{CallbackQuery: &telegram.CallbackQuery{
		ID: "cb", Data: "a:" + itemID, Message: &telegram.Message{Chat: telegram.Chat{ID: 1}},
	}}); err == nil {
		t.Fatal("ошибка БД должна вернуться, чтобы бот повторил обновление")
	}
}

func TestVerificationBotStart(t *testing.T) {
	cases := []struct {
		name      string
		date      time.Time
		wantAt    time.Time
		tokenErr  error
		wantReply string
	}{
		{"время из сообщения", botNow.Add(-10 * time.Minute), botNow.Add(-10 * time.Minute), nil, "Готово, Иванов  b"},
		{"даты нет — сейчас", time.Time{}, botNow, nil, "Готово"},
		{"из будущего — сейчас", botNow.Add(time.Hour), botNow, nil, "Готово"},
		{"старше суток — now-24h", botNow.Add(-48 * time.Hour), botNow.Add(-24 * time.Hour), nil, "Готово"},
		{"токен просрочен на момент нажатия", botNow.Add(-3 * time.Hour), botNow.Add(-3 * time.Hour),
			repository.ErrTelegramTokenInvalid, "Ссылка устарела"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, l, _, _ := newTestBot("", nil)
			l.consumeErr = tc.tokenErr
			acts, err := b.HandleUpdate(context.Background(), message("/start tok", tc.date))
			if err != nil {
				t.Fatal(err)
			}
			if !l.consumedAt.Equal(tc.wantAt) {
				t.Fatalf("at = %v, ожидалось %v", l.consumedAt, tc.wantAt)
			}
			if len(acts) != 1 || acts[0].Method != "sendMessage" || acts[0].ChatID != 5 ||
				acts[0].Message.ParseMode != "HTML" || !strings.Contains(acts[0].Message.Text, tc.wantReply) {
				t.Fatalf("действия: %+v", acts)
			}
		})
	}
}

func TestVerificationBotStartDBError(t *testing.T) {
	b, l, _, _ := newTestBot("", nil)
	l.consumeErr = errors.New("db down")
	if _, err := b.HandleUpdate(context.Background(), message("/start tok", botNow)); err == nil {
		t.Fatal("ошибка БД при привязке должна вернуться")
	}
}

func TestVerificationBotMessages(t *testing.T) {
	b, l, _, _ := newTestBot("", nil)
	l.unlinkOK = true
	acts, err := b.HandleUpdate(context.Background(), message("/stop", botNow))
	if err != nil || len(acts) != 1 || !strings.Contains(acts[0].Message.Text, "отключены") {
		t.Fatalf("/stop: %+v %v", acts, err)
	}
	l.unlinkOK = false
	if acts, _ = b.HandleUpdate(context.Background(), message("/stop", botNow)); len(acts) != 0 {
		t.Fatalf("/stop без привязки: %+v", acts)
	}
	if acts, _ = b.HandleUpdate(context.Background(), message("/start", botNow)); len(acts) != 1 ||
		!strings.Contains(acts[0].Message.Text, "Привязать") {
		t.Fatalf("/start без токена: %+v", acts)
	}
	if acts, _ = b.HandleUpdate(context.Background(), message("привет", botNow)); len(acts) != 1 ||
		!strings.Contains(acts[0].Message.Text, "Отвечать на них") {
		t.Fatalf("прочий текст: %+v", acts)
	}
	group := message("/start tok", botNow)
	group.Message.Chat.Type = "group"
	acts, err = b.HandleUpdate(context.Background(), group)
	if err != nil || acts == nil || len(acts) != 0 {
		t.Fatalf("групповой чат: %+v %v", acts, err)
	}
	if !l.consumedAt.IsZero() {
		t.Fatal("в групповом чате токен не должен гаситься")
	}
}

func TestRowLink(t *testing.T) {
	const app = "https://gp.su10.ru"
	cases := []struct {
		name   string
		appURL string
		it     repository.NotificationPayloadItem
		want   string
	}{
		{"строка расчёта", app, repository.NotificationPayloadItem{PositionID: "p1", EntityType: "boq_item", EntityID: "i1"},
			app + "/positions/p1/items?itemId=i1&positionId=p1&tenderId=t1"},
		{"позиция", app, repository.NotificationPayloadItem{PositionID: "p1", EntityType: "client_position", EntityID: "p1"},
			app + "/positions/p1/items?positionId=p1&tenderId=t1"},
		{"материал без позиции", app, repository.NotificationPayloadItem{EntityType: "material_name", EntityID: "m1"}, ""},
		{"пустой адрес портала", "", repository.NotificationPayloadItem{PositionID: "p1", EntityType: "boq_item", EntityID: "i1"}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := rowLink(tc.appURL, "t1", tc.it); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestVerificationBotClaim(t *testing.T) {
	payload := &repository.NotificationPayload{
		TenderID: "t", ChatID: 5, TenderTitle: "ЖК",
		Items: []repository.NotificationPayloadItem{{
			ItemID: itemID, RuleCode: "Q", Detail: "нулевая цена", Position: "5.2",
			PositionID: "p1", EntityType: "boq_item", EntityID: "i1",
		}},
	}
	cases := []struct {
		name    string
		payload *repository.NotificationPayload
		payErr  error
		status  string
		sent    bool
	}{
		{"к отправке", payload, nil, "", true},
		{"адресат отвязался", &repository.NotificationPayload{Items: payload.Items}, nil, "skipped", false},
		{"всё исправлено", &repository.NotificationPayload{ChatID: 5}, nil, "skipped", false},
		{"содержимое не прочитано", nil, errors.New("db"), "retry", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, l, o, _ := newTestBot("u1", nil)
			o.payload, o.payErr = tc.payload, tc.payErr
			o.claimed = []repository.PendingNotification{{ID: "n", Attempts: 1}}
			msgs, err := b.Claim(context.Background(), "@Hub_Bot1", 0)
			if err != nil {
				t.Fatal(err)
			}
			if msgs == nil || (len(msgs) == 1) != tc.sent || o.status != tc.status || l.touched != "Hub_Bot1" {
				t.Fatalf("msgs=%+v status=%q touched=%q", msgs, o.status, l.touched)
			}
			if tc.sent {
				m := msgs[0]
				if m.ID != "n" || m.ChatID != 5 || m.Message.ParseMode != "HTML" || m.Message.ReplyMarkup == nil ||
					!strings.Contains(m.Message.Text, "ЖК") {
					t.Fatalf("сообщение: %+v", m)
				}
				const wantLink = `<a href="https://gp.su10.ru/positions/p1/items?itemId=i1&amp;positionId=p1&amp;tenderId=t">Позиция 5.2</a>`
				if !strings.Contains(m.Message.Text, wantLink) {
					t.Fatalf("нет ссылки на строку: %s", m.Message.Text)
				}
				if m.Message.LinkPreview == nil || !m.Message.LinkPreview.IsDisabled {
					t.Fatalf("превью ссылок не отключено: %+v", m.Message.LinkPreview)
				}
				for _, row := range m.Message.ReplyMarkup.InlineKeyboard {
					for _, btn := range row {
						if btn.URL != "" {
							t.Fatalf("у кнопки не должно быть URL: %+v", btn)
						}
					}
				}
			}
		})
	}

	t.Run("пустая очередь — не nil", func(t *testing.T) {
		b, _, _, _ := newTestBot("u1", nil)
		if msgs, err := b.Claim(context.Background(), "hub_bot", 10); err != nil || msgs == nil || len(msgs) != 0 {
			t.Fatalf("%+v %v", msgs, err)
		}
	})
	for _, bad := range []string{"", "abc", "has space", "bot-name", "@", strings.Repeat("a", 33), "бот_бот"} {
		t.Run("имя "+bad, func(t *testing.T) {
			b, l, _, _ := newTestBot("u1", nil)
			if _, err := b.Claim(context.Background(), bad, 10); !errors.Is(err, ErrBotUsernameInvalid) {
				t.Fatalf("err = %v", err)
			}
			if l.touched != "" {
				t.Fatal("бот с плохим именем отмечен в сети")
			}
		})
	}
}

func TestVerificationBotReportResult(t *testing.T) {
	cases := []struct {
		name     string
		state    string
		attempts int
		res      SendResult
		want     string // возвращаемый статус
		status   string // что записано в очередь
		delay    time.Duration
		reason   string
	}{
		{"доставлено", "pending", 1, SendResult{OK: true, MessageID: 7}, "sent", "sent", 0, ""},
		{"бот заблокирован", "pending", 1, SendResult{ErrorCode: 403, Description: "Forbidden: bot was blocked"}, "failed", "failed", 0, "telegram 403: Forbidden"},
		{"чат не найден", "pending", 1, SendResult{ErrorCode: 400, Description: "chat not found"}, "failed", "failed", 0, "telegram 400"},
		{"лимит Telegram", "pending", 1, SendResult{ErrorCode: 429, Description: "Too Many Requests", RetryAfter: 17}, "pending", "retry", 17 * time.Second, "telegram 429"},
		{"сеть — повтор", "pending", 2, SendResult{Description: "timeout"}, "pending", "retry", 4 * time.Minute, "сеть: timeout"},
		{"сеть — задержка растёт", "pending", 4, SendResult{Description: "timeout"}, "pending", "retry", 16 * time.Minute, "сеть"},
		{"попытки кончились", "pending", repository.MaxNotificationAttempts, SendResult{Description: "timeout"}, "failed", "failed", 0, "сеть"},
		{"уже отправлено", "sent", 1, SendResult{ErrorCode: 403}, "sent", "", 0, ""},
		{"уже закрыто", "failed", 1, SendResult{OK: true}, "failed", "", 0, ""},
		{"пропущено", "skipped", 1, SendResult{OK: true}, "skipped", "", 0, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, _, o, _ := newTestBot("u1", nil)
			o.state, o.attempts = tc.state, tc.attempts
			got, err := b.ReportResult(context.Background(), "n", tc.res)
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want || o.status != tc.status || o.delay != tc.delay || !strings.HasPrefix(o.reason, tc.reason) {
				t.Fatalf("статус %q, очередь %q, задержка %v, причина %q", got, o.status, o.delay, o.reason)
			}
			if tc.res.OK && tc.state == "pending" && o.sentID != 7 {
				t.Fatalf("message_id не сохранён: %d", o.sentID)
			}
		})
	}

	t.Run("нет сообщения", func(t *testing.T) {
		b, _, _, _ := newTestBot("u1", nil)
		if _, err := b.ReportResult(context.Background(), "n", SendResult{OK: true}); !errors.Is(err, repository.ErrNotificationNotFound) {
			t.Fatalf("err = %v", err)
		}
	})
	t.Run("описание обрезается", func(t *testing.T) {
		b, _, o, _ := newTestBot("u1", nil)
		o.state, o.attempts = "pending", 1
		if _, err := b.ReportResult(context.Background(), "n", SendResult{ErrorCode: 500, Description: strings.Repeat("я", 1000)}); err != nil {
			t.Fatal(err)
		}
		if n := len([]rune(o.reason)); n != len("telegram 500: ")+300 {
			t.Fatalf("длина причины %d", n)
		}
	})
}
