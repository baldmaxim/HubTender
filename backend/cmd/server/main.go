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

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/config"
	infradb "github.com/su10/hubtender/backend/internal/infrastructure/db"
	"github.com/su10/hubtender/backend/internal/handlers"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/realtime"
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
	// 3. Root context — cancelled on shutdown signal so background goroutines
	//    (listener, broker) can exit cleanly.
	// -------------------------------------------------------------------------
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	// -------------------------------------------------------------------------
	// 4. Database pool
	// -------------------------------------------------------------------------
	pool, err := infradb.NewPool(rootCtx, cfg.DatabaseURL, infradb.DefaultPoolConfig())
	if err != nil {
		log.Fatal().Err(err).Msg("failed to connect to database")
	}
	defer pool.Close()
	log.Info().Msg("database pool connected")

	// -------------------------------------------------------------------------
	// 5. Dedicated listener connection for pg_notify LISTEN.
	//    A dedicated *pgx.Conn is used instead of the pool because LISTEN holds
	//    the connection for its entire lifetime. Borrowing from the pool would
	//    permanently remove one slot, starving concurrent request handlers.
	// -------------------------------------------------------------------------
	listenerConn, err := pgx.Connect(rootCtx, cfg.DatabaseURL)
	if err != nil {
		log.Fatal().Err(err).Msg("failed to open dedicated listener connection")
	}
	// listenerConn is closed after srv.Shutdown in the graceful-shutdown block.
	log.Info().Msg("listener connection opened")

	// -------------------------------------------------------------------------
	// 6. Realtime hub, broker, listener
	// -------------------------------------------------------------------------
	hub := realtime.NewHub(logger)
	broker := realtime.NewBroker(hub, 200*time.Millisecond, logger)
	listener := realtime.NewListener(listenerConn, cfg.DatabaseURL, broker, logger)

	// Run listener in the background; it exits when rootCtx is cancelled.
	go listener.Run(rootCtx)

	// -------------------------------------------------------------------------
	// 7. JWKS keyfunc (auto-refreshes every 1 h)
	// -------------------------------------------------------------------------
	kf, err := keyfunc.NewDefault([]string{cfg.SupabaseJWKSURL})
	if err != nil {
		log.Fatal().Err(err).Msg("failed to initialise JWKS keyfunc")
	}

	// -------------------------------------------------------------------------
	// 8. Repositories, cache, services, handlers
	// -------------------------------------------------------------------------
	inMemCache := cache.New()

	userRepo := repository.NewUserRepo(pool)
	refRepo := repository.NewReferenceRepo(pool)
	tenderRepo := repository.NewTenderRepo(pool)
	positionRepo := repository.NewPositionRepo(pool)
	positionCostsRepo := repository.NewPositionCostsRepo(pool)
	boqRepo := repository.NewBoqRepo(pool)
	bulkBoqRepo := repository.NewBulkBoqRepo(pool)
	importBoqRepo := repository.NewImportRepo(pool)
	timelineRepo := repository.NewTimelineRepo(pool)
	subcontractRepo := repository.NewSubcontractRepo(pool)
	transferRepo := repository.NewTransferRepo(pool)
	redistributionRepo := repository.NewRedistributionRepo(pool)
	insuranceRepo := repository.NewInsuranceRepo(pool)
	positionFiltersRepo := repository.NewPositionFiltersRepo(pool)
	notificationsRepo := repository.NewNotificationsRepo(pool)
	tenderRegistryRepo := repository.NewTenderRegistryRepo(pool)
	costsRepo := repository.NewCostsRepo(pool)
	nomenclaturesRepo := repository.NewNomenclaturesRepo(pool)
	importLogRepo := repository.NewImportLogRepo(pool)
	projectsRepo := repository.NewProjectsRepo(pool)

	userSvc := services.NewUserService(userRepo, inMemCache)
	refSvc := services.NewReferenceService(refRepo, inMemCache)
	tenderSvc := services.NewTenderService(tenderRepo, inMemCache)
	positionSvc := services.NewPositionService(positionRepo, inMemCache)
	positionCostsSvc := services.NewPositionCostsService(positionCostsRepo, inMemCache)
	boqSvc := services.NewBoqService(boqRepo, inMemCache)
	bulkBoqSvc := services.NewBulkBoqService(bulkBoqRepo, inMemCache)
	importBoqSvc := services.NewImportBoqService(importBoqRepo, inMemCache)
	timelineSvc := services.NewTimelineService(timelineRepo)
	subcontractSvc := services.NewSubcontractService(subcontractRepo, inMemCache)
	transferSvc := services.NewTransferService(transferRepo, inMemCache)
	redistributionSvc := services.NewRedistributionService(redistributionRepo, inMemCache)
	insuranceSvc := services.NewInsuranceService(insuranceRepo, inMemCache)
	positionFiltersSvc := services.NewPositionFiltersService(positionFiltersRepo)
	notificationsSvc := services.NewNotificationsService(notificationsRepo)
	tenderRegistrySvc := services.NewTenderRegistryService(tenderRegistryRepo)
	costsSvc := services.NewCostsService(costsRepo, inMemCache)
	nomenclaturesSvc := services.NewNomenclaturesService(nomenclaturesRepo, inMemCache)
	importLogSvc := services.NewImportLogService(importLogRepo)
	projectsSvc := services.NewProjectsService(projectsRepo)

	healthH := handlers.NewHealthHandler(pool, inMemCache)
	meH := handlers.NewMeHandler(userSvc)
	refH := handlers.NewReferenceHandler(refSvc)
	tenderH := handlers.NewTenderHandler(tenderSvc)
	tenderWH := handlers.NewTenderWriteHandler(tenderSvc)
	positionH := handlers.NewPositionHandler(positionSvc)
	positionWH := handlers.NewPositionWriteHandler(positionSvc)
	positionCostsH := handlers.NewPositionCostsHandler(positionCostsSvc)
	boqH := handlers.NewBoqHandler(boqSvc)
	boqWH := handlers.NewBoqWriteHandler(boqSvc)
	bulkBoqH := handlers.NewBulkBoqHandler(bulkBoqSvc)
	importBoqH := handlers.NewImportBoqHandler(importBoqSvc)
	timelineH := handlers.NewTimelineHandler(timelineSvc)
	userRegH := handlers.NewUserRegisterHandler(userSvc)
	subcontractH := handlers.NewSubcontractHandler(subcontractSvc)
	transferH := handlers.NewTenderTransferHandler(transferSvc)
	redistributionH := handlers.NewRedistributionHandler(redistributionSvc)
	insuranceH := handlers.NewInsuranceHandler(insuranceSvc)
	positionFiltersH := handlers.NewPositionFiltersHandler(positionFiltersSvc)
	notificationsH := handlers.NewNotificationsHandler(notificationsSvc)
	tenderRegistryH := handlers.NewTenderRegistryHandler(tenderRegistrySvc)
	costsH := handlers.NewCostsHandler(costsSvc)
	nomenclaturesH := handlers.NewNomenclaturesHandler(nomenclaturesSvc)
	importLogH := handlers.NewImportLogHandler(importLogSvc)
	projectsH := handlers.NewProjectsHandler(projectsSvc)
	wsH := handlers.NewWsHandler(hub, kf, cfg.SupabaseJWTIssuer, logger)

	// -------------------------------------------------------------------------
	// 9. Router
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
	r.Get("/health/db", healthH.CheckDB)
	r.Get("/health/cache", healthH.CacheStats)

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

		// Phase 3 — tenders, positions, BOQ items.
		// Slice 1: reads.
		r.Get("/api/v1/tenders", tenderH.GetTenders)
		r.Get("/api/v1/tenders/{id}/overview", tenderH.GetTenderOverview)
		r.Get("/api/v1/tenders/{id}/positions", positionH.GetPositions)
		r.Get("/api/v1/tenders/{id}/positions/{posId}/items", boqH.GetBoqItems)

		// Slice 2: writes with optimistic concurrency.
		r.Post("/api/v1/tenders", tenderWH.CreateTender)
		r.Patch("/api/v1/tenders/{id}", tenderWH.UpdateTender)

		r.Post("/api/v1/positions", positionWH.CreatePosition)
		r.Patch("/api/v1/positions/{id}", positionWH.UpdatePosition)

		r.Post("/api/v1/tenders/{id}/positions/{posId}/items", boqWH.CreateBoqItem)
		r.Patch("/api/v1/items/{id}", boqWH.UpdateBoqItem)
		r.Delete("/api/v1/items/{id}", boqWH.DeleteBoqItem)
		r.Get("/api/v1/items/{id}", boqH.GetBoqItem)

		// Slice 3a: ported RPCs.
		r.Get("/api/v1/tenders/{id}/positions/with-costs", positionCostsH.GetPositionsWithCosts)
		r.Patch("/api/v1/items/bulk-commercial", bulkBoqH.BulkUpdateCommercial)
		r.Post("/api/v1/timeline/groups/{id}/quality", timelineH.SetGroupQuality)
		r.Post("/api/v1/timeline/iterations/{id}/respond", timelineH.RespondIteration)

		// Slice 3b: remaining simple RPCs.
		r.Post("/api/v1/users/register", userRegH.Register)
		r.Post("/api/v1/tenders/{id}/subcontract-exclusions/toggle", subcontractH.ToggleExclusion)

		// Phase 4c-lite: bulk BOQ import (replaces public.bulk_import_client_position_boq RPC).
		r.Post("/api/v1/imports/boq", importBoqH.BulkImport)

		// Phase 5: version transfer (replaces public.execute_version_transfer RPC).
		r.Post("/api/v1/tenders/{id}/versions/transfer", transferH.Transfer)

		// Phase 5: atomic redistribution save (cost_redistribution_results).
		r.Post("/api/v1/redistributions/save", redistributionH.Save)

		// Insurance (per-tender).
		r.Get("/api/v1/tenders/{id}/insurance", insuranceH.Get)
		r.Put("/api/v1/tenders/{id}/insurance", insuranceH.Put)

		// User position filters (per-user, per-tender).
		r.Get("/api/v1/tenders/{id}/position-filters", positionFiltersH.List)
		r.Put("/api/v1/tenders/{id}/position-filters", positionFiltersH.Replace)
		r.Post("/api/v1/tenders/{id}/position-filters/append", positionFiltersH.Append)
		r.Delete("/api/v1/tenders/{id}/position-filters", positionFiltersH.Clear)

		// Notifications (write).
		r.Post("/api/v1/notifications", notificationsH.Create)

		// Tender registry + statuses + scopes.
		r.Get("/api/v1/tender-registry", tenderRegistryH.List)
		r.Get("/api/v1/tender-registry/next-sort-order", tenderRegistryH.NextSortOrder)
		r.Get("/api/v1/tender-registry/autocomplete", tenderRegistryH.Autocomplete)
		r.Get("/api/v1/tender-registry/tender-numbers", tenderRegistryH.TenderNumbers)
		r.Get("/api/v1/tender-registry/related-tenders", tenderRegistryH.RelatedTenders)
		r.Post("/api/v1/tender-registry", tenderRegistryH.Create)
		r.Patch("/api/v1/tender-registry/{id}", tenderRegistryH.Update)
		r.Get("/api/v1/tender-statuses", tenderRegistryH.ListTenderStatuses)
		r.Get("/api/v1/construction-scopes", tenderRegistryH.ListConstructionScopes)

		// Cost categories + detail cost categories CRUD.
		r.Get("/api/v1/cost-categories", costsH.ListCostCategories)
		r.Get("/api/v1/cost-categories/find", costsH.FindCostCategory)
		r.Post("/api/v1/cost-categories", costsH.CreateCostCategory)
		r.Patch("/api/v1/cost-categories/{id}", costsH.UpdateCostCategory)
		r.Delete("/api/v1/cost-categories/{id}", costsH.DeleteCostCategory)
		r.Delete("/api/v1/cost-categories", costsH.DeleteAllCostCategories)

		r.Get("/api/v1/detail-cost-categories", costsH.ListDetailCostCategories)
		r.Get("/api/v1/detail-cost-categories/max-order-num", costsH.NextDetailOrderNum)
		r.Post("/api/v1/detail-cost-categories", costsH.CreateDetailCostCategory)
		r.Patch("/api/v1/detail-cost-categories/{id}", costsH.UpdateDetailCostCategory)
		r.Delete("/api/v1/detail-cost-categories/{id}", costsH.DeleteDetailCostCategory)
		r.Delete("/api/v1/detail-cost-categories", costsH.DeleteAllDetailCostCategories)

		r.Get("/api/v1/locations", costsH.ListLocations)
		r.Get("/api/v1/units/active", costsH.ListActiveUnitsFull)
		r.Post("/api/v1/units/import-batch", costsH.UpsertImportedUnits)

		// Nomenclatures: full CRUD on units / material_names / work_names + remap.
		r.Get("/api/v1/nomenclatures/units", nomenclaturesH.ListUnits)
		r.Get("/api/v1/nomenclatures/units/active-list", nomenclaturesH.ListActiveUnitsShort)
		r.Get("/api/v1/nomenclatures/units/exists", nomenclaturesH.UnitExists)
		r.Post("/api/v1/nomenclatures/units", nomenclaturesH.CreateUnit)
		r.Patch("/api/v1/nomenclatures/units/{code}", nomenclaturesH.UpdateUnit)
		r.Delete("/api/v1/nomenclatures/units/{code}", nomenclaturesH.DeleteUnit)

		r.Get("/api/v1/nomenclatures/material-names", nomenclaturesH.ListMaterialNames)
		r.Get("/api/v1/nomenclatures/material-names/by-unit", nomenclaturesH.ListMaterialNamesByUnit)
		r.Post("/api/v1/nomenclatures/material-names", nomenclaturesH.CreateMaterialName)
		r.Patch("/api/v1/nomenclatures/material-names/{id}", nomenclaturesH.UpdateMaterialName)
		r.Delete("/api/v1/nomenclatures/material-names/{id}", nomenclaturesH.DeleteMaterialName)
		r.Post("/api/v1/nomenclatures/material-names/delete-batch", nomenclaturesH.DeleteMaterialNamesIn)

		r.Get("/api/v1/nomenclatures/work-names", nomenclaturesH.ListWorkNames)
		r.Get("/api/v1/nomenclatures/work-names/by-unit", nomenclaturesH.ListWorkNamesByUnit)
		r.Post("/api/v1/nomenclatures/work-names", nomenclaturesH.CreateWorkName)
		r.Patch("/api/v1/nomenclatures/work-names/{id}", nomenclaturesH.UpdateWorkName)
		r.Delete("/api/v1/nomenclatures/work-names/{id}", nomenclaturesH.DeleteWorkName)
		r.Post("/api/v1/nomenclatures/work-names/delete-batch", nomenclaturesH.DeleteWorkNamesIn)

		r.Post("/api/v1/nomenclatures/remap/boq-material", nomenclaturesH.RemapBoqMaterial)
		r.Post("/api/v1/nomenclatures/remap/library-material", nomenclaturesH.RemapLibraryMaterial)
		r.Post("/api/v1/nomenclatures/remap/boq-work", nomenclaturesH.RemapBoqWork)
		r.Post("/api/v1/nomenclatures/remap/library-work", nomenclaturesH.RemapLibraryWork)

		// Import log: read sessions + atomic cancel.
		r.Get("/api/v1/import-sessions", importLogH.ListSessions)
		r.Get("/api/v1/import-sessions/users", importLogH.UsersByIDs)
		r.Get("/api/v1/import-sessions/tenders", importLogH.TendersByIDs)
		r.Get("/api/v1/import-sessions/all-tenders", importLogH.AllTendersForFilter)
		r.Post("/api/v1/import-sessions/{id}/cancel", importLogH.Cancel)

		// Projects + agreements + monthly completion.
		r.Post("/api/v1/projects", projectsH.Create)
		r.Patch("/api/v1/projects/{id}", projectsH.Update)
		r.Delete("/api/v1/projects/{id}", projectsH.SoftDelete)
		r.Get("/api/v1/projects/active-tenders", projectsH.ListActiveTendersForSelect)

		r.Get("/api/v1/projects/{id}/agreements", projectsH.ListAgreements)
		r.Post("/api/v1/project-agreements", projectsH.CreateAgreement)
		r.Patch("/api/v1/project-agreements/{id}", projectsH.UpdateAgreement)
		r.Delete("/api/v1/project-agreements/{id}", projectsH.DeleteAgreement)

		r.Post("/api/v1/project-monthly-completion", projectsH.CreateMonthlyCompletion)
		r.Patch("/api/v1/project-monthly-completion/{id}", projectsH.UpdateMonthlyCompletion)
	})

	// Phase 4 — WebSocket endpoint. Registered OUTSIDE the authMW group because
	// the WS handler performs its own JWT verification via the ?token= query
	// parameter (the browser WebSocket API cannot set the Authorization header).
	r.Get("/api/v1/ws", wsH.Serve)

	// -------------------------------------------------------------------------
	// 10. HTTP server with graceful shutdown
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

	// Cancel the root context first so the listener goroutine exits its LISTEN
	// loop before we close the dedicated connection.
	rootCancel()

	// Graceful shutdown — allow up to 15 s for in-flight requests to complete.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()

	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Error().Err(err).Msg("graceful shutdown failed; forcing close")
		_ = srv.Close()
	} else {
		log.Info().Msg("server shutdown complete")
	}

	// Close the dedicated listener connection after the HTTP server has drained.
	// By this point the listener goroutine has already exited (rootCtx cancelled).
	_ = listenerConn.Close(context.Background())
	log.Info().Msg("listener connection closed")
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
						"Authorization, Content-Type, X-Request-ID, If-Match, If-None-Match",
					)
					w.Header().Set(
						"Access-Control-Allow-Methods",
						"GET, POST, PATCH, DELETE, OPTIONS",
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
