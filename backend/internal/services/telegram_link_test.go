package services

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeLinkRepo struct{ state repository.TelegramBotState }

func (f *fakeLinkRepo) GetLink(context.Context, string) (*repository.TelegramLink, error) {
	return nil, nil
}
func (f *fakeLinkRepo) CreateLinkToken(_ context.Context, _, _ string, ttl time.Duration) (time.Time, error) {
	return botNow.Add(ttl), nil
}
func (f *fakeLinkRepo) Unlink(context.Context, string) error { return nil }
func (f *fakeLinkRepo) BotState(context.Context) (*repository.TelegramBotState, error) {
	return &f.state, nil
}

func TestTelegramLinkStatus(t *testing.T) {
	recent, stale := botNow.Add(-30*time.Second), botNow.Add(-5*time.Minute)
	cases := []struct {
		name    string
		state   repository.TelegramBotState
		enabled bool
		online  bool
	}{
		{"не подключён", repository.TelegramBotState{}, false, false},
		{"в сети", repository.TelegramBotState{Username: "hub_bot", LastSeenAt: &recent}, true, true},
		{"не в сети", repository.TelegramBotState{Username: "hub_bot", LastSeenAt: &stale}, true, false},
		{"имя есть, обращений не было", repository.TelegramBotState{Username: "hub_bot"}, true, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := NewTelegramLinkService(&fakeLinkRepo{state: tc.state})
			s.now = func() time.Time { return botNow }
			st, err := s.Status(context.Background(), "u")
			if err != nil {
				t.Fatal(err)
			}
			if st.Enabled != tc.enabled || st.BotOnline != tc.online || (tc.enabled && st.BotUsername != "hub_bot") {
				t.Fatalf("статус: %+v", st)
			}
		})
	}
}

func TestTelegramLinkCreateLink(t *testing.T) {
	s := NewTelegramLinkService(&fakeLinkRepo{})
	if _, err := s.CreateLink(context.Background(), "u"); !errors.Is(err, ErrTelegramDisabled) {
		t.Fatalf("без бота: %v", err)
	}
	s = NewTelegramLinkService(&fakeLinkRepo{state: repository.TelegramBotState{Username: "hub_bot"}})
	tok, err := s.CreateLink(context.Background(), "u")
	if err != nil || !strings.HasPrefix(tok.DeepLink, "https://t.me/hub_bot?start=") {
		t.Fatalf("ссылка: %+v %v", tok, err)
	}
}
