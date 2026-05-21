package middleware

import (
	"context"
	"crypto/rsa"
	"errors"
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

// AuthMode selects which JWT issuers the middleware accepts. Set via the
// AUTH_MODE env var; the config layer turns the string into one of these.
type AuthMode string

const (
	// AuthModeSupabase — legacy single-issuer (Supabase JWKS). The pre-Phase-6
	// runtime mode.
	AuthModeSupabase AuthMode = "supabase"
	// AuthModeDual — accept either Supabase JWT or app JWT. Used during the
	// frontend cutover window so unexpired Supabase tokens stay usable while
	// the app-auth client is rolled out.
	AuthModeDual AuthMode = "dual"
	// AuthModeApp — accept only app-issued JWTs. The end state.
	AuthModeApp AuthMode = "app"
)

// ParseAuthMode normalises an env-string into an AuthMode. Empty input
// defaults to legacy supabase mode for backward compatibility.
func ParseAuthMode(s string) (AuthMode, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "supabase":
		return AuthModeSupabase, nil
	case "dual":
		return AuthModeDual, nil
	case "app":
		return AuthModeApp, nil
	default:
		return "", fmt.Errorf("middleware: unknown AUTH_MODE %q (want supabase|dual|app)", s)
	}
}

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

// AuthUser holds the verified claims extracted from the verified JWT —
// whatever the issuer (Supabase or app). Issuer-specific fields beyond ID +
// Email do NOT live here; callers that need them must re-parse the token.
type AuthUser struct {
	// ID is the user UUID from the "sub" claim.
	ID string

	// Email is extracted from the top-level "email" claim.
	Email string

	// Issuer is the verified "iss" claim — useful for telemetry / debugging.
	Issuer string
}

// supabaseClaims extends jwt.RegisteredClaims to capture Supabase-specific
// top-level fields. AppMetadata is present but not required for Phase 2.
type supabaseClaims struct {
	jwt.RegisteredClaims
	Email        string                 `json:"email"`
	AppMetadata  map[string]interface{} `json:"app_metadata"`
	UserMetadata map[string]interface{} `json:"user_metadata"`
	// "role" in Supabase JWTs is the PostgREST role ("authenticated"), not
	// the application role. Application role lives in app_metadata or users table.
	Role string `json:"role"`
}

// appClaims captures the shape of an access token minted by the local
// auth.Issuer. Fields mirror auth.AccessClaims — kept in lockstep at compile
// time by issuer_test.go's round-trip assertions.
type appClaims struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Role  string `json:"role"`
}

// VerifyConfig bundles the knobs needed to verify tokens in either issuer
// family. Construct it once in main.go and reuse across requests.
type VerifyConfig struct {
	Mode AuthMode

	// Supabase (only used in supabase / dual modes).
	SupabaseKeyfunc keyfunc.Keyfunc
	SupabaseIssuer  string

	// App (only used in app / dual modes).
	AppPublicKey *rsa.PublicKey
	AppIssuer    string
	AppAudience  string // optional; empty means "do not check aud"
}

// VerifyToken parses and validates a raw JWT against the configured issuers
// per Mode. Returns the extracted AuthUser on success.
//
// Routing rule: peek the "iss" claim without verifying the signature and
// dispatch to the matching verifier. Falls through to "invalid token" if the
// iss is unknown OR if the chosen verifier is disabled in this mode (e.g.
// Supabase JWT presented while AUTH_MODE=app).
//
// This is the only path that knows about both issuer families — handlers
// and the WS layer should always call here, never duplicate the logic.
func VerifyToken(cfg VerifyConfig, raw string) (*AuthUser, error) {
	iss, err := peekIssuer(raw)
	if err != nil {
		return nil, err
	}
	switch {
	case cfg.AppIssuer != "" && iss == cfg.AppIssuer:
		if cfg.Mode == AuthModeSupabase {
			return nil, errors.New("app JWT rejected in supabase mode")
		}
		if cfg.AppPublicKey == nil {
			return nil, errors.New("app public key not configured")
		}
		return verifyAppToken(cfg, raw)
	case cfg.SupabaseIssuer != "" && iss == cfg.SupabaseIssuer:
		if cfg.Mode == AuthModeApp {
			return nil, errors.New("supabase JWT rejected in app mode")
		}
		if cfg.SupabaseKeyfunc == nil {
			return nil, errors.New("supabase keyfunc not configured")
		}
		return verifySupabaseToken(cfg, raw)
	default:
		return nil, fmt.Errorf("issuer %q not accepted", iss)
	}
}

// peekIssuer parses the JWT WITHOUT verifying the signature, returning only
// the "iss" claim. We need this to pick a verifier; the chosen verifier
// will still validate the signature and the issuer claim a second time, so
// this is safe.
func peekIssuer(raw string) (string, error) {
	parser := jwt.NewParser()
	tok, _, err := parser.ParseUnverified(raw, jwt.MapClaims{})
	if err != nil {
		return "", fmt.Errorf("middleware: parse unverified: %w", err)
	}
	iss, err := tok.Claims.GetIssuer()
	if err != nil {
		return "", fmt.Errorf("middleware: missing iss claim: %w", err)
	}
	return iss, nil
}

func verifySupabaseToken(cfg VerifyConfig, raw string) (*AuthUser, error) {
	claims := &supabaseClaims{}
	parseOpts := []jwt.ParserOption{
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithIssuer(cfg.SupabaseIssuer),
	}
	if leeway := jwtLeeway(); leeway > 0 {
		parseOpts = append(parseOpts, jwt.WithLeeway(leeway))
	}
	token, err := jwt.ParseWithClaims(raw, claims, cfg.SupabaseKeyfunc.Keyfunc, parseOpts...)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("token is not valid")
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return nil, fmt.Errorf("token missing sub claim")
	}
	return &AuthUser{ID: sub, Email: claims.Email, Issuer: cfg.SupabaseIssuer}, nil
}

func verifyAppToken(cfg VerifyConfig, raw string) (*AuthUser, error) {
	claims := &appClaims{}
	parseOpts := []jwt.ParserOption{
		jwt.WithValidMethods([]string{jwt.SigningMethodRS256.Alg()}),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
		jwt.WithIssuer(cfg.AppIssuer),
	}
	if cfg.AppAudience != "" {
		parseOpts = append(parseOpts, jwt.WithAudience(cfg.AppAudience))
	}
	if leeway := jwtLeeway(); leeway > 0 {
		parseOpts = append(parseOpts, jwt.WithLeeway(leeway))
	}
	token, err := jwt.ParseWithClaims(raw, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method %v", t.Header["alg"])
		}
		return cfg.AppPublicKey, nil
	}, parseOpts...)
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, fmt.Errorf("token is not valid")
	}
	sub, err := claims.GetSubject()
	if err != nil || sub == "" {
		return nil, fmt.Errorf("token missing sub claim")
	}
	return &AuthUser{ID: sub, Email: claims.Email, Issuer: cfg.AppIssuer}, nil
}

// JWTAuth returns a chi middleware that validates the Bearer JWT according
// to the supplied VerifyConfig. On success the AuthUser is attached to the
// request context.
func JWTAuth(cfg VerifyConfig) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr, ok := bearerToken(r)
			if !ok {
				apierr.Unauthorized("missing or malformed Authorization header").Render(w)
				return
			}
			authUser, err := VerifyToken(cfg, tokenStr)
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
