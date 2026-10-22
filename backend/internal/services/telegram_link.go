package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/su10/hubtender/backend/internal/repository"
)

// ErrTelegramDisabled — бот не подключён: внешний бот ещё ни разу не обращался
// к API, имя бота неизвестно.
var ErrTelegramDisabled = errors.New("telegram: бот не подключён")

const (
	telegramLinkTTL = 15 * time.Minute
	// telegramBotOnlineWindow — «бот в сети», если claim был не позже.
	telegramBotOnlineWindow = 90 * time.Second
)

// telegramBotStater — состояние внешнего бота (имя и время последнего вызова).
type telegramBotStater interface {
	BotState(ctx context.Context) (*repository.TelegramBotState, error)
}

type telegramLinkRepo interface {
	GetLink(ctx context.Context, userID string) (*repository.TelegramLink, error)
	CreateLinkToken(ctx context.Context, userID, token string, ttl time.Duration) (time.Time, error)
	Unlink(ctx context.Context, userID string) error
}

// TelegramLinkService — привязка аккаунта к личному чату с ботом.
type TelegramLinkService struct {
	repo telegramLinkRepo
	bot  telegramBotStater
	now  func() time.Time
}

// NewTelegramLinkService — repo обслуживает и привязки, и состояние бота
// (repository.TelegramRepo).
func NewTelegramLinkService(repo interface {
	telegramLinkRepo
	telegramBotStater
}) *TelegramLinkService {
	return &TelegramLinkService{repo: repo, bot: repo, now: time.Now}
}

// TelegramStatus — состояние привязки для интерфейса.
type TelegramStatus struct {
	Enabled          bool       `json:"enabled"`
	BotUsername      string     `json:"bot_username,omitempty"`
	BotOnline        bool       `json:"bot_online"`
	BotLastSeenAt    *time.Time `json:"bot_last_seen_at"`
	Linked           bool       `json:"linked"`
	TelegramUsername *string    `json:"telegram_username"`
	LinkedAt         *time.Time `json:"linked_at"`
}

func (s *TelegramLinkService) Status(ctx context.Context, userID string) (*TelegramStatus, error) {
	bot, err := s.bot.BotState(ctx)
	if err != nil {
		return nil, err
	}
	st := &TelegramStatus{Enabled: bot.Username != ""}
	if !st.Enabled {
		return st, nil
	}
	st.BotUsername = bot.Username
	st.BotLastSeenAt = bot.LastSeenAt
	st.BotOnline = bot.LastSeenAt != nil && s.now().Sub(*bot.LastSeenAt) < telegramBotOnlineWindow
	link, err := s.repo.GetLink(ctx, userID)
	if err != nil {
		return nil, err
	}
	if link != nil {
		st.Linked, st.TelegramUsername, st.LinkedAt = true, link.Username, &link.LinkedAt
	}
	return st, nil
}

// TelegramLinkToken — одноразовая ссылка на бота.
type TelegramLinkToken struct {
	DeepLink  string    `json:"deep_link"`
	ExpiresAt time.Time `json:"expires_at"`
}

// CreateLink выпускает одноразовый токен. Привязка — только через /start с этим
// токеном в личном чате: сопоставление по e-mail или username подделывается.
func (s *TelegramLinkService) CreateLink(ctx context.Context, userID string) (*TelegramLinkToken, error) {
	bot, err := s.bot.BotState(ctx)
	if err != nil {
		return nil, err
	}
	if bot.Username == "" {
		return nil, ErrTelegramDisabled
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	// base64url без паддинга: допустимые для /start символы, 32 знака при лимите 64.
	token := base64.RawURLEncoding.EncodeToString(raw)
	expires, err := s.repo.CreateLinkToken(ctx, userID, token, telegramLinkTTL)
	if err != nil {
		return nil, err
	}
	return &TelegramLinkToken{
		DeepLink:  "https://t.me/" + bot.Username + "?start=" + token,
		ExpiresAt: expires,
	}, nil
}

func (s *TelegramLinkService) Unlink(ctx context.Context, userID string) error {
	return s.repo.Unlink(ctx, userID)
}
