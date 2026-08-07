package services

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/keycrypt"
	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// feature/ai-key-ui: управление OpenRouter-ключом из админки.
//
// Инварианты (§27-совместимо):
//   - plaintext-ключ существует только в памяти процесса; в БД — AES-GCM
//     шифротекст (ключ шифрования производен от серверного JWT-private-key);
//   - наружу отдаются ТОЛЬКО configured/source/suffix/set_at;
//   - тело запроса set-key не логируется; сам ключ не логируется никогда;
//   - удаление UI-ключа возвращает поведение к env OPENROUTER_API_KEY.

// ErrAIKeyInvalid — ключ не похож на OpenRouter-ключ (write-валидация).
var ErrAIKeyInvalid = errors.New("api key must start with sk-or- and be at least 20 characters")

// ErrAIKeyProxyModeUnsupported — в режиме LLM-прокси ключ через UI не задаётся:
// прокси аутентифицируется своим токеном из server env (PROXY_LLM_TOKEN).
var ErrAIKeyProxyModeUnsupported = errors.New("api key is managed by server env in proxy_llm mode")

// ErrAIKeyCryptoUnavailable — сервер не может шифровать (нет JWT-материала).
var ErrAIKeyCryptoUnavailable = errors.New("key encryption unavailable on this server")

type aiKeyStore interface {
	SetAPIKeyCiphertext(ctx context.Context, featureCode string, ciphertext []byte, suffix, setBy string) (*repository.AIKeyState, error)
	ClearAPIKey(ctx context.Context, featureCode string) error
	APIKeyState(ctx context.Context, featureCode string) (*repository.AIKeyState, error)
}

// WithKeyManagement подключает UI-управление ключом (wire).
// envKeyConfigured — задан ли OPENROUTER_API_KEY в env (для key_source).
func (s *AIAdminService) WithKeyManagement(keys aiKeyStore, cipher *keycrypt.Cipher, resolver *AIKeyResolver, envKeyConfigured bool) *AIAdminService {
	s.keys, s.keyCipher, s.keyResolver, s.envKeyConfigured = keys, cipher, resolver, envKeyConfigured
	return s
}

// SetAPIKey валидирует, шифрует и сохраняет UI-ключ; затем сбрасывает кэши
// (ключ и key-status), чтобы следующая проверка шла с новым ключом.
func (s *AIAdminService) SetAPIKey(ctx context.Context, plaintext, actorID string) (*repository.AIKeyState, error) {
	if s.keys == nil {
		return nil, ErrAIKeyCryptoUnavailable
	}
	key := strings.TrimSpace(plaintext)
	// UI-ключом управляется ТОЛЬКО прямой OpenRouter. Токен LLM-прокси приходит
	// из server env: сохранённый через UI, он лёг бы в БД, а клиент в
	// proxy-режиме его игнорирует (см. transportProfile.allowUIKey) — оператор
	// получил бы «ключ сохранён» и неработающий провайдер.
	if s.client != nil && s.client.Transport() == openrouter.TransportProxyLLM {
		return nil, ErrAIKeyProxyModeUnsupported
	}
	if !strings.HasPrefix(key, "sk-or-") || len(key) < 20 {
		return nil, ErrAIKeyInvalid
	}
	if s.keyCipher == nil {
		return nil, ErrAIKeyCryptoUnavailable
	}
	ct, err := s.keyCipher.Encrypt(key)
	if err != nil {
		return nil, fmt.Errorf("aiAdminService.SetAPIKey: encrypt: %w", err)
	}
	st, err := s.keys.SetAPIKeyCiphertext(ctx, repository.AIFeatureNomenclatureRerank, ct, keycrypt.Suffix(key), actorID)
	if err != nil {
		return nil, fmt.Errorf("aiAdminService.SetAPIKey: %w", err)
	}
	s.keyResolver.Invalidate()
	s.invalidateKeyStatus()
	log.Info().Str("operation", "ai_ui_key_set").Str("suffix", st.Suffix).Msg("OpenRouter UI-ключ сохранён (шифротекст)")
	return st, nil
}

// ClearAPIKey удаляет UI-ключ (fallback на env-ключ, если задан).
func (s *AIAdminService) ClearAPIKey(ctx context.Context) error {
	if s.keys == nil {
		return ErrAIKeyCryptoUnavailable
	}
	if err := s.keys.ClearAPIKey(ctx, repository.AIFeatureNomenclatureRerank); err != nil {
		return fmt.Errorf("aiAdminService.ClearAPIKey: %w", err)
	}
	s.keyResolver.Invalidate()
	s.invalidateKeyStatus()
	log.Info().Str("operation", "ai_ui_key_clear").Msg("OpenRouter UI-ключ удалён — действует env-ключ (если задан)")
	return nil
}

// invalidateKeyStatus сбрасывает кэш «Проверить подключение».
func (s *AIAdminService) invalidateKeyStatus() {
	s.keyMu.Lock()
	s.keyStatus, s.keyErrCode = nil, ""
	s.keyCheckedAt = time.Time{}
	s.keyMu.Unlock()
}

// decorateKeySource дополняет connection-view источником/метаданными ключа.
func (s *AIAdminService) decorateKeySource(ctx context.Context, view *AIConnectionView) {
	view.EnvFallback = s.envKeyConfigured
	view.KeySource = "none"
	if s.keys == nil {
		if s.envKeyConfigured {
			view.KeySource = "env"
		}
		return
	}
	st, err := s.keys.APIKeyState(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil || st == nil || !st.Configured {
		if s.envKeyConfigured {
			view.KeySource = "env"
		}
		return
	}
	// UI-ключ задан; активен ли он фактически (расшифровывается)?
	if s.keyResolver != nil && s.keyResolver.UIKeyActive() {
		view.KeySource = "ui"
		view.KeySuffix = st.Suffix
		view.KeySetAt = st.SetAt
		return
	}
	// Шифротекст есть, но не читается этим сервером — честно показываем env/none.
	if s.envKeyConfigured {
		view.KeySource = "env"
	}
}
