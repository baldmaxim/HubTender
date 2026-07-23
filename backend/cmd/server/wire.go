package main

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/cbr"
	"github.com/su10/hubtender/backend/internal/config"
	"github.com/su10/hubtender/backend/internal/handlers"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/realtime"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

// deps carries every handler wired by buildDeps plus the recalc queue
// (needed by the graceful-shutdown sequence in main.go).
type deps struct {
	recalcQueue *services.RecalcQueue

	healthH           *handlers.HealthHandler
	meH               *handlers.MeHandler
	refH              *handlers.ReferenceHandler
	tenderH           *handlers.TenderHandler
	tenderWH          *handlers.TenderWriteHandler
	cbrH              *handlers.CBRHandler
	positionH         *handlers.PositionHandler
	positionWH        *handlers.PositionWriteHandler
	positionCostsH    *handlers.PositionCostsHandler
	boqH              *handlers.BoqHandler
	boqWH             *handlers.BoqWriteHandler
	bulkBoqH          *handlers.BulkBoqHandler
	importBoqH        *handlers.ImportBoqHandler
	timelineH         *handlers.TimelineHandler
	userRegH          *handlers.UserRegisterHandler
	subcontractH      *handlers.SubcontractHandler
	transferH         *handlers.TenderTransferHandler
	cloneH            *handlers.TenderCloneHandler
	tenderNotesH      *handlers.TenderNotesHandler
	boqAuditRollbackH *handlers.BoqAuditRollbackHandler
	tasksH            *handlers.TasksHandler
	comparisonH       *handlers.ComparisonHandler
	costImportH       *handlers.CostImportHandler
	libraryH          *handlers.LibraryHandler
	redistributionH   *handlers.RedistributionHandler
	insuranceH        *handlers.InsuranceHandler
	fiDiscountsH      *handlers.FIDiscountsHandler
	positionFiltersH  *handlers.PositionFiltersHandler
	notificationsH    *handlers.NotificationsHandler
	tenderRegistryH   *handlers.TenderRegistryHandler
	costsH            *handlers.CostsHandler
	nomenclaturesH    *handlers.NomenclaturesHandler
	importLogH        *handlers.ImportLogHandler
	projectsH         *handlers.ProjectsHandler
	userAdminH        *handlers.UserAdminHandler
	markupH           *handlers.MarkupHandler
	fiH               *handlers.FIHandler
	ccvH              *handlers.ConstructionCostVolumesHandler
	wsH               *handlers.WsHandler
}

// buildDeps wires repositories → cache → services → handlers. Extracted from
// main() verbatim (section 8) to keep the entrypoint under the 600-line limit.
func buildDeps(
	rootCtx context.Context,
	pool *pgxpool.Pool,
	hub *realtime.Hub,
	verifyCfg middleware.VerifyConfig,
	cfg *config.Config,
	logger zerolog.Logger,
) *deps {
	inMemCache := cache.New()
	cbrClient := cbr.NewClient(inMemCache, cfg.CBRBaseURL)

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
	cloneRepo := repository.NewCloneRepo(pool)
	tenderNotesRepo := repository.NewTenderNotesRepo(pool)
	boqAuditRollbackRepo := repository.NewBoqAuditRollbackRepo(pool)
	tasksRepo := repository.NewTasksRepo(pool)
	comparisonRepo := repository.NewComparisonRepo(pool)
	costImportRepo := repository.NewCostImportRepo(pool)
	libraryRepo := repository.NewLibraryRepo(pool)
	redistributionRepo := repository.NewRedistributionRepo(pool)
	insuranceRepo := repository.NewInsuranceRepo(pool)
	fiDiscountsRepo := repository.NewFIDiscountsRepo(pool)
	positionFiltersRepo := repository.NewPositionFiltersRepo(pool)
	notificationsRepo := repository.NewNotificationsRepo(pool)
	tenderRegistryRepo := repository.NewTenderRegistryRepo(pool)
	costsRepo := repository.NewCostsRepo(pool)
	nomenclaturesRepo := repository.NewNomenclaturesRepo(pool)
	importLogRepo := repository.NewImportLogRepo(pool)
	projectsRepo := repository.NewProjectsRepo(pool)
	userAdminRepo := repository.NewUserAdminRepo(pool)
	markupRepo := repository.NewMarkupRepo(pool)
	fiRepo := repository.NewFIRepo(pool)
	ccvRepo := repository.NewConstructionCostVolumesRepo(pool)

	// Commercial-cost auto-recalc — replaces the manual «Пересчитать» button.
	// Mutation services Enqueue(tenderID) after changing a pricing input (BOQ
	// items, markup config, currency rates); the queue debounces per tender and
	// runs an authoritative server-side recalc (calc.CalculateBoqItemCost) that
	// materializes boq_items commercial costs + tenders.cached_grand_total.
	recalcSvc := services.NewCommercialRecalcService(fiRepo, markupRepo, bulkBoqRepo, inMemCache)
	recalcQueue := services.NewRecalcQueue(rootCtx, recalcSvc, 1500*time.Millisecond, 4, logger)

	userSvc := services.NewUserService(userRepo, inMemCache)
	refSvc := services.NewReferenceService(refRepo, inMemCache)
	tenderSvc := services.NewTenderService(tenderRepo, inMemCache).WithRecalcQueue(recalcQueue)
	positionSvc := services.NewPositionService(positionRepo, inMemCache)
	positionCostsSvc := services.NewPositionCostsService(positionCostsRepo, inMemCache)
	boqSvc := services.NewBoqService(boqRepo, inMemCache).WithRecalcQueue(recalcQueue)
	bulkBoqSvc := services.NewBulkBoqService(bulkBoqRepo, inMemCache)
	importBoqSvc := services.NewImportBoqService(importBoqRepo, inMemCache).WithRecalcQueue(recalcQueue)
	timelineSvc := services.NewTimelineService(timelineRepo)
	subcontractSvc := services.NewSubcontractService(subcontractRepo, inMemCache).WithRecalcQueue(recalcQueue)
	transferSvc := services.NewTransferService(transferRepo, inMemCache)
	cloneSvc := services.NewCloneService(cloneRepo, inMemCache)
	tenderNotesSvc := services.NewTenderNotesService(tenderNotesRepo)
	boqAuditRollbackSvc := services.NewBoqAuditRollbackService(boqAuditRollbackRepo, inMemCache)
	tasksSvc := services.NewTasksService(tasksRepo)
	comparisonSvc := services.NewComparisonService(comparisonRepo)
	costImportSvc := services.NewCostImportService(costImportRepo, inMemCache)
	librarySvc := services.NewLibraryService(libraryRepo, inMemCache)
	redistributionSvc := services.NewRedistributionService(redistributionRepo, inMemCache)
	insuranceSvc := services.NewInsuranceService(insuranceRepo, inMemCache)
	fiDiscountsSvc := services.NewFIDiscountsService(fiDiscountsRepo, inMemCache)
	positionFiltersSvc := services.NewPositionFiltersService(positionFiltersRepo)
	notificationsSvc := services.NewNotificationsService(notificationsRepo)
	tenderRegistrySvc := services.NewTenderRegistryService(tenderRegistryRepo)
	costsSvc := services.NewCostsService(costsRepo, inMemCache)
	nomenclaturesSvc := services.NewNomenclaturesService(nomenclaturesRepo, inMemCache)
	importLogSvc := services.NewImportLogService(importLogRepo)
	projectsSvc := services.NewProjectsService(projectsRepo)
	userAdminSvc := services.NewUserAdminService(userAdminRepo, inMemCache)
	markupSvc := services.NewMarkupService(markupRepo, inMemCache).WithRecalcQueue(recalcQueue)
	fiSvc := services.NewFIService(fiRepo)
	ccvSvc := services.NewConstructionCostVolumesService(ccvRepo)

	return &deps{
		recalcQueue: recalcQueue,

		healthH:           handlers.NewHealthHandler(pool, inMemCache),
		meH:               handlers.NewMeHandler(userSvc),
		refH:              handlers.NewReferenceHandler(refSvc),
		tenderH:           handlers.NewTenderHandler(tenderSvc),
		tenderWH:          handlers.NewTenderWriteHandler(tenderSvc),
		cbrH:              handlers.NewCBRHandler(cbrClient),
		positionH:         handlers.NewPositionHandler(positionSvc),
		positionWH:        handlers.NewPositionWriteHandler(positionSvc),
		positionCostsH:    handlers.NewPositionCostsHandler(positionCostsSvc),
		boqH:              handlers.NewBoqHandler(boqSvc),
		boqWH:             handlers.NewBoqWriteHandler(boqSvc),
		bulkBoqH:          handlers.NewBulkBoqHandler(bulkBoqSvc),
		importBoqH:        handlers.NewImportBoqHandler(importBoqSvc),
		timelineH:         handlers.NewTimelineHandler(timelineSvc),
		userRegH:          handlers.NewUserRegisterHandler(userSvc),
		subcontractH:      handlers.NewSubcontractHandler(subcontractSvc),
		transferH:         handlers.NewTenderTransferHandler(transferSvc),
		cloneH:            handlers.NewTenderCloneHandler(cloneSvc),
		tenderNotesH:      handlers.NewTenderNotesHandler(tenderNotesSvc),
		boqAuditRollbackH: handlers.NewBoqAuditRollbackHandler(boqAuditRollbackSvc),
		tasksH:            handlers.NewTasksHandler(tasksSvc),
		comparisonH:       handlers.NewComparisonHandler(comparisonSvc),
		costImportH:       handlers.NewCostImportHandler(costImportSvc),
		libraryH:          handlers.NewLibraryHandler(librarySvc),
		redistributionH:   handlers.NewRedistributionHandler(redistributionSvc),
		insuranceH:        handlers.NewInsuranceHandler(insuranceSvc),
		fiDiscountsH:      handlers.NewFIDiscountsHandler(fiDiscountsSvc),
		positionFiltersH:  handlers.NewPositionFiltersHandler(positionFiltersSvc),
		notificationsH:    handlers.NewNotificationsHandler(notificationsSvc),
		tenderRegistryH:   handlers.NewTenderRegistryHandler(tenderRegistrySvc),
		costsH:            handlers.NewCostsHandler(costsSvc),
		nomenclaturesH:    handlers.NewNomenclaturesHandler(nomenclaturesSvc),
		importLogH:        handlers.NewImportLogHandler(importLogSvc),
		projectsH:         handlers.NewProjectsHandler(projectsSvc),
		userAdminH:        handlers.NewUserAdminHandler(userAdminSvc),
		markupH:           handlers.NewMarkupHandler(markupSvc),
		fiH:               handlers.NewFIHandler(fiSvc),
		ccvH:              handlers.NewConstructionCostVolumesHandler(ccvSvc),
		wsH:               handlers.NewWsHandler(hub, verifyCfg, logger),
	}
}
