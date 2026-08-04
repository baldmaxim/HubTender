package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// AIKeyState — безопасное для наружного вида состояние UI-ключа
// (сам ключ/шифротекст наружу не отдаются никогда).
type AIKeyState struct {
	Configured bool       `json:"configured"`
	Suffix     string     `json:"suffix,omitempty"` // «…ab12», не секрет
	SetAt      *time.Time `json:"set_at,omitempty"`
}

// SetAPIKeyCiphertext сохраняет ШИФРОТЕКСТ UI-ключа (plaintext в БД запрещён —
// шифрование выполняет service через keycrypt до вызова).
func (r *AISettingsRepo) SetAPIKeyCiphertext(ctx context.Context, featureCode string, ciphertext []byte, suffix, setBy string) (*AIKeyState, error) {
	if len(ciphertext) == 0 {
		return nil, errors.New("aiSettingsRepo.SetAPIKeyCiphertext: пустой шифротекст")
	}
	var st AIKeyState
	err := r.pool.QueryRow(ctx, `
		UPDATE public.ai_feature_settings
		SET api_key_ciphertext = $2,
		    api_key_suffix     = $3,
		    api_key_set_at     = now(),
		    api_key_set_by     = NULLIF($4,'')::uuid
		WHERE feature_code = $1
		RETURNING (api_key_ciphertext IS NOT NULL), COALESCE(api_key_suffix,''), api_key_set_at
	`, featureCode, ciphertext, suffix, setBy).Scan(&st.Configured, &st.Suffix, &st.SetAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("aiSettingsRepo.SetAPIKeyCiphertext: feature %s not found", featureCode)
	}
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo.SetAPIKeyCiphertext: %w", err)
	}
	return &st, nil
}

// ClearAPIKey удаляет UI-ключ (возврат к env-ключу, если он задан).
func (r *AISettingsRepo) ClearAPIKey(ctx context.Context, featureCode string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.ai_feature_settings
		SET api_key_ciphertext = NULL, api_key_suffix = NULL,
		    api_key_set_at = NULL, api_key_set_by = NULL
		WHERE feature_code = $1
	`, featureCode)
	if err != nil {
		return fmt.Errorf("aiSettingsRepo.ClearAPIKey: %w", err)
	}
	return nil
}

// LoadAPIKeyCiphertext возвращает шифротекст UI-ключа (nil = не задан).
// Используется ТОЛЬКО server-side резолвером ключа (service/keycrypt).
func (r *AISettingsRepo) LoadAPIKeyCiphertext(ctx context.Context, featureCode string) ([]byte, error) {
	var ct []byte
	err := r.pool.QueryRow(ctx, `
		SELECT api_key_ciphertext FROM public.ai_feature_settings WHERE feature_code = $1
	`, featureCode).Scan(&ct)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo.LoadAPIKeyCiphertext: %w", err)
	}
	return ct, nil
}

// APIKeyState — текущее состояние UI-ключа для admin-view (без секретов).
func (r *AISettingsRepo) APIKeyState(ctx context.Context, featureCode string) (*AIKeyState, error) {
	var st AIKeyState
	err := r.pool.QueryRow(ctx, `
		SELECT (api_key_ciphertext IS NOT NULL), COALESCE(api_key_suffix,''), api_key_set_at
		FROM public.ai_feature_settings WHERE feature_code = $1
	`, featureCode).Scan(&st.Configured, &st.Suffix, &st.SetAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return &AIKeyState{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("aiSettingsRepo.APIKeyState: %w", err)
	}
	return &st, nil
}
