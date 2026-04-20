package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// ctxKey is the unexported type used for context values to avoid collisions.
type ctxKey string

// CtxUser is the context key under which the AuthUser is stored.
const CtxUser ctxKey = "user"

// AuthUser holds the verified claims extracted from the Supabase JWT.
type AuthUser struct {
	// ID is the Supabase user UUID from the "sub" claim.
	ID string

	// Email is extracted from the top-level "email" claim.
	Email string
}

// supabaseClaims extends jwt.RegisteredClaims to capture Supabase-specific
// top-level fields. AppMetadata is present but not required for Phase 2.
type supabaseClaims struct {
	jwt.RegisteredClaims
	Email       string                 `json:"email"`
	AppMetadata map[string]interface{} `json:"app_metadata"`
	UserMetadata map[string]interface{} `json:"user_metadata"`
	// "role" in Supabase JWTs is the PostgREST role ("authenticated"), not
	// the application role. Application role lives in app_metadata or users table.
	Role string `json:"role"`
}

// JWTAuth returns a chi middleware that validates a Bearer JWT using the
// provided keyfunc.Keyfunc (backed by JWKS auto-refresh) and verifies the
// issuer claim. On success it stores an AuthUser in the request context.
func JWTAuth(kf keyfunc.Keyfunc, expectedIssuer string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr, ok := bearerToken(r)
			if !ok {
				apierr.Unauthorized("missing or malformed Authorization header").Render(w)
				return
			}

			claims := &supabaseClaims{}
			token, err := jwt.ParseWithClaims(
				tokenStr,
				claims,
				kf.Keyfunc,
				jwt.WithExpirationRequired(),
				jwt.WithIssuedAt(),
				jwt.WithIssuer(expectedIssuer),
			)
			if err != nil || !token.Valid {
				apierr.Unauthorized("invalid or expired token").Render(w)
				return
			}

			// sub claim is the Supabase user UUID.
			sub, err := claims.GetSubject()
			if err != nil || sub == "" {
				apierr.Unauthorized("token missing sub claim").Render(w)
				return
			}

			authUser := &AuthUser{
				ID:    sub,
				Email: claims.Email,
			}

			ctx := context.WithValue(r.Context(), CtxUser, authUser)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserFromContext retrieves the AuthUser stored by JWTAuth middleware.
// Returns nil if the context does not contain an AuthUser (i.e., unauthenticated route).
func UserFromContext(ctx context.Context) *AuthUser {
	v := ctx.Value(CtxUser)
	if v == nil {
		return nil
	}
	u, _ := v.(*AuthUser)
	return u
}

// bearerToken extracts the raw token string from the Authorization header.
// Returns the token and true on success, or "", false if the header is absent
// or not of the form "Bearer <token>".
func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	if header == "" {
		return "", false
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "bearer") {
		return "", false
	}
	token := strings.TrimSpace(parts[1])
	if token == "" {
		return "", false
	}
	return token, true
}
