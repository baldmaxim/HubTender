package middleware

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/rs/zerolog/log"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// jwtLeeway returns the clock-skew tolerance for JWT exp/iat checks. Read from
// JWT_CLOCK_SKEW_SECONDS env var; defaults to 0 (strict). Use only in dev when
// the local machine clock cannot be corrected.
func jwtLeeway() time.Duration {
	if v := os.Getenv("JWT_CLOCK_SKEW_SECONDS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return 0
}

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

// VerifyToken parses and validates a raw JWT string against the provided
// keyfunc and issuer. It returns the extracted AuthUser on success, or a
// non-nil error if the token is missing, malformed, expired, or has an
// invalid issuer/sub claim.
//
// This function is public so that the WS handler can call it directly with a
// query-parameter token (browser WebSocket API cannot set headers).
func VerifyToken(kf keyfunc.Keyfunc, expectedIssuer, raw string) (*AuthUser, error) {
	claims := &supabaseClaims{}
	parseOpts := []jwt.ParserOption{
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithIssuer(expectedIssuer),
	}
	if leeway := jwtLeeway(); leeway > 0 {
		parseOpts = append(parseOpts, jwt.WithLeeway(leeway))
	}
	token, err := jwt.ParseWithClaims(raw, claims, kf.Keyfunc, parseOpts...)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("token is not valid")
	}

	// sub claim is the Supabase user UUID.
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return nil, fmt.Errorf("token missing sub claim")
	}

	return &AuthUser{
		ID:    sub,
		Email: claims.Email,
	}, nil
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

			authUser, err := VerifyToken(kf, expectedIssuer, tokenStr)
			if err != nil {
				log.Warn().Err(err).Str("path", r.URL.Path).Msg("JWT verification failed")
				apierr.Unauthorized("invalid or expired token").Render(w)
				return
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
