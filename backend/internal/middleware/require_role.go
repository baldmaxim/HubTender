package middleware

import (
	"net/http"

	"github.com/su10/hubtender/backend/pkg/apierr"
)

// RequireRoles — этап 2.5: серверный role-гейт поверх JWTAuth. До этого
// админ-маршруты полагались только на frontend page-ACL; для AI-настроек
// (secrets/policy) обязателен настоящий backend-гейт: non-admin получает 403,
// независимо от allowed_pages.
func RequireRoles(allowed map[string]bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authUser := UserFromContext(r.Context())
			if authUser == nil {
				apierr.Unauthorized("authentication required").Render(w)
				return
			}
			if !allowed[authUser.Role] {
				apierr.Forbidden("недостаточно прав для этого раздела").Render(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
