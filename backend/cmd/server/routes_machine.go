package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/apikey"
	"github.com/su10/hubtender/backend/internal/handlers"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// registerMachineRoutes — маршруты с МАШИННЫМ доступом: пускают по заголовку
// X-API-Key или по обычному JWT. Каждый вызов пишется в журнал «Настройки →
// Доступ к API». Хендлеры в основном общие с UI и про области ключа не знают —
// область и ограничение по тендерам проверяет маршрутный гейт; архив смет
// гейтится тумблерами и областями внутри своих хендлеров.
//
// Маршруты, перенесённые сюда из JWT-группы, из неё удалены: у chi при дубле
// побеждает поздняя регистрация.
func registerMachineRoutes(r chi.Router, d *deps, verifyCfg middleware.VerifyConfig, compressMW func(http.Handler) http.Handler) {
	archiveMW := middleware.JWTOrAPIKey(verifyCfg, d.apiAccessSvc)
	r.Group(func(r chi.Router) {
		r.Use(compressMW)
		r.Use(archiveMW)
		r.Use(middleware.APICallLogger(d.apiAccessSvc))

		r.Get("/api/v1/archive/positions/search", d.archiveH.SearchPositions)
		r.Post("/api/v1/archive/positions/suggest", d.archiveH.SuggestPositions)
		r.Get("/api/v1/archive/positions/{id}", d.archiveH.GetPosition)
		r.Post("/api/v1/archive/compose", d.archiveH.Compose)
		r.Get("/api/v1/archive/openapi.yaml", d.archiveH.OpenAPI)

		// Чтение тендера машинным ключом — область tenders:read. Хендлеры
		// общие с UI и про области не знают, поэтому область и ограничение по
		// тендерам проверяет маршрутный гейт.
		//
		// Узкий список тендеров для выбора цели (TenderConnector): без id
		// тендера в URL гейт проверяет только область, ограничение ключа по
		// тендерам применяет сам хендлер как фильтр выборки.
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "")).
			Get("/api/v1/tenders/brief", d.tenderBriefH.List)
		// Список позиций тендера: без него внешний код не может сопоставить
		// свои строки с id существующих позиций перед сборкой сметы.
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "id")).
			Get("/api/v1/tenders/{id}/positions", d.positionH.GetPositions)
		// Строки позиции — чтобы повторная выгрузка видела, что уже записано,
		// и не задваивала: идемпотентности у записи нет.
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "id")).
			Get("/api/v1/tenders/{id}/positions/{posId}/items", d.boqH.GetBoqItems)
		// Смета тендера целиком — то, что видит инженер на странице позиций:
		// шапка, позиции с итогами и КП, строки с названиями/ценами. Маршруты
		// сняты с JWT-группы (chi не ругается на дубль, а побеждает поздняя
		// регистрация — ключ остался бы за дверью). Только чтение.
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "id")).
			Get("/api/v1/tenders/{id}/overview", d.tenderH.GetTenderOverview)
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "id")).
			Get("/api/v1/tenders/{id}/positions/with-costs", d.positionCostsH.GetPositionsWithCosts)
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "id")).
			Get("/api/v1/tenders/{id}/boq-items-full", d.positionH.ListBoqItemsFullByTender)
		r.With(middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersRead, d.tenderOfPosition)).
			Get("/api/v1/positions/{id}/boq-items-full", d.positionH.ListBoqItemsFullByPosition)
		// Одна строка с ETag — нужен для If-Match при PATCH.
		r.With(middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersRead, d.tenderOfItem)).
			Get("/api/v1/items/{id}", d.boqH.GetBoqItem)

		// Запись строк BOQ по ключу — область tenders:write. Хендлеры общие с
		// UI; ключ действует от имени выпустившего пользователя. Там, где id
		// тендера в URL нет, его резолвит гейт по строке/позиции в БД.
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeTendersWrite, "id")).
			Post("/api/v1/tenders/{id}/positions/{posId}/items", d.boqWH.CreateBoqItem)
		r.With(middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersWrite, d.tenderOfItem)).
			Patch("/api/v1/items/{id}", d.boqWH.UpdateBoqItem)
		r.With(middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersWrite, d.tenderOfPosition)).
			Post("/api/v1/positions/{id}/recompute-totals", d.positionWH.RecomputePositionTotals)
		registerPositionFieldsRoute(r, d.positionWH, d.tenderOfPosition)

		// Проверка данных по ключу (конвейер проверки, этап 6). Хендлеры общие с
		// UI; человек с JWT проходит гейт без ограничений. Маршруты сняты с
		// JWT-группы — у chi побеждает поздняя регистрация.
		readV := middleware.RequireAPIKeyScope(apikey.ScopeVerificationRead, "id")
		writeV := middleware.RequireAPIKeyScope(apikey.ScopeVerificationWrite, "id")
		r.With(readV).Get("/api/v1/tenders/{id}/quality", d.qualityH.GetReport)
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeVerificationRead, "")).
			Get("/api/v1/quality/rules", d.qualityH.GetRules)
		r.With(readV).Get("/api/v1/tenders/{id}/verification/sections", d.verifSectionsH.GetSections)
		r.With(readV).Get("/api/v1/tenders/{id}/cost-benchmarks", d.costBenchmarkH.GetReport)
		r.With(middleware.RequireAPIKeyScope(apikey.ScopeVerificationRead, "")).
			Get("/api/v1/benchmark-ranges", d.costBenchmarkH.GetRanges)
		r.With(readV).Get("/api/v1/tenders/{id}/brief", d.costBenchmarkH.GetBrief)

		r.With(writeV).Post("/api/v1/tenders/{id}/quality/verdict", d.qualityH.PostVerdict)
		r.With(writeV).Post("/api/v1/tenders/{id}/quality/verdicts", d.qualityH.PostVerdicts)
		r.With(writeV).Post("/api/v1/tenders/{id}/quality/checkpoint", d.qualityH.PostCheckpoint)
		r.With(writeV).Post("/api/v1/tenders/{id}/verification/sections/mark", d.verifSectionsH.PostMark)
		r.With(writeV).Post("/api/v1/tenders/{id}/verification/sections/unmark", d.verifSectionsH.PostUnmark)
		r.With(writeV).Put("/api/v1/tenders/{id}/brief", d.costBenchmarkH.PutBrief)
		registerVerificationAIRoutes(r, d.verifAIH)

		registerNomenclatureRoutes(r, d.nomenclatureEnsureH)
		registerAutopriceRoutes(r, d)

		registerRegistryBotRoutes(r, d.registryBotH)
		registerVerificationBotRoutes(r, d.verifBotH)
	})
}

// registerNomenclatureRoutes — справочник наименований: найти или создать имя
// работы/материала (авторасценка). Справочник общий, не тендерный: id тендера
// в URL нет, гейт проверяет только область nomenclature:write.
func registerNomenclatureRoutes(r chi.Router, h *handlers.NomenclatureEnsureHandler) {
	r.With(middleware.RequireAPIKeyScope(apikey.ScopeNomenclatureWrite, "")).
		Post("/api/v1/nomenclature/ensure", h.Ensure)
}

// registerPositionFieldsRoute — PATCH полей позиции: человеку с JWT — все поля
// как раньше; ключу с областью tenders:write — только manual_volume в тендере
// с прогоном авторасценки (проверяет хендлер, см. positions_write_machine.go).
func registerPositionFieldsRoute(r chi.Router, h *handlers.PositionWriteHandler, tenderOfPosition middleware.TenderResolver) {
	r.With(middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersWrite, tenderOfPosition)).
		Patch("/api/v1/positions/{id}/fields", h.UpdatePositionFields)
}

// registerAutopriceRoutes — подтверждение авторасценки (тест): машинная часть
// (создать прогон, загрузить карточку позиции, прочитать прогоны и карточки)
// доступна и по ключу с областью tenders:read/write, и по JWT. Остальные
// маршруты авторасценки (карточка позиции, правка, действия, список тендеров)
// — только JWT, см. routes.go.
func registerAutopriceRoutes(r chi.Router, d *deps) {
	readT := middleware.RequireAPIKeyScope(apikey.ScopeTendersRead, "id")
	writeT := middleware.RequireAPIKeyScope(apikey.ScopeTendersWrite, "id")
	readRun := middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersRead, d.tenderOfAutopriceRun)
	writeRun := middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersWrite, d.tenderOfAutopriceRun)

	r.With(writeT).Post("/api/v1/tenders/{id}/autoprice-runs", d.autopriceH.CreateRun)
	r.With(readT).Get("/api/v1/tenders/{id}/autoprice-runs", d.autopriceH.ListRuns)
	r.With(writeRun).Put("/api/v1/autoprice-runs/{sid}/positions/{posId}/review", d.autopriceH.PutReview)
	r.With(readRun).Get("/api/v1/autoprice-runs/{sid}/reviews", d.autopriceH.ListReviews)
	registerAutopriceBulkRoute(r, d.autopriceBulkH, d.tenderOfAutopriceRun)
}

// registerAutopriceBulkRoute — пакетная запись строк BOQ прогона авторасценки
// (заменяет по одному POST .../items + PUT .../review на каждую строку).
// Область tenders:write; тендер для ограничения ключа — тендер прогона.
func registerAutopriceBulkRoute(r chi.Router, h *handlers.AutopriceBulkHandler, tenderOfRun middleware.TenderResolver) {
	writeRun := middleware.RequireAPIKeyScopeResolved(apikey.ScopeTendersWrite, tenderOfRun)
	r.With(writeRun).Post("/api/v1/autoprice-runs/{sid}/items:bulk", h.PostBulk)
}

// registerVerificationAIRoutes — ИИ-разбор находок: оценки — чтение, запуск
// серверного разбора и приём внешних оценок (скрипт на офисном ПК) — действия
// проверяющего (verification:write).
func registerVerificationAIRoutes(r chi.Router, h *handlers.VerificationAIHandler) {
	readV := middleware.RequireAPIKeyScope(apikey.ScopeVerificationRead, "id")
	writeV := middleware.RequireAPIKeyScope(apikey.ScopeVerificationWrite, "id")
	r.With(readV).Get("/api/v1/tenders/{id}/verification/ai-assessments", h.GetAssessments)
	r.With(writeV).Post("/api/v1/tenders/{id}/verification/ai-assessments", h.PostExternalAssessments)
	r.With(writeV).Post("/api/v1/tenders/{id}/verification/ai-triage", h.PostTriage)
}

// registerRegistryBotRoutes — «Перечень тендеров» для внешнего Telegram-бота
// (api/REGISTRY.md): registry:read — поиск и карточка, registry:write — выдача
// напоминаний и запись в хронологию. Только по ключу. У перечня нет связи с
// тендерами, поэтому ключ, ограниченный списком тендеров, получает 403.
func registerRegistryBotRoutes(r chi.Router, h *handlers.TenderRegistryBotHandler) {
	regRead := middleware.RequireAPIKeyScopeResolved(apikey.ScopeRegistryRead, registryDeniesRestrictedKey)
	regWrite := middleware.RequireAPIKeyScopeResolved(apikey.ScopeRegistryWrite, registryDeniesRestrictedKey)
	r.With(requireAPIKey, regRead).Get("/api/v1/tender-registry/search", h.Search)
	r.With(requireAPIKey, regRead).Get("/api/v1/tender-registry/{id}/card", h.Card)
	r.With(requireAPIKey, regWrite).Post("/api/v1/tender-registry/reminders/claim", h.ClaimReminders)
	r.With(requireAPIKey, regWrite).Post("/api/v1/tender-registry/{id}/chronology", h.AppendChronology)
}

// registerVerificationBotRoutes — бот рассылки замечаний «Проверки данных» для
// внешней программы на офисном ПК (api/VERIFICATION_BOT.md): ретрансляция
// обновлений Telegram, выдача очереди сообщений и итог отправки. Только по
// ключу с областью verification:telegram, без ограничения по тендерам.
func registerVerificationBotRoutes(r chi.Router, h *handlers.VerificationBotHandler) {
	gate := middleware.RequireAPIKeyScopeResolved(apikey.ScopeVerificationTelegram, verificationBotDeniesRestrictedKey)
	r.With(requireAPIKey, gate).Post("/api/v1/verification-bot/updates", h.PostUpdates)
	r.With(requireAPIKey, gate).Post("/api/v1/verification-bot/claim", h.PostClaim)
	r.With(requireAPIKey, gate).Post("/api/v1/verification-bot/notifications/{id}/result", h.PostResult)
}

// requireAPIKey — маршрут только для машинного ключа: людям с JWT он не нужен
// (например, выдача напоминаний чату от их имени).
func requireAPIKey(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if middleware.APIKeyFromContext(r.Context()) == nil {
			apierr.ArchiveProblem(http.StatusForbidden, "API_KEY_REQUIRED",
				"Маршрут доступен только по машинному ключу (заголовок X-API-Key).", nil).Render(w)
			return
		}
		next.ServeHTTP(w, r)
	})
}
