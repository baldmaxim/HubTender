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

	// JWKS configuration for Supabase JWT verification.
	SupabaseJWKSURL   string
	SupabaseJWTIssuer string

	// HTTP server settings.
	BindHost string
	Port     string

	// Log level: trace, debug, info, warn, error.
	LogLevel string

	// CORSOrigins is the list of allowed CORS origins parsed from a
	// comma-separated env var CORS_ORIGINS.
	CORSOrigins []string

	// JWKSRefreshInterval controls how often keyfunc refreshes the JWKS.
	// Hardcoded to 1 hour; not user-configurable.
	JWKSRefreshInterval time.Duration

	// DB pool tuning. Defaults are production-safe but can be overridden via
	// DB_MAX_CONNS, DB_MIN_CONNS, DB_MAX_CONN_IDLE_TIME (Go duration string).
	DBMaxConns        int32
	DBMinConns        int32
	DBMaxConnIdleTime time.Duration
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

	dbURL := v.GetString("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("config: DATABASE_URL is required but not set")
	}

	jwksURL := v.GetString("SUPABASE_JWKS_URL")
	if jwksURL == "" {
		return nil, fmt.Errorf("config: SUPABASE_JWKS_URL is required but not set")
	}

	jwtIssuer := v.GetString("SUPABASE_JWT_ISSUER")
	if jwtIssuer == "" {
		return nil, fmt.Errorf("config: SUPABASE_JWT_ISSUER is required but not set")
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
		DatabaseURL:         dbURL,
		SupabaseJWKSURL:     jwksURL,
		SupabaseJWTIssuer:   jwtIssuer,
		BindHost:            v.GetString("BIND_HOST"),
		Port:                v.GetString("PORT"),
		LogLevel:            v.GetString("LOG_LEVEL"),
		CORSOrigins:         origins,
		JWKSRefreshInterval: time.Hour,
		DBMaxConns:          maxConns,
		DBMinConns:          minConns,
		DBMaxConnIdleTime:   maxIdle,
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
