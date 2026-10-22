package services

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

type telegramBotRepo interface {
	ConsumeLinkToken(ctx context.Context, token string, chatID int64, username string, at time.Time) (string, error)
	UnlinkChat(ctx context.Context, chatID int64) (bool, error)
	UserByChat(ctx context.Context, chatID int64) (string, error)
	TouchBot(ctx context.Context, username string) error
}

type botOutboxRepo interface {
	ClaimPending(ctx context.Context, limit int, lease time.Duration) ([]repository.PendingNotification, error)
	LoadPayload(ctx context.Context, notificationID string) (*repository.NotificationPayload, error)
	NotificationState(ctx context.Context, id string) (string, int, error)
	MarkSent(ctx context.Context, id string, messageID int64) error
	MarkClosed(ctx context.Context, id, status, reason string) error
	MarkRetry(ctx context.Context, id, reason string, delay time.Duration) error
	GetCallbackItem(ctx context.Context, itemID string) (*repository.CallbackItem, error)
	SetItemVerdict(ctx context.Context, itemID, verdict string) error
}

type verdictSetter interface {
	SetVerdictFrom(ctx context.Context, source, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
}

// ErrBotUsernameInvalid — имя бота в claim не похоже на имя Telegram-бота.
var ErrBotUsernameInvalid = errors.New("verification bot: имя бота некорректно")

var botUsernameRe = regexp.MustCompile(`^[A-Za-z0-9_]{5,32}$`)

const (
	botClaimLease        = 2 * time.Minute
	botClaimDefaultLimit = 20
	botClaimMaxLimit     = 50
	botResultReasonRunes = 300
	// botStartMaxAge — как давно нажатый Start ещё засчитывается: токен живёт
	// 15 минут, но бот на выключенном ПК может обработать обновление позже;
	// Telegram хранит необработанные обновления сутки.
	botStartMaxAge = 24 * time.Hour
)

// VerificationBotService — серверная часть бота рассылки замечаний «Проверки
// данных». Сам бот — внешняя программа на офисном ПК: опрашивает Telegram,
// пересылает обновления в HandleUpdate, забирает очередь через Claim и
// сообщает итог отправки в ReportResult. Сети здесь нет — только БД и
// формирование ответов.
type VerificationBotService struct {
	links   telegramBotRepo
	outbox  botOutboxRepo
	verdict verdictSetter
	appURL  string
	logger  zerolog.Logger
	now     func() time.Time
}

func NewVerificationBotService(links telegramBotRepo, outbox botOutboxRepo, verdict verdictSetter,
	appURL string, logger zerolog.Logger) *VerificationBotService {
	return &VerificationBotService{links: links, outbox: outbox, verdict: verdict, appURL: appURL, logger: logger, now: time.Now}
}

// BotAction — что боту сделать в ответ на обновление.
type BotAction struct {
	Method          string                   `json:"method"` // "sendMessage" | "answerCallbackQuery"
	ChatID          int64                    `json:"chat_id,omitempty"`
	Message         *telegram.MessagePayload `json:"message,omitempty"`
	CallbackQueryID string                   `json:"callback_query_id,omitempty"`
	Text            string                   `json:"text,omitempty"`
}

// BotOutMessage — сообщение из очереди, которое боту пора отправить.
type BotOutMessage struct {
	ID      string                  `json:"id"`
	ChatID  int64                   `json:"chat_id"`
	Message telegram.MessagePayload `json:"message"`
}

// SendResult — итог отправки сообщения, как его видит бот.
type SendResult struct {
	OK          bool   `json:"ok"`
	MessageID   int64  `json:"message_id"`
	ErrorCode   int    `json:"error_code"` // код Telegram; 0 — сеть
	Description string `json:"description"`
	RetryAfter  int    `json:"retry_after"` // секунды, из parameters.retry_after
}

func replyAction(chatID int64, text string) BotAction {
	m := telegram.Payload(text, nil)
	return BotAction{Method: "sendMessage", ChatID: chatID, Message: &m}
}

func answerAction(callbackID, text string) BotAction {
	return BotAction{Method: "answerCallbackQuery", CallbackQueryID: callbackID, Text: text}
}

// HandleUpdate разбирает входящее обновление (привязка, /stop, кнопки вердикта)
// и возвращает действия для бота. Ошибка — внутренняя (БД): бот повторит то же
// обновление.
func (s *VerificationBotService) HandleUpdate(ctx context.Context, u telegram.Update) ([]BotAction, error) {
	switch {
	case u.CallbackQuery != nil:
		return s.handleCallback(ctx, u.CallbackQuery)
	case u.Message != nil && u.Message.Chat.Type == "private":
		return s.handleMessage(ctx, u.Message)
	}
	return []BotAction{}, nil
}

// startTime — момент нажатия Start для проверки срока токена: время сообщения,
// но не из будущего и не старше суток.
func (s *VerificationBotService) startTime(m *telegram.Message) time.Time {
	now := s.now()
	if m.Date == 0 {
		return now
	}
	at := time.Unix(m.Date, 0)
	if at.After(now) {
		return now
	}
	if oldest := now.Add(-botStartMaxAge); at.Before(oldest) {
		return oldest
	}
	return at
}

func (s *VerificationBotService) handleMessage(ctx context.Context, m *telegram.Message) ([]BotAction, error) {
	chat := m.Chat.ID
	if telegram.IsStop(m.Text) {
		ok, err := s.links.UnlinkChat(ctx, chat)
		if err != nil {
			return nil, fmt.Errorf("verificationBot: отвязка: %w", err)
		}
		if !ok {
			return []BotAction{}, nil
		}
		return []BotAction{replyAction(chat, "Уведомления TenderHUB отключены. Чтобы вернуть — привяжите Telegram заново в меню профиля.")}, nil
	}
	token, isStart := telegram.ParseStart(m.Text)
	if !isStart {
		return []BotAction{replyAction(chat, "Здесь приходят замечания проверки расчёта TenderHUB. Отвечать на них — кнопками под сообщением.")}, nil
	}
	if token == "" {
		return []BotAction{replyAction(chat, "Чтобы получать замечания, откройте TenderHUB → меню профиля → «Telegram» и нажмите «Привязать».")}, nil
	}
	username := ""
	if m.From != nil {
		username = m.From.Username
	}
	name, err := s.links.ConsumeLinkToken(ctx, token, chat, username, s.startTime(m))
	switch {
	case errors.Is(err, repository.ErrTelegramTokenInvalid):
		return []BotAction{replyAction(chat, "Ссылка устарела или уже использована. Получите новую в TenderHUB: меню профиля → «Telegram».")}, nil
	case err != nil:
		return nil, fmt.Errorf("verificationBot: привязка: %w", err)
	}
	greeting := "Готово"
	if name != "" {
		greeting += ", " + telegramEscape(name)
	}
	return []BotAction{replyAction(chat, greeting+". Сюда будут приходить замечания проверки расчёта. Отключить — команда /stop.")}, nil
}

func (s *VerificationBotService) handleCallback(ctx context.Context, q *telegram.CallbackQuery) ([]BotAction, error) {
	answer := func(text string) ([]BotAction, error) { return []BotAction{answerAction(q.ID, text)}, nil }
	action, itemID, ok := telegram.ParseCallback(q.Data)
	if !ok || q.Message == nil {
		return answer("Кнопка устарела")
	}
	userID, err := s.links.UserByChat(ctx, q.Message.Chat.ID)
	if err != nil {
		return nil, fmt.Errorf("verificationBot: пользователь чата: %w", err)
	}
	if userID == "" {
		return answer("Telegram не привязан к TenderHUB")
	}
	item, err := s.outbox.GetCallbackItem(ctx, itemID)
	if errors.Is(err, repository.ErrCallbackItemNotFound) {
		return answer("Замечание больше не существует")
	}
	if err != nil {
		return nil, fmt.Errorf("verificationBot: элемент рассылки: %w", err)
	}
	switch {
	case item.RecipientUserID != userID:
		return answer("Это замечание адресовано другому пользователю")
	case item.Resolved:
		return answer("Уже исправлено — проверка это замечание больше не находит")
	case item.CurrentFingerprint != item.SentFingerprint:
		return answer("Строка изменилась после уведомления — посмотрите в TenderHUB")
	}
	verdict := "accepted"
	if action == telegram.ActionError {
		verdict = "error"
	}
	if err := s.verdict.SetVerdictFrom(ctx, "telegram", item.TenderID, item.RuleCode, item.EntityID,
		item.CurrentFingerprint, verdict, nil, &userID); err != nil {
		return nil, fmt.Errorf("verificationBot: вердикт: %w", err)
	}
	if err := s.outbox.SetItemVerdict(ctx, itemID, verdict); err != nil {
		s.logger.Warn().Err(err).Msg("telegram: вердикт элемента рассылки")
	}
	if verdict == "accepted" {
		return answer("Отмечено: норма")
	}
	return answer("Отмечено: ошибка, к исправлению")
}

// Claim отмечает, что бот в сети, и отдаёт сообщения очереди, которым пора
// уйти. Сообщение берётся в аренду на 2 минуты: итог бот присылает в
// ReportResult, не прислал — сообщение вернётся в очередь.
func (s *VerificationBotService) Claim(ctx context.Context, botUsername string, limit int) ([]BotOutMessage, error) {
	name := strings.TrimPrefix(strings.TrimSpace(botUsername), "@")
	if !botUsernameRe.MatchString(name) {
		return nil, ErrBotUsernameInvalid
	}
	switch {
	case limit <= 0:
		limit = botClaimDefaultLimit
	case limit > botClaimMaxLimit:
		limit = botClaimMaxLimit
	}
	if err := s.links.TouchBot(ctx, name); err != nil {
		return nil, err
	}
	claimed, err := s.outbox.ClaimPending(ctx, limit, botClaimLease)
	if err != nil {
		return nil, err
	}
	out := make([]BotOutMessage, 0, len(claimed))
	for _, n := range claimed {
		if m, ok := s.prepare(ctx, n); ok {
			out = append(out, m)
		}
	}
	return out, nil
}

// prepare собирает сообщение; false — отправлять нечего (закрыто или отложено).
func (s *VerificationBotService) prepare(ctx context.Context, n repository.PendingNotification) (BotOutMessage, bool) {
	logErr := func(err error) {
		if err != nil {
			s.logger.Warn().Err(err).Str("notification_id", n.ID).Msg("telegram: статус сообщения не сохранён")
		}
	}
	p, err := s.outbox.LoadPayload(ctx, n.ID)
	if err != nil {
		s.logger.Warn().Err(err).Str("notification_id", n.ID).Msg("telegram: содержимое сообщения не прочитано")
		logErr(s.outbox.MarkRetry(ctx, n.ID, "payload: "+err.Error(), time.Minute))
		return BotOutMessage{}, false
	}
	if p.ChatID == 0 {
		logErr(s.outbox.MarkClosed(ctx, n.ID, "skipped", "адресат отвязал Telegram"))
		return BotOutMessage{}, false
	}
	if len(p.Items) == 0 {
		logErr(s.outbox.MarkClosed(ctx, n.ID, "skipped", "все находки уже исправлены или изменились"))
		return BotOutMessage{}, false
	}
	notice := telegram.Notice{TenderTitle: p.TenderTitle, SenderName: p.SenderName}
	if s.appURL != "" {
		notice.Link = s.appURL + "/data-quality?tenderId=" + p.TenderID
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
	return BotOutMessage{ID: n.ID, ChatID: p.ChatID, Message: telegram.Payload(text, keyboard)}, true
}

// ReportResult применяет итог отправки: доставлено, закрыто навсегда или
// повтор позже. Возвращает статус сообщения после применения. Повторный итог
// по уже закрытому сообщению ничего не меняет и возвращает его статус.
func (s *VerificationBotService) ReportResult(ctx context.Context, id string, r SendResult) (string, error) {
	status, attempts, err := s.outbox.NotificationState(ctx, id)
	if err != nil {
		return "", err
	}
	if status != "pending" {
		return status, nil
	}
	if r.OK {
		if err := s.outbox.MarkSent(ctx, id, r.MessageID); err != nil {
			return "", err
		}
		return "sent", nil
	}
	reason := sendFailureReason(r)
	if r.ErrorCode == 400 || r.ErrorCode == 403 || attempts >= repository.MaxNotificationAttempts {
		if err := s.outbox.MarkClosed(ctx, id, "failed", reason); err != nil {
			return "", err
		}
		return "failed", nil
	}
	delay := time.Duration(1<<min(attempts, 6)) * time.Minute
	if r.RetryAfter > 0 {
		delay = time.Duration(r.RetryAfter) * time.Second
	}
	if err := s.outbox.MarkRetry(ctx, id, reason, delay); err != nil {
		return "", err
	}
	return "pending", nil
}

func sendFailureReason(r SendResult) string {
	desc := []rune(r.Description)
	if len(desc) > botResultReasonRunes {
		desc = desc[:botResultReasonRunes]
	}
	if r.ErrorCode == 0 {
		return "сеть: " + string(desc)
	}
	return fmt.Sprintf("telegram %d: %s", r.ErrorCode, string(desc))
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
