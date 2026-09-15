package services

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"time"

	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ErrTelegramDisabled — бот не настроен (нет TELEGRAM_BOT_TOKEN / USERNAME).
var ErrTelegramDisabled = errors.New("telegram: бот не настроен")

const telegramLinkTTL = 15 * time.Minute

type telegramLinkRepo interface {
	GetLink(ctx context.Context, userID string) (*repository.TelegramLink, error)
	CreateLinkToken(ctx context.Context, userID, token string, ttl time.Duration) (time.Time, error)
	Unlink(ctx context.Context, userID string) error
}

// TelegramLinkService — привязка аккаунта к личному чату с ботом.
type TelegramLinkService struct {
	repo telegramLinkRepo
	cfg  telegram.Config
}

func NewTelegramLinkService(repo telegramLinkRepo, cfg telegram.Config) *TelegramLinkService {
	return &TelegramLinkService{repo: repo, cfg: cfg}
}

// TelegramStatus — состояние привязки для интерфейса.
type TelegramStatus struct {
	Enabled          bool       `json:"enabled"`
	BotUsername      string     `json:"bot_username,omitempty"`
	Linked           bool       `json:"linked"`
	TelegramUsername *string    `json:"telegram_username"`
	LinkedAt         *time.Time `json:"linked_at"`
}

func (s *TelegramLinkService) Status(ctx context.Context, userID string) (*TelegramStatus, error) {
	st := &TelegramStatus{Enabled: s.cfg.Enabled()}
	if !st.Enabled {
		return st, nil
	}
	st.BotUsername = s.cfg.BotUsername
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
	if !s.cfg.Enabled() {
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
		DeepLink:  "https://t.me/" + s.cfg.BotUsername + "?start=" + token,
		ExpiresAt: expires,
	}, nil
}

func (s *TelegramLinkService) Unlink(ctx context.Context, userID string) error {
	return s.repo.Unlink(ctx, userID)
}
