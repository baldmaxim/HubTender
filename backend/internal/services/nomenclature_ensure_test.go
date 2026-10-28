package services

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeEnsureRepo struct {
	units      map[string]bool
	ensureCall int
	got        []repository.EnsureNameItem
}

func (f *fakeEnsureRepo) UnitExists(_ context.Context, code string) (bool, error) {
	return f.units[code], nil
}

func (f *fakeEnsureRepo) EnsureNames(_ context.Context, items []repository.EnsureNameItem) ([]repository.EnsureNameResult, error) {
	f.ensureCall++
	f.got = items
	out := make([]repository.EnsureNameResult, len(items))
	for i, it := range items {
		out[i] = repository.EnsureNameResult{Index: i, Kind: it.Kind, Name: it.Name, Unit: it.Unit}
	}
	return out, nil
}

func TestNomenclatureEnsureValidation(t *testing.T) {
	item := func(kind, name, unit string) repository.EnsureNameItem {
		return repository.EnsureNameItem{Kind: kind, Name: name, Unit: unit}
	}
	many := make([]repository.EnsureNameItem, EnsureMaxItems+1)
	for i := range many {
		many[i] = item("work", "ok", "м2")
	}
	cases := []struct {
		name  string
		items []repository.EnsureNameItem
		index int
	}{
		{"пустой список", nil, -1},
		{"больше 500", many, -1},
		{"kind не из двух", []repository.EnsureNameItem{item("work", "a", "м2"), item("labor", "b", "м2")}, 1},
		{"пустое имя после trim", []repository.EnsureNameItem{item("work", " \t ", "м2")}, 0},
		{"имя длиннее 1024", []repository.EnsureNameItem{item("work", "a", "м2"), item("work", "b", "м2"), item("material", strings.Repeat("я", EnsureMaxNameLen+1), "м2")}, 2},
		{"нет единицы", []repository.EnsureNameItem{item("work", "a", "")}, 0},
		{"единицы нет в справочнике", []repository.EnsureNameItem{item("work", "a", "м2"), item("work", "b", "xx")}, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			repo := &fakeEnsureRepo{units: map[string]bool{"м2": true}}
			_, err := NewNomenclatureEnsureService(repo, nil).Ensure(context.Background(), c.items)
			var in *EnsureInputError
			if !errors.As(err, &in) || in.Index != c.index {
				t.Fatalf("ожидалась EnsureInputError с индексом %d, получено %v", c.index, err)
			}
			if repo.ensureCall != 0 {
				t.Fatal("при ошибке валидации в репозиторий писать нельзя")
			}
		})
	}
}

func TestNomenclatureEnsureNormalizesAndPasses(t *testing.T) {
	repo := &fakeEnsureRepo{units: map[string]bool{"м2": true}}
	res, err := NewNomenclatureEnsureService(repo, nil).Ensure(context.Background(), []repository.EnsureNameItem{
		{Kind: "work", Name: "  Устройство   стяжки\t", Unit: "м2"},
		{Kind: "material", Name: strings.Repeat("я", EnsureMaxNameLen), Unit: "м2"},
	})
	if err != nil || len(res) != 2 || repo.ensureCall != 1 {
		t.Fatalf("err=%v res=%v calls=%d", err, res, repo.ensureCall)
	}
	if repo.got[0].Name != "Устройство стяжки" {
		t.Fatalf("имя не нормализовано: %q", repo.got[0].Name)
	}
}
