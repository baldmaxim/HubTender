package services

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/apikey"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// settingsTTL — насколько кэшируются настройки выдачи API. Короткий: тумблер
// «выключить эндпоинт» — это кнопка экстренной остановки, она должна
// срабатывать почти сразу, а не через минуту.
const settingsTTL = 10 * time.Second

// callLogBuffer — размер очереди журнала. Журнал диагностический: при
// переполнении записи ДРОПАЮТСЯ с логом, но запрос не задерживается.
const callLogBuffer = 512

// apiAccessRepoer — граница репозитория.
type apiAccessRepoer interface {
	ListApiKeys(ctx context.Context) ([]repository.ApiKeyRow, error)
	CreateApiKey(ctx context.Context, in repository.CreateApiKeyInput) (*repository.ApiKeyRow, error)
	GetApiKey(ctx context.Context, id string) (*repository.ApiKeyRow, error)
	RevokeApiKey(ctx context.Context, id, revokedBy string) (*repository.ApiKeyRow, error)
	DeleteApiKey(ctx context.Context, id string) error
	VerifyApiKeyHash(ctx context.Context, hash string) (*repository.VerifiedApiKey, error)
	TouchApiKey(ctx context.Context, id string) error
	GetApiAccessSettings(ctx context.Context) (*repository.ApiAccessSettings, error)
	UpdateApiAccessSettings(ctx context.Context, s repository.ApiAccessSettings, updatedBy string) (*repository.ApiAccessSettings, error)
	InsertApiCallLog(ctx context.Context, e repository.ApiCallLogEntry) error
	ListApiCallLog(ctx context.Context, f repository.ApiCallLogFilter) ([]repository.ApiCallLogEntry, error)
	PurgeApiCallLog(ctx context.Context, retentionDays int) (int, error)
}

// ApiAccessService — выпуск ключей, настройки выдачи API, журнал вызовов,
// проверка ключа и лимит частоты на рантайме.
type ApiAccessService struct {
	repo apiAccessRepoer

	mu           sync.RWMutex
	cached       *repository.ApiAccessSettings
	cachedAt     time.Time
	rateWindows  map[string]*rateWindow
	callLog      chan repository.ApiCallLogEntry
	lastPurgedAt time.Time
}

type rateWindow struct {
	windowStart time.Time
	count       int
}

// NewApiAccessService creates an ApiAccessService и запускает писателя журнала.
func NewApiAccessService(ctx context.Context, repo *repository.ApiAccessRepo) *ApiAccessService {
	s := &ApiAccessService{
		repo:        repo,
		rateWindows: map[string]*rateWindow{},
		callLog:     make(chan repository.ApiCallLogEntry, callLogBuffer),
	}
	go s.runCallLogWriter(ctx)
	return s
}

// ─── Настройки ──────────────────────────────────────────────────────────────

// Settings возвращает настройки выдачи API с коротким кэшем.
func (s *ApiAccessService) Settings(ctx context.Context) (*repository.ApiAccessSettings, error) {
	s.mu.RLock()
	cached, at := s.cached, s.cachedAt
	s.mu.RUnlock()
	if cached != nil && time.Since(at) < settingsTTL {
		return cached, nil
	}

	fresh, err := s.repo.GetApiAccessSettings(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cached, s.cachedAt = fresh, time.Now()
	s.mu.Unlock()
	return fresh, nil
}

// UpdateSettings перезаписывает настройки и сбрасывает кэш.
func (s *ApiAccessService) UpdateSettings(
	ctx context.Context, in repository.ApiAccessSettings, updatedBy string,
) (*repository.ApiAccessSettings, error) {
	fresh, err := s.repo.UpdateApiAccessSettings(ctx, in, updatedBy)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cached, s.cachedAt = fresh, time.Now()
	s.mu.Unlock()
	return fresh, nil
}

// ─── Ключи ──────────────────────────────────────────────────────────────────

// IssuedApiKey — ответ на выпуск: секрет отдаётся ЕДИНСТВЕННЫЙ раз.
type IssuedApiKey struct {
	Key    repository.ApiKeyRow `json:"key"`
	Secret string               `json:"secret"`
}

// CreateApiKeyRequest — параметры выпуска из UI.
type CreateApiKeyRequest struct {
	Name             string
	Scopes           []string
	AllowedTenderIDs []string
	ExpiresAt        *string
	CreatedBy        string
}

// ListKeys возвращает все ключи (без секретов).
func (s *ApiAccessService) ListKeys(ctx context.Context) ([]repository.ApiKeyRow, error) {
	return s.repo.ListApiKeys(ctx)
}

// CreateKey выпускает ключ. Секрет генерируется здесь, в БД уходит только хеш,
// и вернуть его повторно нельзя ни через какой эндпоинт.
func (s *ApiAccessService) CreateKey(ctx context.Context, req CreateApiKeyRequest) (*IssuedApiKey, error) {
	scopes, err := apikey.NormalizeScopes(req.Scopes)
	if err != nil {
		return nil, err
	}
	gen, err := apikey.Generate()
	if err != nil {
		return nil, err
	}
	row, err := s.repo.CreateApiKey(ctx, repository.CreateApiKeyInput{
		Name:             req.Name,
		KeyPrefix:        gen.Prefix,
		KeyHash:          gen.Hash,
		Scopes:           scopes,
		AllowedTenderIDs: req.AllowedTenderIDs,
		ExpiresAt:        req.ExpiresAt,
		CreatedBy:        req.CreatedBy,
	})
	if err != nil {
		return nil, err
	}
	return &IssuedApiKey{Key: *row, Secret: gen.Secret}, nil
}

// RevokeKey гасит ключ.
func (s *ApiAccessService) RevokeKey(ctx context.Context, id, revokedBy string) (*repository.ApiKeyRow, error) {
	return s.repo.RevokeApiKey(ctx, id, revokedBy)
}

// DeleteKey удаляет ключ насовсем.
func (s *ApiAccessService) DeleteKey(ctx context.Context, id string) error {
	return s.repo.DeleteApiKey(ctx, id)
}

// ─── Проверка ключа на рантайме ─────────────────────────────────────────────

// VerifyAPIKey проверяет секрет из заголовка и применяет лимит частоты.
//
// Реализует middleware.APIKeyVerifier. Отозванный и просроченный ключ не
// находятся в принципе — это условие того же SQL-запроса.
func (s *ApiAccessService) VerifyAPIKey(
	ctx context.Context, secret string,
) (*middleware.APIKeyPrincipal, *middleware.AuthUser, error) {
	if !apikey.LooksLikeKey(secret) {
		return nil, nil, errors.New("malformed api key")
	}
	verified, err := s.repo.VerifyApiKeyHash(ctx, apikey.Hash(secret))
	if err != nil {
		return nil, nil, err
	}

	limit := 0
	if st, err := s.Settings(ctx); err == nil {
		limit = st.RateLimitPerMinute
	}
	if !s.allowRate(verified.ID, limit) {
		return nil, nil, middleware.ErrAPIKeyRateLimited
	}

	// Отметка об использовании — лучшая попытка, вне критического пути.
	if err := s.repo.TouchApiKey(ctx, verified.ID); err != nil {
		log.Debug().Err(err).Msg("api key touch failed")
	}

	return &middleware.APIKeyPrincipal{
			ID:               verified.ID,
			Name:             verified.Name,
			Scopes:           verified.Scopes,
			AllowedTenderIDs: verified.AllowedTenderIDs,
		}, &middleware.AuthUser{
			ID:    verified.OwnerUserID,
			Email: verified.OwnerEmail,
			Role:  verified.OwnerRole,
		}, nil
}

// allowRate — фиксированное минутное окно на ключ. limit <= 0 = без лимита.
func (s *ApiAccessService) allowRate(keyID string, limit int) bool {
	if limit <= 0 {
		return true
	}
	now := time.Now()
	s.mu.Lock()
	defer s.mu.Unlock()

	w, ok := s.rateWindows[keyID]
	if !ok || now.Sub(w.windowStart) >= time.Minute {
		s.rateWindows[keyID] = &rateWindow{windowStart: now, count: 1}
		return true
	}
	if w.count >= limit {
		return false
	}
	w.count++
	return true
}

// ─── Журнал вызовов ─────────────────────────────────────────────────────────

// RecordAPICall кладёт запись в очередь журнала. Реализует middleware.CallSink.
// Никогда не блокирует: очередь полна — запись теряется с предупреждением.
func (s *ApiAccessService) RecordAPICall(rec middleware.CallRecord) {
	entry := repository.ApiCallLogEntry{
		Method:        rec.Method,
		Path:          rec.Path,
		Status:        rec.Status,
		DurationMs:    rec.DurationMs,
		ItemsAffected: rec.ItemsAffected,
		DryRun:        rec.DryRun,
	}
	if rec.APIKeyID != "" {
		id := rec.APIKeyID
		entry.ApiKeyID = &id
	}
	if rec.UserID != "" {
		id := rec.UserID
		entry.UserID = &id
	}
	if rec.ErrorCode != "" {
		code := rec.ErrorCode
		entry.ErrorCode = &code
	}

	select {
	case s.callLog <- entry:
	default:
		log.Warn().Str("path", rec.Path).Msg("api call log buffer full — запись отброшена")
	}
}

// runCallLogWriter пишет журнал вне обработки запроса и раз в час чистит его
// по сроку хранения из настроек.
func (s *ApiAccessService) runCallLogWriter(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case entry := <-s.callLog:
			writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			if err := s.repo.InsertApiCallLog(writeCtx, entry); err != nil {
				log.Warn().Err(err).Msg("api call log insert failed")
			}
			cancel()
			s.maybePurge(ctx)
		}
	}
}

func (s *ApiAccessService) maybePurge(ctx context.Context) {
	s.mu.Lock()
	if time.Since(s.lastPurgedAt) < time.Hour {
		s.mu.Unlock()
		return
	}
	s.lastPurgedAt = time.Now()
	s.mu.Unlock()

	st, err := s.Settings(ctx)
	if err != nil {
		return
	}
	purgeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	if n, err := s.repo.PurgeApiCallLog(purgeCtx, st.CallLogRetentionDays); err != nil {
		log.Warn().Err(err).Msg("api call log purge failed")
	} else if n > 0 {
		log.Info().Int("removed", n).Msg("api call log purged")
	}
}

// ListCallLog возвращает журнал вызовов.
func (s *ApiAccessService) ListCallLog(
	ctx context.Context, f repository.ApiCallLogFilter,
) ([]repository.ApiCallLogEntry, error) {
	return s.repo.ListApiCallLog(ctx, f)
}

// EnsureEndpointEnabled — общий гейт тумблеров. Возвращает понятную ошибку,
// если администратор выключил эндпоинт.
func (s *ApiAccessService) EnsureEndpointEnabled(ctx context.Context, endpoint string) error {
	st, err := s.Settings(ctx)
	if err != nil {
		return err
	}
	enabled := true
	switch endpoint {
	case "archive.search":
		enabled = st.ArchiveSearchEnabled
	case "archive.read":
		enabled = st.ArchiveReadEnabled
	case "archive.suggest":
		enabled = st.ArchiveSuggestEnabled
	case "archive.compose":
		enabled = st.ArchiveComposeEnabled
	default:
		return fmt.Errorf("apiAccessService: неизвестный эндпоинт %q", endpoint)
	}
	if !enabled {
		return ErrEndpointDisabled
	}
	return nil
}

// ErrEndpointDisabled — эндпоинт выключен администратором.
var ErrEndpointDisabled = errors.New("endpoint disabled by administrator")
