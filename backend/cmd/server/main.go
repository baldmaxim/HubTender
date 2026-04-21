package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/MicahParks/keyfunc/v3"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/config"
	infradb "github.com/su10/hubtender/backend/internal/infrastructure/db"
	"github.com/su10/hubtender/backend/internal/handlers"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

func main() {
	// -------------------------------------------------------------------------
	// 1. Config
	// -------------------------------------------------------------------------
	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("failed to load config")
	}

	// -------------------------------------------------------------------------
	// 2. Logger
	// -------------------------------------------------------------------------
	level, err := zerolog.ParseLevel(cfg.LogLevel)
	if err != nil {
		level = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(level)
	logger := zerolog.New(os.Stdout).With().Timestamp().Logger()
	log.Logger = logger

	// -------------------------------------------------------------------------
	// 3. Database pool
	// -------------------------------------------------------------------------
	ctx := context.Background()
	pool, err := infradb.NewPool(ctx, cfg.DatabaseURL, infradb.DefaultPoolConfig())
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer pool.Close()
	log.Info().Msg("database pool connected")

	// -------------------------------------------------------------------------
	// 4. JWKS keyfunc (auto-refreshes every 1 h)
	// -------------------------------------------------------------------------
	kf, err := keyfunc.NewDefault([]string{cfg.SupabaseJWKSURL})
	if err != nil {
		log.Fatal().Err(err).Msg("failed to initialise JWKS keyfunc")
	}

	// -------------------------------------------------------------------------
	// 5. Repositories, cache, services, handlers
	// -------------------------------------------------------------------------
	inMemCache := cache.New()

	userRepo := repository.NewUserRepo(pool)
	refRepo := repository.NewReferenceRepo(pool)
	tenderRepo := repository.NewTenderRepo(pool)
	positionRepo := repository.NewPositionRepo(pool)
	boqRepo := repository.NewBoqRepo(pool)

	userSvc := services.NewUserService(userRepo, inMemCache)
	refSvc := services.NewReferenceService(refRepo, inMemCache)
	tenderSvc := services.NewTenderService(tenderRepo, inMemCache)
	positionSvc := services.NewPositionService(positionRepo, inMemCache)
	boqSvc := services.NewBoqService(boqRepo, inMemCache)

	healthH := handlers.NewHealthHandler()
	meH := handlers.NewMeHandler(userSvc)
	refH := handlers.NewReferenceHandler(refSvc)
	tenderH := handlers.NewTenderHandler(tenderSvc)
	positionH := handlers.NewPositionHandler(positionSvc)
	boqH := handlers.NewBoqHandler(boqSvc)

	// -------------------------------------------------------------------------
	// 6. Router
	// -------------------------------------------------------------------------
	r := chi.NewRouter()

	// Global middleware.
	r.Use(chimiddleware.RequestID)
	r.Use(middleware.Recoverer)
	r.Use(middleware.RequestLogger(logger))
	r.Use(chimiddleware.Timeout(30 * time.Second))
	r.Use(corsMiddleware(cfg.CORSOrigins))

	// Public routes.
	r.Get("/health", healthH.ServeHTTP)

	// Authenticated API routes.
	authMW := middleware.JWTAuth(kf, cfg.SupabaseJWTIssuer)

	r.Group(func(r chi.Router) {
		r.Use(authMW)

		r.Get("/api/v1/me", meH.GetMe)
		r.Get("/api/v1/me/permissions", meH.GetPermissions)

		r.Get("/api/v1/references/roles", refH.GetRoles)
		r.Get("/api/v1/references/units", refH.GetUnits)
		r.Get("/api/v1/references/material-names", refH.GetMaterialNames)
		r.Get("/api/v1/references/work-names", refH.GetWorkNames)
		r.Get("/api/v1/references/cost-categories", refH.GetCostCategories)
		r.Get("/api/v1/references/detail-cost-categories", refH.GetDetailCostCategories)

		// Phase 3 — tenders, positions, BOQ items (read-only).
		r.Get("/api/v1/tenders", tenderH.GetTenders)
		r.Get("/api/v1/tenders/{id}/overview", tenderH.GetTenderOverview)
		r.Get("/api/v1/tenders/{id}/positions", positionH.GetPositions)
		r.Get("/api/v1/tenders/{id}/positions/{posId}/items", boqH.GetBoqItems)
	})

	// -------------------------------------------------------------------------
	// 7. HTTP server with graceful shutdown
	// -------------------------------------------------------------------------
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      r,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in a goroutine so shutdown can proceed on the main goroutine.
	serverErr := make(chan error, 1)
	go func() {
		log.Info().Str("port", cfg.Port).Msg("server listening")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			serverErr <- err
		}
	}()

	// Wait for OS signal or server error.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		log.Info().Str("signal", sig.String()).Msg("shutdown signal received")
	case err := <-serverErr:
		log.Fatal().Err(err).Msg("server error")
	}

	// Graceful shutdown — allow up to 15 s for in-flight requests to complete.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("graceful shutdown failed; forcing close")
		_ = srv.Close()
	} else {
		log.Info().Msg("server shutdown complete")
	}
}

// ---------------------------------------------------------------------------
// CORS middleware
// ---------------------------------------------------------------------------

// corsMiddleware returns a minimal CORS handler that allows the configured
// origins. It does not depend on any external library.
func corsMiddleware(allowedOrigins []string) func(http.Handler) http.Handler {
	originSet := make(map[string]struct{}, len(allowedOrigins))
	for _, o := range allowedOrigins {
		originSet[strings.TrimRight(o, "/")] = struct{}{}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if _, ok := originSet[origin]; ok {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Set(
						"Access-Control-Allow-Headers",
						"Authorization, Content-Type, X-Request-ID",
					)
					w.Header().Set(
						"Access-Control-Allow-Methods",
						"GET, OPTIONS",
					)
				}
			}

			// Handle pre-flight.
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
