package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/pkg/apierr"
)

// APIKeyHeader — заголовок машинного доступа.
const APIKeyHeader = "X-API-Key"

// CtxAPIKey — ключ контекста для принципала машинного доступа.
const CtxAPIKey ctxKey = "api_key"

// CtxCallStat — ключ контекста для метаданных вызова (журнал API).
const CtxCallStat ctxKey = "api_call_stat"

// APIKeyPrincipal — то, чем ключ ограничен. Секрета здесь нет.
type APIKeyPrincipal struct {
	ID               string
	Name             string
	Scopes           []string
	AllowedTenderIDs []string
}

// HasScope сообщает, разрешена ли ключу область.
func (p *APIKeyPrincipal) HasScope(want string) bool {
	if p == nil {
		return false
	}
	for _, s := range p.Scopes {
		if s == want {
			return true
		}
	}
	return false
}

// AllowsTender — ограничен ли ключ списком тендеров. Пустой список = все.
func (p *APIKeyPrincipal) AllowsTender(tenderID string) bool {
	if p == nil || len(p.AllowedTenderIDs) == 0 {
		return true
	}
	for _, id := range p.AllowedTenderIDs {
		if id == tenderID {
			return true
		}
	}
	return false
}

// ErrAPIKeyRateLimited — ключ упёрся в лимит запросов.
var ErrAPIKeyRateLimited = errors.New("api key rate limit exceeded")

// APIKeyVerifier — проверка секрета из заголовка. Реализуется сервисным слоем.
type APIKeyVerifier interface {
	// VerifyAPIKey возвращает принципала ключа и пользователя, от имени
	// которого ключ действует (нужен для аудита и прав).
	VerifyAPIKey(ctx context.Context, secret string) (*APIKeyPrincipal, *AuthUser, error)
}

// APIKeyFromContext достаёт принципала ключа; nil — запрос пришёл не по ключу.
func APIKeyFromContext(ctx context.Context) *APIKeyPrincipal {
	v, _ := ctx.Value(CtxAPIKey).(*APIKeyPrincipal)
	return v
}

// JWTOrAPIKey пускает запрос по одному из двух путей: заголовок X-API-Key
// (машинный доступ) либо обычный Bearer JWT (человек в браузере).
//
// Ключ проверяется ПЕРВЫМ и, если он есть, JWT не рассматривается: смешивать
// два принципала в одном запросе нельзя — иначе непонятно, чьи ограничения
// применять.
func JWTOrAPIKey(cfg VerifyConfig, verifier APIKeyVerifier) func(http.Handler) http.Handler {
	jwtOnly := JWTAuth(cfg)
	return func(next http.Handler) http.Handler {
		jwtChain := jwtOnly(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			secret := strings.TrimSpace(r.Header.Get(APIKeyHeader))
			if secret == "" || verifier == nil {
				jwtChain.ServeHTTP(w, r)
				return
			}

			principal, authUser, err := verifier.VerifyAPIKey(r.Context(), secret)
			if err != nil {
				if errors.Is(err, ErrAPIKeyRateLimited) {
					apierr.TooManyRequests("превышен лимит запросов для ключа").Render(w)
					return
				}
				// Причину наружу не раскрываем: отозван, просрочен или подделан —
				// для вызывающего это один и тот же ответ.
				log.Warn().Str("path", r.URL.Path).Msg("API key verification failed")
				apierr.Unauthorized("invalid API key").Render(w)
				return
			}

			ctx := context.WithValue(r.Context(), CtxAPIKey, principal)
			ctx = context.WithValue(ctx, CtxUser, authUser)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// ─── Журнал вызовов ─────────────────────────────────────────────────────────

// CallStat — то, что хендлер может дописать о вызове для журнала.
type CallStat struct {
	ItemsAffected *int
	DryRun        *bool
	ErrorCode     string
}

// CallStatFromContext возвращает изменяемую запись статистики вызова.
// nil — журналирование для этого маршрута не включено.
func CallStatFromContext(ctx context.Context) *CallStat {
	v, _ := ctx.Value(CtxCallStat).(*CallStat)
	return v
}

// SetCallItems помечает, сколько строк затронул вызов.
func SetCallItems(ctx context.Context, items int, dryRun bool) {
	if s := CallStatFromContext(ctx); s != nil {
		s.ItemsAffected = &items
		s.DryRun = &dryRun
	}
}

// CallRecord — то, что уходит в журнал.
type CallRecord struct {
	APIKeyID      string
	UserID        string
	Method        string
	Path          string
	Status        int
	DurationMs    int
	ErrorCode     string
	ItemsAffected *int
	DryRun        *bool
}

// CallSink — приёмник записей журнала (сервисный слой).
type CallSink interface {
	RecordAPICall(rec CallRecord)
}

// APICallLogger пишет метаданные вызова в журнал API.
//
// Приёмник вызывается ПОСЛЕ ответа и обязан быть неблокирующим: журнал —
// диагностика, он не должен ни задерживать ответ, ни валить запрос.
func APICallLogger(sink CallSink) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if sink == nil {
				next.ServeHTTP(w, r)
				return
			}
			stat := &CallStat{}
			ctx := context.WithValue(r.Context(), CtxCallStat, stat)
			r = r.WithContext(ctx)

			rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
			start := time.Now()
			next.ServeHTTP(rw, r)

			rec := CallRecord{
				Method:        r.Method,
				Path:          r.URL.Path,
				Status:        rw.status,
				DurationMs:    int(time.Since(start).Milliseconds()),
				ErrorCode:     stat.ErrorCode,
				ItemsAffected: stat.ItemsAffected,
				DryRun:        stat.DryRun,
			}
			if p := APIKeyFromContext(r.Context()); p != nil {
				rec.APIKeyID = p.ID
			}
			if u := UserFromContext(r.Context()); u != nil {
				rec.UserID = u.ID
			}
			sink.RecordAPICall(rec)
		})
	}
}
