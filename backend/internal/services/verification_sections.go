package services

import (
	"context"

	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
)

type verificationSectionsRepoer interface {
	Load(ctx context.Context, tenderID string, activeRules []string) (*repository.TenderSections, error)
	Mark(ctx context.Context, tenderID, sectionKey, stage, expectedHash string, note, actor *string) error
	Unmark(ctx context.Context, tenderID, sectionKey, stage string, actor *string) error
}

// VerificationSectionsService — готовность по разделам ВОР.
//
// Без кэша: после отметки раздел должен сразу показать новое состояние, а
// состояние «изменён после отметки» — появиться при первой же правке.
type VerificationSectionsService struct {
	repo verificationSectionsRepoer
}

func NewVerificationSectionsService(repo *repository.VerificationSectionsRepo) *VerificationSectionsService {
	return &VerificationSectionsService{repo: repo}
}

// Sections — разделы тендера. Счётчики находок берутся только по активным
// правилам: находки выключенного правила висят открытыми с последнего прогона,
// но уже ничего не проверяют.
func (s *VerificationSectionsService) Sections(ctx context.Context, tenderID string) (*repository.TenderSections, error) {
	active := quality.Active()
	codes := make([]string, len(active))
	for i := range active {
		codes[i] = active[i].Code
	}
	return s.repo.Load(ctx, tenderID, codes)
}

func (s *VerificationSectionsService) Mark(ctx context.Context, tenderID, sectionKey, stage, expectedHash string, note, actor *string) error {
	return s.repo.Mark(ctx, tenderID, sectionKey, stage, expectedHash, note, actor)
}

func (s *VerificationSectionsService) Unmark(ctx context.Context, tenderID, sectionKey, stage string, actor *string) error {
	return s.repo.Unmark(ctx, tenderID, sectionKey, stage, actor)
}
