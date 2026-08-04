package services

import (
	"context"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/keycrypt"
	"github.com/su10/hubtender/backend/internal/repository"
)

// AIKeyResolver — server-side резолвер действующего OpenRouter-ключа для
// openrouter.Client.WithKeySource: UI-ключ (шифротекст в БД, расшифровка
// keycrypt) с кэшем 30 секунд. Plaintext живёт только в памяти процесса,
// никогда не логируется и наружу не отдаётся.
type AIKeyResolver struct {
	repo   *repository.AISettingsRepo
	cipher *keycrypt.Cipher

	mu       sync.Mutex
	cached   string
	loadedAt time.Time
}

const aiKeyCacheTTL = 30 * time.Second

// NewAIKeyResolver — cipher может быть nil (JWT-ключ недоступен) — тогда
// UI-ключ игнорируется и действует только env-ключ (fail-open к прежнему
// поведению, но с логом при наличии шифротекста).
func NewAIKeyResolver(repo *repository.AISettingsRepo, cipher *keycrypt.Cipher) *AIKeyResolver {
	return &AIKeyResolver{repo: repo, cipher: cipher}
}

// Current возвращает UI-ключ ("" — не задан/недоступен). Ошибки БД/расшифровки
// деградируют в "" (клиент откатится на env-ключ) с редким safe-логом.
func (r *AIKeyResolver) Current() string {
	if r == nil || r.repo == nil {
		return ""
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.loadedAt.IsZero() && time.Since(r.loadedAt) < aiKeyCacheTTL {
		return r.cached
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	ct, err := r.repo.LoadAPIKeyCiphertext(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		log.Warn().Str("operation", "ai_ui_key_load").Msg("не удалось прочитать UI-ключ — использую env")
		return r.cached // прежнее значение до истечения проблемы
	}
	r.loadedAt = time.Now()
	if len(ct) == 0 {
		r.cached = ""
		return ""
	}
	if r.cipher == nil {
		log.Warn().Str("operation", "ai_ui_key_decrypt").Msg("UI-ключ задан, но JWT-материал недоступен — использую env")
		r.cached = ""
		return ""
	}
	key, err := r.cipher.Decrypt(ct)
	if err != nil {
		// Чужой/повреждённый шифротекст (напр., БД восстановлена в другом
		// окружении) — fail-closed к env-ключу.
		log.Warn().Str("operation", "ai_ui_key_decrypt").Msg("шифротекст UI-ключа не расшифровывается — использую env")
		r.cached = ""
		return ""
	}
	r.cached = key
	return key
}

// Invalidate сбрасывает кэш (после set/clear ключа).
func (r *AIKeyResolver) Invalidate() {
	if r == nil {
		return
	}
	r.mu.Lock()
	r.cached, r.loadedAt = "", time.Time{}
	r.mu.Unlock()
}

// UIKeyActive — задан ли UI-ключ и расшифровывается ли он этим сервером.
func (r *AIKeyResolver) UIKeyActive() bool { return r != nil && r.Current() != "" }
