package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

// Config holds all runtime configuration for the BFF server.
type Config struct {
	// DatabaseURL is the full pgx connection string, e.g.
	// postgres://user:pass@host:5432/db?sslmode=require
	DatabaseURL string

	// App-issued JWT configuration. All fields are required at startup.
	AppJWTIssuer         string
	AppJWTAudience       string
	AppJWTKeyID          string
	AppJWTPrivateKeyPath string
	AppJWTPrivateKeyB64  string
	AppAccessTokenTTL    time.Duration
	AppRefreshTokenTTL   time.Duration

	// HTTP server settings.
	BindHost string
	Port     string

	// Log level: trace, debug, info, warn, error.
	LogLevel string

	// CORSOrigins is the list of allowed CORS origins parsed from a
	// comma-separated env var CORS_ORIGINS.
	CORSOrigins []string

	// DB pool tuning. Defaults are production-safe but can be overridden via
	// DB_MAX_CONNS, DB_MIN_CONNS, DB_MAX_CONN_IDLE_TIME (Go duration string).
	DBMaxConns        int32
	DBMinConns        int32
	DBMaxConnIdleTime time.Duration

	// Sentry. Empty DSN → SDK init becomes a no-op.
	SentryDSN         string
	SentryEnvironment string
	SentryRelease     string

	// AppEnv — "development" | "staging" | "production". Used by the
	// password-recovery flow: when empty SMTP_HOST AND AppEnv != "production",
	// /forgot-password returns the reset URL inline (test convenience). In
	// production an unset SMTP_HOST yields HTTP 503 — the operator must set
	// SMTP creds. AppEnv falls back to "development".
	AppEnv string

	// AppBaseURL is the public origin used to build password-reset links
	// e.g. https://tender.su10.ru. Required when SMTP is configured.
	AppBaseURL string

	// SMTP. Empty SMTPHost → email sending becomes a no-op. Used by the
	// password-recovery email flow only; nothing else in the BFF sends mail.
	SMTPHost     string
	SMTPPort     int
	SMTPUser     string
	SMTPPassword string
	SMTPFrom     string
}

// Load reads configuration from environment variables via Viper.
// All keys are bound to env vars automatically (viper.AutomaticEnv).
func Load() (*Config, error) {
	v := viper.New()
	v.AutomaticEnv()

	v.SetDefault("PORT", "3005")
	v.SetDefault("BIND_HOST", "0.0.0.0")
	v.SetDefault("LOG_LEVEL", "info")
	v.SetDefault("DB_MAX_CONNS", 20)
	v.SetDefault("DB_MIN_CONNS", 2)
	v.SetDefault("DB_MAX_CONN_IDLE_TIME", "5m")
	v.SetDefault("APP_ACCESS_TOKEN_TTL_MINUTES", 15)
	v.SetDefault("APP_REFRESH_TOKEN_TTL_DAYS", 30)
	v.SetDefault("APP_ENV", "development")
	v.SetDefault("SMTP_PORT", 587)

	dbURL := v.GetString("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("config: DATABASE_URL is required but not set")
	}

	appIssuer := v.GetString("APP_JWT_ISSUER")
	appAudience := v.GetString("APP_JWT_AUDIENCE")
	appKID := v.GetString("APP_JWT_KEY_ID")
	appKeyPath := v.GetString("APP_JWT_PRIVATE_KEY_PATH")
	appKeyB64 := v.GetString("APP_JWT_PRIVATE_KEY_B64")
	accessMins := v.GetInt("APP_ACCESS_TOKEN_TTL_MINUTES")
	refreshDays := v.GetInt("APP_REFRESH_TOKEN_TTL_DAYS")

	if appIssuer == "" {
		return nil, fmt.Errorf("config: APP_JWT_ISSUER is required")
	}
	if appKeyPath == "" && appKeyB64 == "" {
		return nil, fmt.Errorf("config: APP_JWT_PRIVATE_KEY_PATH or APP_JWT_PRIVATE_KEY_B64 is required")
	}
	if accessMins < 1 {
		return nil, fmt.Errorf("config: APP_ACCESS_TOKEN_TTL_MINUTES must be >= 1, got %d", accessMins)
	}
	if refreshDays < 1 {
		return nil, fmt.Errorf("config: APP_REFRESH_TOKEN_TTL_DAYS must be >= 1, got %d", refreshDays)
	}

	rawOrigins := v.GetString("CORS_ORIGINS")
	if rawOrigins == "" {
		return nil, fmt.Errorf("config: CORS_ORIGINS is required but not set")
	}
	origins := parseCORSOrigins(rawOrigins)
	if len(origins) == 0 {
		return nil, fmt.Errorf("config: CORS_ORIGINS must contain at least one origin")
	}

	maxConns := v.GetInt32("DB_MAX_CONNS")
	if maxConns < 1 {
		return nil, fmt.Errorf("config: DB_MAX_CONNS must be >= 1, got %d", maxConns)
	}
	minConns := v.GetInt32("DB_MIN_CONNS")
	if minConns < 0 || minConns > maxConns {
		return nil, fmt.Errorf("config: DB_MIN_CONNS must be in [0, DB_MAX_CONNS=%d], got %d", maxConns, minConns)
	}
	maxIdle, err := time.ParseDuration(v.GetString("DB_MAX_CONN_IDLE_TIME"))
	if err != nil {
		return nil, fmt.Errorf("config: DB_MAX_CONN_IDLE_TIME parse: %w", err)
	}

	cfg := &Config{
		DatabaseURL:          dbURL,
		AppJWTIssuer:         appIssuer,
		AppJWTAudience:       appAudience,
		AppJWTKeyID:          appKID,
		AppJWTPrivateKeyPath: appKeyPath,
		AppJWTPrivateKeyB64:  appKeyB64,
		AppAccessTokenTTL:    time.Duration(accessMins) * time.Minute,
		AppRefreshTokenTTL:   time.Duration(refreshDays) * 24 * time.Hour,
		BindHost:             v.GetString("BIND_HOST"),
		Port:                 v.GetString("PORT"),
		LogLevel:             v.GetString("LOG_LEVEL"),
		CORSOrigins:          origins,
		DBMaxConns:           maxConns,
		DBMinConns:           minConns,
		DBMaxConnIdleTime:    maxIdle,
		SentryDSN:            v.GetString("SENTRY_DSN"),
		SentryEnvironment:    v.GetString("SENTRY_ENVIRONMENT"),
		SentryRelease:        v.GetString("SENTRY_RELEASE"),
		AppEnv:               strings.ToLower(strings.TrimSpace(v.GetString("APP_ENV"))),
		AppBaseURL:           strings.TrimRight(strings.TrimSpace(v.GetString("APP_BASE_URL")), "/"),
		SMTPHost:             v.GetString("SMTP_HOST"),
		SMTPPort:             v.GetInt("SMTP_PORT"),
		SMTPUser:             v.GetString("SMTP_USER"),
		SMTPPassword:         v.GetString("SMTP_PASSWORD"),
		SMTPFrom:             v.GetString("SMTP_FROM"),
	}

	return cfg, nil
}

// parseCORSOrigins splits and trims a comma-separated list of origins.
func parseCORSOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		trimmed := strings.TrimSpace(p)
		if trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
