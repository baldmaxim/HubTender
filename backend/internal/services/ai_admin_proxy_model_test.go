package services

import (
	"context"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Вариант B/C: слаг вводится вручную, потому что каталога у прокси нет.
func TestSaveDraftAcceptsManualSlugInProxyMode(t *testing.T) {
	svc, store, _ := newProxyAIAdmin(t, 200)
	view, err := svc.SaveDraft(context.Background(), "openai/gpt-4o-mini", "admin")
	if err != nil {
		t.Fatalf("SaveDraft: %v", err)
	}
	if store.row.SelectedModelID == nil || *store.row.SelectedModelID != "openai/gpt-4o-mini" {
		t.Fatalf("слаг не сохранён: %+v", store.row.SelectedModelID)
	}
	// Цены и контекст обязаны остаться пустыми — они неизвестны, и
	// правдоподобное значение соврало бы в оценке бюджета.
	if p := store.row.SelectedModelPromptPrice; p != nil && *p != "" {
		t.Fatalf("ручной слаг не должен приносить цену: %q", *p)
	}
	if store.row.SelectedModelContextLength != nil {
		t.Fatalf("ручной слаг не должен приносить длину контекста: %v", *store.row.SelectedModelContextLength)
	}
	// Сверить слаг не с чем: каталог синтетический. Выдавать это за
	// «available» нельзя — гейт должен показывать оператору, что сверки нет.
	if view.ModelAvailability != "unverifiable" {
		t.Fatalf("model_availability = %q, want unverifiable", view.ModelAvailability)
	}
}

// Заглушка варианта A остаётся выбираемой — это путь отката без правок кода.
func TestSaveDraftAcceptsProxyStub(t *testing.T) {
	svc, store, _ := newProxyAIAdmin(t, 200)
	if _, err := svc.SaveDraft(context.Background(), openrouter.ProxyModelID, "admin"); err != nil {
		t.Fatalf("SaveDraft(stub): %v", err)
	}
	if store.row.SelectedModelID == nil || *store.row.SelectedModelID != openrouter.ProxyModelID {
		t.Fatal("заглушка не сохранилась")
	}
}

func TestSaveDraftRejectsGarbageSlugInProxyMode(t *testing.T) {
	svc, _, _ := newProxyAIAdmin(t, 200)
	for _, bad := range []string{"gpt-4o-mini", "openrouter/auto", "openai/gpt 4o", ""} {
		if _, err := svc.SaveDraft(context.Background(), bad, "admin"); err == nil {
			t.Fatalf("SaveDraft(%q) должен отклоняться", bad)
		}
	}
}

// В прямом режиме OpenRouter каталог есть, и произвольный слаг обязан
// отклоняться по-прежнему: послабление ручного ввода касается только прокси.
func TestSaveDraftRejectsManualSlugInDirectMode(t *testing.T) {
	svc, _, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/m"), "sk")
	if _, err := svc.SaveDraft(context.Background(), "openai/definitely-not-in-catalog", "admin"); err == nil {
		t.Fatal("в прямом режиме слаг вне каталога обязан отклоняться")
	}
}

// Протухание теста — единственная защита от подмены модели оператором:
// в proxy-режиме config hash модель не пришпиливает.
func TestModelTestStaleOnlyInProxyMode(t *testing.T) {
	proxySvc, store, _ := newProxyAIAdmin(t, 200)
	old := time.Now().Add(-200 * time.Hour) // > 168 ч
	store.row.ModelTestStatus = repository.AITestPassed
	store.row.ModelTestedAt = &old

	if !proxySvc.modelTestStale(store.snapshot()) {
		t.Fatal("proxy: тест старше max_age обязан считаться протухшим")
	}

	fresh := time.Now().Add(-1 * time.Hour)
	row := store.snapshot()
	row.ModelTestedAt = &fresh
	if proxySvc.modelTestStale(row) {
		t.Fatal("proxy: свежий тест протухшим считаться не должен")
	}

	// Прямой режим: модель пришпилена config hash'ем, протухание выключено —
	// иначе прод молча погас бы через неделю после теста.
	directSvc, directStore, _ := newTestAIAdmin(t, newFakeOpenRouter("prov/m"), "sk")
	directStore.row.ModelTestStatus = repository.AITestPassed
	directStore.row.ModelTestedAt = &old
	if directSvc.modelTestStale(directStore.snapshot()) {
		t.Fatal("прямой режим: протухание теста не должно применяться")
	}
}

// max_age_hours = 0 (или не задан) отключает протухание целиком.
func TestModelTestStaleDisabledWhenMaxAgeZero(t *testing.T) {
	svc, store, _ := newProxyAIAdmin(t, 200)
	old := time.Now().Add(-10000 * time.Hour)
	store.row.ModelTestStatus = repository.AITestPassed
	store.row.ModelTestedAt = &old
	store.row.ModelTestMaxAgeHours = 0
	if svc.modelTestStale(store.snapshot()) {
		t.Fatal("max_age_hours=0 обязан отключать протухание")
	}
}
