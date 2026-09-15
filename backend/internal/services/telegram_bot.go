package services

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

type telegramBotRepo interface {
	ConsumeLinkToken(ctx context.Context, token string, chatID int64, username string) (string, error)
	UnlinkChat(ctx context.Context, chatID int64) (bool, error)
	UserByChat(ctx context.Context, chatID int64) (string, error)
	GetOffset(ctx context.Context) (int64, error)
	SetOffset(ctx context.Context, offset int64) error
}

type botOutboxRepo interface {
	ClaimPending(ctx context.Context, limit int, lease time.Duration) ([]repository.PendingNotification, error)
	LoadPayload(ctx context.Context, notificationID string) (*repository.NotificationPayload, error)
	MarkSent(ctx context.Context, id string, messageID int64) error
	MarkClosed(ctx context.Context, id, status, reason string) error
	MarkRetry(ctx context.Context, id, reason string, delay time.Duration) error
	GetCallbackItem(ctx context.Context, itemID string) (*repository.CallbackItem, error)
	SetItemVerdict(ctx context.Context, itemID, verdict string) error
}

type botClient interface {
	GetUpdates(ctx context.Context, offset int64, timeout int) ([]telegram.Update, error)
	SendMessage(ctx context.Context, chatID int64, html string, keyboard [][]telegram.InlineButton) (int64, error)
	AnswerCallback(ctx context.Context, callbackID, text string) error
}

type verdictSetter interface {
	SetVerdictFrom(ctx context.Context, source, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
}

// TelegramBot — long polling входящих (привязка, /stop, кнопки вердикта) и
// отправка сообщений из очереди. Работает только в одном экземпляре бэкенда:
// второй получит от getUpdates 409 и будет ждать.
type TelegramBot struct {
	client  botClient
	links   telegramBotRepo
	outbox  botOutboxRepo
	verdict verdictSetter
	appURL  string
	logger  zerolog.Logger
}

func NewTelegramBot(client botClient, links telegramBotRepo, outbox botOutboxRepo, verdict verdictSetter,
	cfg telegram.Config, logger zerolog.Logger) *TelegramBot {
	return &TelegramBot{client: client, links: links, outbox: outbox, verdict: verdict, appURL: cfg.AppBaseURL, logger: logger}
}

const (
	pollTimeoutSeconds = 25
	senderInterval     = 5 * time.Second
	senderBatch        = 20
	sendLease          = 2 * time.Minute
)

func sleepCtx(ctx context.Context, d time.Duration) bool {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-t.C:
		return true
	}
}

// RunPoller блокирует до отмены ctx.
func (b *TelegramBot) RunPoller(ctx context.Context) {
	b.logger.Info().Msg("telegram bot poller started")
	backoff := time.Second
	for ctx.Err() == nil {
		offset, err := b.links.GetOffset(ctx)
		if err != nil {
			b.logger.Warn().Err(err).Msg("telegram: offset не прочитан")
			if !sleepCtx(ctx, 30*time.Second) {
				return
			}
			continue
		}
		updates, err := b.client.GetUpdates(ctx, offset, pollTimeoutSeconds)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			var apiErr *telegram.APIError
			if errors.As(err, &apiErr) && apiErr.Code == 409 {
				b.logger.Warn().Msg("telegram: getUpdates 409 — бот опрашивает другой экземпляр или задан webhook")
				backoff = 30 * time.Second
			} else {
				b.logger.Warn().Err(err).Msg("telegram: getUpdates")
			}
			if !sleepCtx(ctx, backoff) {
				return
			}
			backoff = min(backoff*2, time.Minute)
			continue
		}
		backoff = time.Second
		for _, u := range updates {
			b.handleUpdate(ctx, u)
			if err := b.links.SetOffset(ctx, u.UpdateID+1); err != nil {
				b.logger.Warn().Err(err).Msg("telegram: offset не сохранён")
			}
		}
	}
}

func (b *TelegramBot) reply(ctx context.Context, chatID int64, text string) {
	if _, err := b.client.SendMessage(ctx, chatID, text, nil); err != nil {
		b.logger.Warn().Err(err).Msg("telegram: ответ не отправлен")
	}
}

func (b *TelegramBot) handleUpdate(ctx context.Context, u telegram.Update) {
	switch {
	case u.CallbackQuery != nil:
		b.handleCallback(ctx, u.CallbackQuery)
	case u.Message != nil && u.Message.Chat.Type == "private":
		b.handleMessage(ctx, u.Message)
	}
}

func (b *TelegramBot) handleMessage(ctx context.Context, m *telegram.Message) {
	chat := m.Chat.ID
	if telegram.IsStop(m.Text) {
		if ok, err := b.links.UnlinkChat(ctx, chat); err != nil {
			b.logger.Warn().Err(err).Msg("telegram: отвязка")
		} else if ok {
			b.reply(ctx, chat, "Уведомления TenderHUB отключены. Чтобы вернуть — привяжите Telegram заново в меню профиля.")
		}
		return
	}
	token, isStart := telegram.ParseStart(m.Text)
	if !isStart {
		b.reply(ctx, chat, "Здесь приходят замечания проверки расчёта TenderHUB. Отвечать на них — кнопками под сообщением.")
		return
	}
	if token == "" {
		b.reply(ctx, chat, "Чтобы получать замечания, откройте TenderHUB → меню профиля → «Telegram» и нажмите «Привязать».")
		return
	}
	username := ""
	if m.From != nil {
		username = m.From.Username
	}
	name, err := b.links.ConsumeLinkToken(ctx, token, chat, username)
	switch {
	case errors.Is(err, repository.ErrTelegramTokenInvalid):
		b.reply(ctx, chat, "Ссылка устарела или уже использована. Получите новую в TenderHUB: меню профиля → «Telegram».")
	case err != nil:
		b.logger.Warn().Err(err).Msg("telegram: привязка")
		b.reply(ctx, chat, "Не удалось привязать аккаунт, попробуйте позже.")
	default:
		greeting := "Готово"
		if name != "" {
			greeting += ", " + telegramEscape(name)
		}
		b.reply(ctx, chat, greeting+". Сюда будут приходить замечания проверки расчёта. Отключить — команда /stop.")
	}
}

func (b *TelegramBot) handleCallback(ctx context.Context, q *telegram.CallbackQuery) {
	answer := func(text string) {
		if err := b.client.AnswerCallback(ctx, q.ID, text); err != nil {
			b.logger.Warn().Err(err).Msg("telegram: answerCallbackQuery")
		}
	}
	action, itemID, ok := telegram.ParseCallback(q.Data)
	if !ok || q.Message == nil {
		answer("Кнопка устарела")
		return
	}
	userID, err := b.links.UserByChat(ctx, q.Message.Chat.ID)
	if err != nil || userID == "" {
		answer("Telegram не привязан к TenderHUB")
		return
	}
	item, err := b.outbox.GetCallbackItem(ctx, itemID)
	if err != nil {
		answer("Замечание больше не существует")
		return
	}
	switch {
	case item.RecipientUserID != userID:
		answer("Это замечание адресовано другому пользователю")
		return
	case item.Resolved:
		answer("Уже исправлено — проверка это замечание больше не находит")
		return
	case item.CurrentFingerprint != item.SentFingerprint:
		answer("Строка изменилась после уведомления — посмотрите в TenderHUB")
		return
	}
	verdict := "accepted"
	if action == telegram.ActionError {
		verdict = "error"
	}
	if err := b.verdict.SetVerdictFrom(ctx, "telegram", item.TenderID, item.RuleCode, item.EntityID,
		item.CurrentFingerprint, verdict, nil, &userID); err != nil {
		b.logger.Warn().Err(err).Msg("telegram: вердикт не сохранён")
		answer("Не удалось сохранить, попробуйте позже")
		return
	}
	if err := b.outbox.SetItemVerdict(ctx, itemID, verdict); err != nil {
		b.logger.Warn().Err(err).Msg("telegram: вердикт элемента рассылки")
	}
	if verdict == "accepted" {
		answer("Отмечено: норма")
	} else {
		answer("Отмечено: ошибка, к исправлению")
	}
}

// RunSender отправляет сообщения из очереди, блокирует до отмены ctx.
func (b *TelegramBot) RunSender(ctx context.Context) {
	ticker := time.NewTicker(senderInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			b.SendPending(ctx)
		}
	}
}

// SendPending — один проход очереди.
func (b *TelegramBot) SendPending(ctx context.Context) {
	claimed, err := b.outbox.ClaimPending(ctx, senderBatch, sendLease)
	if err != nil {
		if ctx.Err() == nil {
			b.logger.Warn().Err(err).Msg("telegram: очередь не прочитана")
		}
		return
	}
	for _, n := range claimed {
		b.sendOne(ctx, n)
	}
}

func (b *TelegramBot) sendOne(ctx context.Context, n repository.PendingNotification) {
	logErr := func(err error) {
		if err != nil {
			b.logger.Warn().Err(err).Str("notification_id", n.ID).Msg("telegram: статус сообщения не сохранён")
		}
	}
	p, err := b.outbox.LoadPayload(ctx, n.ID)
	if err != nil {
		logErr(b.outbox.MarkRetry(ctx, n.ID, "payload: "+err.Error(), time.Minute))
		return
	}
	if p.ChatID == 0 {
		logErr(b.outbox.MarkClosed(ctx, n.ID, "skipped", "адресат отвязал Telegram"))
		return
	}
	if len(p.Items) == 0 {
		logErr(b.outbox.MarkClosed(ctx, n.ID, "skipped", "все находки уже исправлены или изменились"))
		return
	}
	notice := telegram.Notice{TenderTitle: p.TenderTitle, SenderName: p.SenderName}
	if b.appURL != "" {
		notice.Link = b.appURL + "/data-quality?tenderId=" + p.TenderID
	}
	for _, it := range p.Items {
		title := ""
		if r, ok := quality.ByCode(it.RuleCode); ok {
			title = r.Title
		}
		notice.Items = append(notice.Items, telegram.NoticeItem{
			ItemID: it.ItemID, RuleCode: it.RuleCode, RuleTitle: title, Position: it.Position, Detail: it.Detail,
		})
	}
	text, keyboard := telegram.RenderNotice(notice)
	msgID, err := b.client.SendMessage(ctx, p.ChatID, text, keyboard)
	if err == nil {
		logErr(b.outbox.MarkSent(ctx, n.ID, msgID))
		return
	}
	if ctx.Err() != nil {
		return
	}
	var apiErr *telegram.APIError
	switch {
	case errors.As(err, &apiErr) && apiErr.Permanent():
		logErr(b.outbox.MarkClosed(ctx, n.ID, "failed", err.Error()))
	case n.Attempts >= repository.MaxNotificationAttempts:
		logErr(b.outbox.MarkClosed(ctx, n.ID, "failed", err.Error()))
	default:
		delay := time.Duration(1<<min(n.Attempts, 6)) * time.Minute
		if errors.As(err, &apiErr) && apiErr.RetryAfter > 0 {
			delay = time.Duration(apiErr.RetryAfter) * time.Second
		}
		logErr(b.outbox.MarkRetry(ctx, n.ID, err.Error(), delay))
	}
}

// telegramEscape — экранирование для HTML parse_mode в коротких ответах.
func telegramEscape(s string) string {
	out := make([]rune, 0, len(s))
	for _, r := range s {
		switch r {
		case '<', '>', '&':
			out = append(out, ' ')
		default:
			out = append(out, r)
		}
	}
	return string(out)
}
