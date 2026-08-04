package services

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/ai/keycrypt"
	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeKeyStore struct {
	ct     []byte
	suffix string
	setAt  *time.Time
}

func (f *fakeKeyStore) SetAPIKeyCiphertext(_ context.Context, _ string, ct []byte, suffix, _ string) (*repository.AIKeyState, error) {
	now := time.Now()
	f.ct, f.suffix, f.setAt = ct, suffix, &now
	return &repository.AIKeyState{Configured: true, Suffix: suffix, SetAt: &now}, nil
}
func (f *fakeKeyStore) ClearAPIKey(context.Context, string) error {
	f.ct, f.suffix, f.setAt = nil, "", nil
	return nil
}
func (f *fakeKeyStore) APIKeyState(context.Context, string) (*repository.AIKeyState, error) {
	return &repository.AIKeyState{Configured: len(f.ct) > 0, Suffix: f.suffix, SetAt: f.setAt}, nil
}

// Ключ: (1) в fake-хранилище оказывается ТОЛЬКО шифротекст; (2) невалидный
// формат отклоняется; (3) во view-JSON plaintext не попадает ни при каких
// обстоятельствах — только суффикс/источник.
func TestAIAdminKey_SetValidatesEncryptsAndNeverEchoes(t *testing.T) {
	cipher, _ := keycrypt.New([]byte("unit-master"))
	store := &fakeKeyStore{}
	svc := &AIAdminService{}
	svc.WithKeyManagement(store, cipher, NewAIKeyResolver(nil, cipher), false)

	if _, err := svc.SetAPIKey(context.Background(), "not-a-key", "u1"); err == nil {
		t.Fatal("невалидный ключ обязан отклоняться")
	}

	const plain = "sk-or-unit-test-key-000042"
	st, err := svc.SetAPIKey(context.Background(), plain, "u1")
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if bytes.Contains(store.ct, []byte("sk-or-")) {
		t.Fatal("в хранилище попал plaintext")
	}
	if st.Suffix != "…0042" {
		t.Fatalf("suffix = %q", st.Suffix)
	}

	// JSON состояния не содержит ключа.
	raw, _ := json.Marshal(st)
	if strings.Contains(string(raw), plain) || strings.Contains(string(raw), "sk-or-unit") {
		t.Fatal("plaintext в JSON состояния")
	}

	view := AIConnectionView{}
	svc.decorateKeySource(context.Background(), &view)
	vraw, _ := json.Marshal(view)
	if strings.Contains(string(vraw), plain) {
		t.Fatal("plaintext в connection-view")
	}

	if err := svc.ClearAPIKey(context.Background()); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if len(store.ct) != 0 {
		t.Fatal("clear обязан удалять шифротекст")
	}
}

// Без cipher (нет JWT-материала) — честный отказ, не тихое plaintext-хранение.
func TestAIAdminKey_NoCipherFailsClosed(t *testing.T) {
	svc := &AIAdminService{}
	svc.WithKeyManagement(&fakeKeyStore{}, nil, NewAIKeyResolver(nil, nil), false)
	if _, err := svc.SetAPIKey(context.Background(), "sk-or-valid-key-000001", "u1"); err == nil {
		t.Fatal("без cipher сохранение обязано отклоняться")
	}
}
