package repository

import (
	"bytes"
	"context"
	"testing"

	"github.com/su10/hubtender/backend/internal/ai/keycrypt"
)

// feature/ai-key-ui: шифротекст-only хранение UI-ключа.
func TestAIKeyIntegration_CiphertextRoundTripAndClear(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	ctx := context.Background()

	// Строка настроек существует (seed миграции / GetFeatureSettings создаёт).
	if _, err := repo.GetFeatureSettings(ctx, AIFeatureNomenclatureRerank); err != nil {
		t.Fatalf("settings: %v", err)
	}

	c, _ := keycrypt.New([]byte("integration-master"))
	const plain = "sk-or-integration-test-key-000001"
	ct, _ := c.Encrypt(plain)

	st, err := repo.SetAPIKeyCiphertext(ctx, AIFeatureNomenclatureRerank, ct, keycrypt.Suffix(plain), "")
	if err != nil {
		t.Fatalf("set: %v", err)
	}
	if !st.Configured || st.Suffix != "…0001" || st.SetAt == nil {
		t.Fatalf("state после set: %+v", st)
	}

	// В БД лежит именно шифротекст, plaintext не находится.
	var raw []byte
	if err := pool.QueryRow(ctx,
		`SELECT api_key_ciphertext FROM ai_feature_settings WHERE feature_code=$1`,
		AIFeatureNomenclatureRerank).Scan(&raw); err != nil {
		t.Fatalf("raw read: %v", err)
	}
	if bytes.Contains(raw, []byte("sk-or-")) {
		t.Fatal("в БД оказался plaintext-ключ")
	}

	loaded, err := repo.LoadAPIKeyCiphertext(ctx, AIFeatureNomenclatureRerank)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if got, _ := c.Decrypt(loaded); got != plain {
		t.Fatal("roundtrip через БД не сошёлся")
	}

	if err := repo.ClearAPIKey(ctx, AIFeatureNomenclatureRerank); err != nil {
		t.Fatalf("clear: %v", err)
	}
	st2, _ := repo.APIKeyState(ctx, AIFeatureNomenclatureRerank)
	if st2.Configured {
		t.Fatal("после clear ключ обязан отсутствовать")
	}
	if ct2, _ := repo.LoadAPIKeyCiphertext(ctx, AIFeatureNomenclatureRerank); ct2 != nil {
		t.Fatal("после clear шифротекст обязан быть NULL")
	}
}
