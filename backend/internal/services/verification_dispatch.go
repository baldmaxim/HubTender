package services

import (
	"context"
	"errors"

	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ErrDispatchTooMany — выбрано больше находок, чем уходит за одну отправку.
var ErrDispatchTooMany = errors.New("dispatch: слишком много находок за одну отправку")

type dispatchRepoer interface {
	ResolveRecipients(ctx context.Context, tenderID string, findingIDs []string, senderID string) ([]repository.DispatchTarget, error)
	Summarize(ctx context.Context, targets []repository.DispatchTarget) ([]repository.DispatchRecipient, error)
	Enqueue(ctx context.Context, tenderID, senderID string, targets []repository.DispatchTarget, perMessage int) (*repository.DispatchResult, error)
}

// VerificationDispatchService — рассылка замечаний исполнителям по кнопке
// проверяющего. Сама отправка — внешний бот, забирающий очередь
// (VerificationBotService.Claim).
type VerificationDispatchService struct {
	repo dispatchRepoer
	bot  telegramBotStater
}

func NewVerificationDispatchService(repo dispatchRepoer, bot telegramBotStater) *VerificationDispatchService {
	return &VerificationDispatchService{repo: repo, bot: bot}
}

func (s *VerificationDispatchService) targets(ctx context.Context, tenderID string, ids []string, sender string) ([]repository.DispatchTarget, error) {
	bot, err := s.bot.BotState(ctx)
	if err != nil {
		return nil, err
	}
	if bot.Username == "" {
		return nil, ErrTelegramDisabled
	}
	if len(ids) > repository.MaxDispatchFindings {
		return nil, ErrDispatchTooMany
	}
	t, err := s.repo.ResolveRecipients(ctx, tenderID, ids, sender)
	if err != nil {
		return nil, err
	}
	if len(t) == 0 {
		return nil, repository.ErrDispatchEmpty
	}
	return t, nil
}

// Preview — кому что уйдёт, без постановки в очередь.
func (s *VerificationDispatchService) Preview(ctx context.Context, tenderID string, ids []string, sender string) ([]repository.DispatchRecipient, error) {
	t, err := s.targets(ctx, tenderID, ids, sender)
	if err != nil {
		return nil, err
	}
	return s.repo.Summarize(ctx, t)
}

// Dispatch ставит сообщения в очередь.
func (s *VerificationDispatchService) Dispatch(ctx context.Context, tenderID string, ids []string, sender string) (*repository.DispatchResult, error) {
	t, err := s.targets(ctx, tenderID, ids, sender)
	if err != nil {
		return nil, err
	}
	return s.repo.Enqueue(ctx, tenderID, sender, t, telegram.MaxItemsPerMessage)
}
