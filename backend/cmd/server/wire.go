package main

import (
	"context"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
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
	qualityH          *handlers.QualityHandler
	priceBenchmarkH   *handlers.PriceBenchmarkHandler
	priceSourceH      *handlers.PriceSourceHandler
	actionPlanH       *handlers.ActionPlanHandler
	changeImpactH     *handlers.ChangeImpactHandler
	reviewPackH       *handlers.ReviewPackHandler
	smartImportH      *handlers.SmartImportHandler
	importMemoryH     *handlers.ImportMemoryHandler
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
	qualityRepo := repository.NewQualityRepo(pool)
	priceBenchmarkRepo := repository.NewPriceBenchmarkRepo(pool)
	priceSourceRepo := repository.NewPriceSourceRepo(pool)
	actionPlanRepo := repository.NewActionPlanRepo(pool)
	changeImpactRepo := repository.NewChangeImpactRepo(pool)
	reviewPackRepo := repository.NewReviewPackRepo(pool)
	importAnalysisRepo := repository.NewImportAnalysisRepo(pool)
	importMemoryRepo := repository.NewImportMemoryRepo(pool)

	// Commercial-cost auto-recalc — replaces the manual «Пересчитать» button.
	// Mutation services Enqueue(tenderID) after changing a pricing input (BOQ
	// items, markup config, currency rates); the queue debounces per tender and
	// runs an authoritative server-side recalc (calc.CalculateBoqItemCost) that
	// materializes boq_items commercial costs + tenders.cached_grand_total.
	// The commercial calculation itself lives in repository.CommercialRepo so the
	// SAME implementation can run inside copy / version-transfer transactions.
	// 0-F2: the recalc runs as ONE REPEATABLE READ tx (advisory lock + revision
	// CAS) directly on the pool; a stale_requeue outcome re-enqueues the tender.
	recalcSvc := services.NewCommercialRecalcService(pool, inMemCache)
	recalcQueue := services.NewRecalcQueue(rootCtx, recalcSvc, 1500*time.Millisecond, 4, logger)
	recalcSvc.WithRequeue(recalcQueue)

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
	qualitySvc := services.NewQualityService(qualityRepo)
	priceBenchmarkSvc := services.NewPriceBenchmarkService(priceBenchmarkRepo)
	priceSourceSvc := services.NewPriceSourceService(priceSourceRepo)
	actionPlanSvc := services.NewActionPlanService(actionPlanRepo)
	changeImpactSvc := services.NewChangeImpactService(changeImpactRepo)
	reviewPackSvc := services.NewReviewPackService(reviewPackRepo)
	// Этап 2.2: AI-подбор номенклатуры. Одобренного provider в проекте нет —
	// по умолчанию DisabledProvider; config-contract (владелец проекта):
	//   AI_NOMENCLATURE_ENABLED, AI_NOMENCLATURE_PROVIDER, AI_NOMENCLATURE_MODEL,
	//   AI_NOMENCLATURE_TIMEOUT_SECONDS. Реальный сетевой adapter добавляется
	//   отдельным подтверждённым решением (docs/AI_NOMENCLATURE_MATCHING.md).
	aiNomCfg := ainom.Config{
		Enabled:       os.Getenv("AI_NOMENCLATURE_ENABLED") == "true",
		Provider:      os.Getenv("AI_NOMENCLATURE_PROVIDER"),
		Model:         os.Getenv("AI_NOMENCLATURE_MODEL"),
		PromptVersion: ainom.PromptVersion,
	}
	var aiReranker ainom.NomenclatureReranker = ainom.DisabledProvider{}
	if aiNomCfg.Enabled {
		// Сетевой adapter не реализован до выбора провайдера владельцем:
		// enabled без adapter честно остаётся disabled-поведением.
		aiNomCfg.Enabled = false
	}
	smartImportSvc := services.NewSmartImportService(importAnalysisRepo, importBoqSvc).
		WithNomenclatureAI(importAnalysisRepo, aiReranker, aiNomCfg).
		WithImportMemory(importMemoryRepo)
	importMemorySvc := services.NewImportMemoryService(importMemoryRepo)
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
		qualityH:          handlers.NewQualityHandler(qualitySvc),
		priceBenchmarkH:   handlers.NewPriceBenchmarkHandler(priceBenchmarkSvc),
		priceSourceH:      handlers.NewPriceSourceHandler(priceSourceSvc),
		actionPlanH:       handlers.NewActionPlanHandler(actionPlanSvc),
		changeImpactH:     handlers.NewChangeImpactHandler(changeImpactSvc),
		reviewPackH:       handlers.NewReviewPackHandler(reviewPackSvc),
		smartImportH:      handlers.NewSmartImportHandler(smartImportSvc),
		importMemoryH:     handlers.NewImportMemoryHandler(importMemorySvc),
		ccvH:              handlers.NewConstructionCostVolumesHandler(ccvSvc),
		wsH:               handlers.NewWsHandler(hub, verifyCfg, logger),
	}
}
