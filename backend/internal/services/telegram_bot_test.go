package services

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeBotClient struct {
	answers []string
	sent    []string
	sendErr error
}

func (c *fakeBotClient) GetUpdates(context.Context, int64, int) ([]telegram.Update, error) {
	return nil, nil
}
func (c *fakeBotClient) SendMessage(_ context.Context, _ int64, html string, _ [][]telegram.InlineButton) (int64, error) {
	if c.sendErr != nil {
		return 0, c.sendErr
	}
	c.sent = append(c.sent, html)
	return 7, nil
}
func (c *fakeBotClient) AnswerCallback(_ context.Context, _ string, text string) error {
	c.answers = append(c.answers, text)
	return nil
}

type fakeLinks struct{ user string }

func (l *fakeLinks) ConsumeLinkToken(context.Context, string, int64, string) (string, error) {
	return "", nil
}
func (l *fakeLinks) UnlinkChat(context.Context, int64) (bool, error)   { return true, nil }
func (l *fakeLinks) UserByChat(context.Context, int64) (string, error) { return l.user, nil }
func (l *fakeLinks) GetOffset(context.Context) (int64, error)          { return 0, nil }
func (l *fakeLinks) SetOffset(context.Context, int64) error            { return nil }

type fakeOutbox struct {
	item    *repository.CallbackItem
	payload *repository.NotificationPayload
	status  string
	verdict string
}

func (o *fakeOutbox) ClaimPending(context.Context, int, time.Duration) ([]repository.PendingNotification, error) {
	return nil, nil
}
func (o *fakeOutbox) LoadPayload(context.Context, string) (*repository.NotificationPayload, error) {
	return o.payload, nil
}
func (o *fakeOutbox) MarkSent(context.Context, string, int64) error { o.status = "sent"; return nil }
func (o *fakeOutbox) MarkClosed(_ context.Context, _, status, _ string) error {
	o.status = status
	return nil
}
func (o *fakeOutbox) MarkRetry(context.Context, string, string, time.Duration) error {
	o.status = "retry"
	return nil
}
func (o *fakeOutbox) GetCallbackItem(context.Context, string) (*repository.CallbackItem, error) {
	return o.item, nil
}
func (o *fakeOutbox) SetItemVerdict(_ context.Context, _, v string) error { o.verdict = v; return nil }

type fakeVerdicts struct{ source, verdict, actor string }

func (v *fakeVerdicts) SetVerdictFrom(_ context.Context, source, _, _, _, _, verdict string, _ *string, by *string) error {
	v.source, v.verdict, v.actor = source, verdict, *by
	return nil
}

const itemID = "0f8fad5b-d9cb-469f-a165-70867728950e"

func newTestBot(user string, item *repository.CallbackItem) (*TelegramBot, *fakeBotClient, *fakeOutbox, *fakeVerdicts) {
	c, o, v := &fakeBotClient{}, &fakeOutbox{item: item}, &fakeVerdicts{}
	return NewTelegramBot(c, &fakeLinks{user: user}, o, v, telegram.Config{}, zerolog.Nop()), c, o, v
}

func press(b *TelegramBot, data string) {
	b.handleCallback(context.Background(), &telegram.CallbackQuery{
		ID: "cb", Data: data, Message: &telegram.Message{Chat: telegram.Chat{ID: 1, Type: "private"}},
	})
}

func TestTelegramBotCallback(t *testing.T) {
	base := repository.CallbackItem{
		RecipientUserID: "u1", TenderID: "t", RuleCode: "Q", EntityID: "e",
		SentFingerprint: "fp", CurrentFingerprint: "fp",
	}
	cases := []struct {
		name    string
		user    string
		mutate  func(*repository.CallbackItem)
		data    string
		verdict string
		answer  string
	}{
		{"норма", "u1", nil, "a:" + itemID, "accepted", "норма"},
		{"ошибка", "u1", nil, "e:" + itemID, "error", "ошибка"},
		{"чужое замечание", "u2", nil, "a:" + itemID, "", "другому"},
		{"строка изменилась", "u1", func(i *repository.CallbackItem) { i.CurrentFingerprint = "new" }, "a:" + itemID, "", "изменилась"},
		{"уже исправлено", "u1", func(i *repository.CallbackItem) { i.Resolved = true }, "a:" + itemID, "", "исправлено"},
		{"чат не привязан", "", nil, "a:" + itemID, "", "не привязан"},
		{"битые данные", "u1", nil, "a:1", "", "устарела"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			item := base
			if tc.mutate != nil {
				tc.mutate(&item)
			}
			b, c, o, v := newTestBot(tc.user, &item)
			press(b, tc.data)
			if v.verdict != tc.verdict || o.verdict != tc.verdict {
				t.Fatalf("вердикт %q/%q, ожидался %q", v.verdict, o.verdict, tc.verdict)
			}
			if tc.verdict != "" && (v.source != "telegram" || v.actor != "u1") {
				t.Fatalf("источник/автор вердикта: %+v", v)
			}
			if len(c.answers) != 1 || !strings.Contains(c.answers[0], tc.answer) {
				t.Fatalf("ответ на кнопку: %v", c.answers)
			}
		})
	}
}

func TestTelegramBotSendOne(t *testing.T) {
	payload := &repository.NotificationPayload{
		TenderID: "t", ChatID: 5, TenderTitle: "ЖК",
		Items: []repository.NotificationPayloadItem{{ItemID: itemID, RuleCode: "Q", Detail: "нулевая цена"}},
	}
	cases := []struct {
		name     string
		payload  *repository.NotificationPayload
		err      error
		attempts int
		status   string
	}{
		{"доставлено", payload, nil, 1, "sent"},
		{"адресат отвязался", &repository.NotificationPayload{Items: payload.Items}, nil, 1, "skipped"},
		{"всё исправлено", &repository.NotificationPayload{ChatID: 5}, nil, 1, "skipped"},
		{"бот заблокирован", payload, &telegram.APIError{Code: 403}, 1, "failed"},
		{"сеть — повтор", payload, telegram.ErrTransport, 1, "retry"},
		{"сеть — попытки кончились", payload, telegram.ErrTransport, repository.MaxNotificationAttempts, "failed"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, c, o, _ := newTestBot("u1", nil)
			o.payload, c.sendErr = tc.payload, tc.err
			b.sendOne(context.Background(), repository.PendingNotification{ID: "n", Attempts: tc.attempts})
			if o.status != tc.status {
				t.Fatalf("статус %q, ожидался %q", o.status, tc.status)
			}
		})
	}
}
