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
	Port string

	// Log level: trace, debug, info, warn, error.
	LogLevel string

	// CORSOrigins is the list of allowed CORS origins parsed from a
	// comma-separated env var CORS_ORIGINS.
	CORSOrigins []string

	// JWKSRefreshInterval controls how often keyfunc refreshes the JWKS.
	// Hardcoded to 1 hour; not user-configurable.
	JWKSRefreshInterval time.Duration
}

// Load reads configuration from environment variables via Viper.
// All keys are bound to env vars automatically (viper.AutomaticEnv).
func Load() (*Config, error) {
	v := viper.New()
	v.AutomaticEnv()

	v.SetDefault("PORT", "3005")
	v.SetDefault("LOG_LEVEL", "info")

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

	cfg := &Config{
		DatabaseURL:         dbURL,
		SupabaseJWKSURL:     jwksURL,
		SupabaseJWTIssuer:   jwtIssuer,
		Port:                v.GetString("PORT"),
		LogLevel:            v.GetString("LOG_LEVEL"),
		CORSOrigins:         origins,
		JWKSRefreshInterval: time.Hour,
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
