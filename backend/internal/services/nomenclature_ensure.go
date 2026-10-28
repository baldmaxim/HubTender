package services

import (
	"context"
	"fmt"
	"unicode/utf8"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Границы запроса «найти или создать наименования».
const (
	EnsureMaxItems   = 500
	EnsureMaxNameLen = 1024
)

// EnsureInputError — ошибка валидации запроса; Index — индекс элемента
// (-1 — ошибка всего запроса). Ничего не записывается.
type EnsureInputError struct {
	Index  int
	Reason string
}

func (e *EnsureInputError) Error() string {
	if e.Index < 0 {
		return "nomenclature ensure: " + e.Reason
	}
	return fmt.Sprintf("nomenclature ensure: items[%d]: %s", e.Index, e.Reason)
}

type nomenclatureEnsureRepo interface {
	UnitExists(ctx context.Context, code string) (bool, error)
	EnsureNames(ctx context.Context, items []repository.EnsureNameItem) ([]repository.EnsureNameResult, error)
}

// NomenclatureEnsureService — идемпотентное заведение наименований работ и
// материалов для внешних клиентов (авторасценка).
type NomenclatureEnsureService struct {
	repo  nomenclatureEnsureRepo
	cache *cache.InMem
}

func NewNomenclatureEnsureService(repo nomenclatureEnsureRepo, c *cache.InMem) *NomenclatureEnsureService {
	return &NomenclatureEnsureService{repo: repo, cache: c}
}

// Ensure валидирует все элементы, затем находит/создаёт их одной транзакцией.
func (s *NomenclatureEnsureService) Ensure(ctx context.Context, items []repository.EnsureNameItem) ([]repository.EnsureNameResult, error) {
	if len(items) < 1 || len(items) > EnsureMaxItems {
		return nil, &EnsureInputError{Index: -1, Reason: fmt.Sprintf("items: ожидается от 1 до %d элементов", EnsureMaxItems)}
	}
	norm := make([]repository.EnsureNameItem, len(items))
	unitOK := map[string]bool{}
	for i, it := range items {
		if it.Kind != repository.NameKindWork && it.Kind != repository.NameKindMaterial {
			return nil, &EnsureInputError{Index: i, Reason: `kind: ожидается "work" или "material"`}
		}
		name := repository.NormalizeName(it.Name)
		if name == "" {
			return nil, &EnsureInputError{Index: i, Reason: "name: пустое наименование"}
		}
		if utf8.RuneCountInString(name) > EnsureMaxNameLen {
			return nil, &EnsureInputError{Index: i, Reason: fmt.Sprintf("name: длиннее %d символов", EnsureMaxNameLen)}
		}
		if it.Unit == "" {
			return nil, &EnsureInputError{Index: i, Reason: "unit: не указана единица измерения"}
		}
		ok, seen := unitOK[it.Unit]
		if !seen {
			var err error
			if ok, err = s.repo.UnitExists(ctx, it.Unit); err != nil {
				return nil, fmt.Errorf("nomenclatureEnsureService.Ensure: unit: %w", err)
			}
			unitOK[it.Unit] = ok
		}
		if !ok {
			return nil, &EnsureInputError{Index: i, Reason: "unit: указанная единица измерения не существует"}
		}
		norm[i] = repository.EnsureNameItem{Kind: it.Kind, Name: name, Unit: it.Unit}
	}
	res, err := s.repo.EnsureNames(ctx, norm)
	if err != nil {
		return nil, fmt.Errorf("nomenclatureEnsureService.Ensure: %w", err)
	}
	for _, r := range res {
		if r.Created {
			s.invalidate()
			break
		}
	}
	return res, nil
}

func (s *NomenclatureEnsureService) invalidate() {
	if s.cache == nil {
		return
	}
	s.cache.DeleteByPrefix("ref:material_names")
	s.cache.DeleteByPrefix("ref:work_names")
}
