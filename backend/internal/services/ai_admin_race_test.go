package services

// Этап 2.5 (§29): конкурентные сценарии AI-администрирования. Запускаются в
// обычном прогоне и под `go test -race` (Linux/CGO container — см.
// scripts/readiness/run-ai-race.sh):
//   - параллельные refresh каталога → один upstream-вызов (singleflight);
//   - конкурентные read/update настроек — без data race;
//   - одновременные model test'ы — оба завершаются, состояние согласовано;
//   - activation vs config change — stale тест не активирует новую модель.

import (
	"context"
	"sync"
	"testing"

	"github.com/su10/hubtender/backend/internal/repository"
)

func TestAIRaceCatalogRefresh(t *testing.T) {
	fake := newFakeOpenRouter("prov/a", "prov/b")
	svc, _, _ := newTestAIAdmin(t, fake, "sk")
	ctx := context.Background()
	_ = svc.Models(ctx, false) // прогрев

	fake.mu.Lock()
	before := fake.modelCalls
	fake.mu.Unlock()

	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = svc.Models(ctx, true)
		}()
	}
	wg.Wait()

	fake.mu.Lock()
	delta := fake.modelCalls - before
	fake.mu.Unlock()
	// singleflight: 12 конкурентных форс-рефрешей коалесцируются;
	// допускаем 1-2 фактических вызова (гонка на границе Do), но не 12.
	if delta < 1 || delta > 3 {
		t.Fatalf("concurrent refresh not deduplicated: %d upstream calls", delta)
	}
}

func TestAIRaceSettingsReadUpdate(t *testing.T) {
	svc, _, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a", "prov/b"), "sk")
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		wg.Add(2)
		modelID := "prov/a"
		if i%2 == 1 {
			modelID = "prov/b"
		}
		go func(id string) {
			defer wg.Done()
			_, _ = svc.SaveDraft(ctx, id, "u-1")
		}(modelID)
		go func() {
			defer wg.Done()
			_, _ = svc.GetSettings(ctx)
			_, _ = svc.Capability(ctx)
			_ = svc.Status(ctx)
		}()
	}
	wg.Wait()
	view, err := svc.GetSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if view.SelectedModel == nil {
		t.Fatal("draft must survive concurrent access")
	}
}

func TestAIRaceSimultaneousModelTests(t *testing.T) {
	svc, store, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a"), "sk")
	ctx := context.Background()
	if _, err := svc.SaveDraft(ctx, "prov/a", "u-1"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, _ = svc.TestModel(ctx, "u-1")
		}()
	}
	wg.Wait()
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.row.ModelTestStatus != repository.AITestPassed {
		t.Fatalf("simultaneous tests must converge to passed: %s", store.row.ModelTestStatus)
	}
	if store.row.Enabled {
		t.Fatal("tests must never auto-enable")
	}
}

// Activation vs config change: параллельные Activate и SaveDraft(другая
// модель) НЕ могут дать enabled-конфигурацию с непротестированной моделью.
func TestAIRaceActivationVsConfigChange(t *testing.T) {
	for round := 0; round < 8; round++ {
		svc, store, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/a", "prov/b"), "sk")
		ctx := context.Background()
		if _, err := svc.SaveDraft(ctx, "prov/a", "u-1"); err != nil {
			t.Fatal(err)
		}
		if _, _, err := svc.TestModel(ctx, "u-1"); err != nil {
			t.Fatal(err)
		}

		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			_, _ = svc.Activate(ctx, "u-1")
		}()
		go func() {
			defer wg.Done()
			_, _ = svc.SaveDraft(ctx, "prov/b", "u-1")
		}()
		wg.Wait()

		store.mu.Lock()
		row := store.row
		store.mu.Unlock()
		if row.Enabled {
			// Включённой может остаться ТОЛЬКО протестированная prov/a.
			if row.SelectedModelID == nil || *row.SelectedModelID != "prov/a" ||
				row.ModelTestStatus != repository.AITestPassed {
				t.Fatalf("round %d: stale test activated changed config: %+v", round, row)
			}
		}
	}
}
