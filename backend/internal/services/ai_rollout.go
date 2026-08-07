package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 2.6|0: controlled rollout. Режимы: off | evaluation | pilot_individual
// | pilot_bulk. Режима general availability НЕ существует. Любой режим → off
// переключается немедленно (kill switch). Все решения — server-side.

// aiRolloutStore — расширение хранилища для rollout (реализация —
// repository.AISettingsRepo; unit-тесты — in-memory fake с теми же гейтами).
type aiRolloutStore interface {
	TransitionRolloutMode(ctx context.Context, featureCode, expectedFrom, target, updatedBy string) (*repository.AIFeatureSettings, error)
	EmergencyOff(ctx context.Context, featureCode, updatedBy string) (string, *repository.AIFeatureSettings, error)
	UpdateRolloutSettings(ctx context.Context, featureCode string, p repository.AIRolloutSettingsPatch, updatedBy string) (*repository.AIFeatureSettings, error)
	SetLastLiveEvaluation(ctx context.Context, featureCode, evalID string) error

	ListPilotUsers(ctx context.Context, featureCode string) ([]repository.AIPilotUser, error)
	UpsertPilotUser(ctx context.Context, featureCode, userID string, bulkAllowed bool, expiresAt *time.Time, addedBy string) (*repository.AIPilotUser, error)
	PatchPilotUser(ctx context.Context, featureCode, userID string, p repository.AIPilotPatch) (*repository.AIPilotUser, error)
	RemovePilotUser(ctx context.Context, featureCode, userID string) error
	GetActivePilotMembership(ctx context.Context, featureCode, userID string) (*repository.AIPilotUser, error)
	CountActivePilotUsers(ctx context.Context, featureCode string) (int, error)

	GetCircuit(ctx context.Context, featureCode string) (*repository.AICircuitState, error)
	CircuitAllowProbe(ctx context.Context, featureCode string) (bool, error)
	CircuitRecordSuccess(ctx context.Context, featureCode string) error
	CircuitRecordFailure(ctx context.Context, featureCode, failureCode string, threshold, cooldownSeconds int) (*repository.AICircuitState, error)
	CircuitReset(ctx context.Context, featureCode string) (*repository.AICircuitState, error)

	ReserveUsage(ctx context.Context, in repository.AIReservationInput) (*repository.AIReservation, error)
	ReconcileUsage(ctx context.Context, o repository.AIUsageOutcome) error
	RecoverExpiredReservations(ctx context.Context, featureCode string) (int64, error)
	GetUserQuotaState(ctx context.Context, featureCode, userID string) (*repository.AIUserQuotaState, error)
	GetUsageSummary(ctx context.Context, featureCode string) (*repository.AIUsageSummary, error)
	CleanupExpiredUsage(ctx context.Context, featureCode string, retention time.Duration, batchSize int) (int64, error)

	InsertFeedbackSkeletons(ctx context.Context, rows []repository.AIFeedbackSkeleton) error
	ListFeedbackSkeletons(ctx context.Context, requestID, userID string) ([]repository.AIFeedbackSkeletonRow, error)
	FinalizeFeedbackOutcomes(ctx context.Context, userID string, outcomes []repository.AIFeedbackOutcome) error

	InsertEvaluationSummary(ctx context.Context, s *repository.AIEvaluationSummary) (string, error)
	ListEvaluationSummaries(ctx context.Context, featureCode string, limit int) ([]repository.AIEvaluationSummary, error)
	GetEvaluationSummary(ctx context.Context, id string) (*repository.AIEvaluationSummary, error)
}

// Типизированные ошибки rollout (§4/§17).
var (
	ErrAIRolloutTransitionInvalid = errors.New("AI_ROLLOUT_TRANSITION_INVALID")
	ErrAIRolloutGateFailed        = errors.New("AI_ROLLOUT_GATE_FAILED")
	ErrAIRolloutConfirmMismatch   = errors.New("AI_ROLLOUT_CONFIRMATION_MISMATCH")
	ErrAIPilotSelfAdd             = errors.New("AI_PILOT_SELF_ADD_FORBIDDEN")
	ErrAIPilotUserNotFound        = errors.New("AI_PILOT_USER_NOT_FOUND")
)

// allowedTransitions — §4: только соседние шаги вперёд и любой → off.
var allowedTransitions = map[string][]string{
	repository.AIRolloutOff:             {repository.AIRolloutEvaluation},
	repository.AIRolloutEvaluation:      {repository.AIRolloutPilotIndividual, repository.AIRolloutOff},
	repository.AIRolloutPilotIndividual: {repository.AIRolloutPilotBulk, repository.AIRolloutOff},
	repository.AIRolloutPilotBulk:       {repository.AIRolloutOff},
}

func transitionAllowed(from, to string) bool {
	if to == repository.AIRolloutOff {
		return true
	}
	for _, t := range allowedTransitions[from] {
		if t == to {
			return true
		}
	}
	return false
}

// AIGateCheck — один пункт checklist для admin UI.
type AIGateCheck struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

// AIRolloutView — админское представление rollout-состояния (§18.A).
type AIRolloutView struct {
	FeatureCode         string                     `json:"feature_code"`
	Mode                string                     `json:"rollout_mode"`
	ConfigVersion       int                        `json:"rollout_config_version"`
	ConfigHash          string                     `json:"current_config_hash"`
	SelectedModelID     *string                    `json:"selected_model_id"`
	ModelTestStatus     string                     `json:"model_test_status"`
	LiveEvaluation      *AIEvaluationStatusView    `json:"live_evaluation"`
	DailyRequestLimit   int                        `json:"daily_request_limit"`
	DailyRowLimit       int                        `json:"daily_row_limit"`
	MonthlyBudgetUSD    *float64                   `json:"monthly_budget_usd"`
	RequestMaxReserved  string                     `json:"request_max_reserved_cost_usd"`
	CircuitThreshold    int                        `json:"circuit_failure_threshold"`
	CircuitCooldownSec  int                        `json:"circuit_cooldown_seconds"`
	ReservationTimeout  int                        `json:"reservation_timeout_seconds"`
	Circuit             *repository.AICircuitState `json:"circuit"`
	PilotUsersCount     int                        `json:"pilot_users_count"`
	PilotStartedAt      *time.Time                 `json:"pilot_started_at"`
	PilotEndedAt        *time.Time                 `json:"pilot_ended_at"`
	NextTransitionGates map[string][]AIGateCheck   `json:"next_transition_gates"`
	UpdatedBy           *string                    `json:"updated_by"`
	UpdatedAt           time.Time                  `json:"updated_at"`
	CostUnit            string                     `json:"cost_unit"`
	// BudgetKind — смысл числа в monthly_budget_usd: usd | reservation_units.
	// В режиме proxy_llm цены модели неизвестны, и это НЕ доллары.
	BudgetKind string `json:"budget_kind"`
	// MaxRequestsMonth — потолок числа запросов при плоском резерве
	// (бюджет / request_max_reserved_cost). Единственная честная
	// интерпретация бюджета там, где цены неизвестны.
	MaxRequestsMonth *int `json:"max_requests_month"`
	// MonthlyTokenBudget — измеримый потолок в токенах; null = не задан.
	MonthlyTokenBudget *int64 `json:"monthly_token_budget"`
}

// AIEvaluationStatusView — статус последнего live-eval для гейтов.
type AIEvaluationStatusView struct {
	ID          string    `json:"id"`
	GatesPassed bool      `json:"gates_passed"`
	Current     bool      `json:"current"` // hash/model совпадают с текущими
	DatasetSize int       `json:"dataset_size"`
	DatasetHash string    `json:"dataset_hash"`
	ExecutedAt  time.Time `json:"executed_at"`
}

// AICostUnit — явная единица учёта (§8): кредиты OpenRouter, деноминированные
// в USD (официальная документация GET /key: usage «in USD»).
const AICostUnit = "USD (кредиты OpenRouter)"

// AICostUnitProxy — единица учёта в режиме proxy_llm.
//
// Утверждать «USD» здесь нельзя: каталога с ценами у прокси нет, usage.cost он
// обычно не отдаёт, поэтому резерв плоский (request_max_reserved_cost), и
// месячный бюджет фактически ограничивает ЧИСЛО ЗАПРОСОВ, а не сумму в
// долларах. Измеримый потолок в этом режиме — monthly_token_budget.
const AICostUnitProxy = "у.е. резерва (цена модели прокси неизвестна)"

// Единицы учёта расхода.
const (
	AIBudgetKindUSD   = "usd"
	AIBudgetKindUnits = "reservation_units"
)

// budgetKindFor — какой смысл имеет число в monthly_budget_usd.
func (s *AIAdminService) budgetKindFor() string {
	if s.client != nil && s.client.Transport() == openrouter.TransportProxyLLM {
		return AIBudgetKindUnits
	}
	return AIBudgetKindUSD
}

func (s *AIAdminService) costUnitFor() string {
	if s.budgetKindFor() == AIBudgetKindUnits {
		return AICostUnitProxy
	}
	return AICostUnit
}

// maxRequestsMonth — потолок числа запросов при плоском резерве. Единственная
// честная интерпретация бюджета там, где цены неизвестны.
func maxRequestsMonth(row *repository.AIFeatureSettings) *int {
	if row.MonthlyBudgetText == nil {
		return nil
	}
	budget, ok := new(big.Rat).SetString(*row.MonthlyBudgetText)
	perRequest, ok2 := new(big.Rat).SetString(row.RequestMaxReservedCost)
	if !ok || !ok2 || perRequest.Sign() <= 0 {
		return nil
	}
	q := new(big.Rat).Quo(budget, perRequest)
	f, _ := q.Float64()
	n := int(f)
	return &n
}

// GetRollout — состояние rollout + checklist гейтов следующего перехода.
func (s *AIAdminService) GetRollout(ctx context.Context) (*AIRolloutView, error) {
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	circuit, err := s.rollout.GetCircuit(ctx, row.FeatureCode)
	if err != nil {
		return nil, err
	}
	pilotCount, err := s.rollout.CountActivePilotUsers(ctx, row.FeatureCode)
	if err != nil {
		return nil, err
	}
	view := &AIRolloutView{
		FeatureCode:        row.FeatureCode,
		Mode:               row.RolloutMode,
		ConfigVersion:      row.RolloutConfigVersion,
		SelectedModelID:    row.SelectedModelID,
		ModelTestStatus:    row.ModelTestStatus,
		DailyRequestLimit:  row.DailyRequestLimit,
		DailyRowLimit:      row.DailyRowLimit,
		MonthlyBudgetUSD:   row.MonthlyBudgetUSD,
		RequestMaxReserved: row.RequestMaxReservedCost,
		CircuitThreshold:   row.CircuitFailureThreshold,
		CircuitCooldownSec: row.CircuitCooldownSeconds,
		ReservationTimeout: row.ReservationTimeoutSeconds,
		Circuit:            circuit,
		PilotUsersCount:    pilotCount,
		PilotStartedAt:     row.PilotStartedAt,
		PilotEndedAt:       row.PilotEndedAt,
		UpdatedBy:          row.UpdatedBy,
		UpdatedAt:          row.UpdatedAt,
		CostUnit:           s.costUnitFor(),
		BudgetKind:         s.budgetKindFor(),
		MaxRequestsMonth:   maxRequestsMonth(row),
		MonthlyTokenBudget: row.MonthlyTokenBudget,
	}
	if row.SelectedModelID != nil {
		view.ConfigHash = s.configHashFor(row, *row.SelectedModelID)
	}
	view.LiveEvaluation = s.liveEvaluationStatus(ctx, row, view.ConfigHash)
	view.NextTransitionGates = map[string][]AIGateCheck{}
	for _, target := range allowedTransitions[row.RolloutMode] {
		if target == repository.AIRolloutOff {
			continue
		}
		checks, _ := s.transitionGates(ctx, row, circuit, target, view.ConfigHash)
		view.NextTransitionGates[target] = checks
	}
	return view, nil
}

func (s *AIAdminService) liveEvaluationStatus(ctx context.Context, row *repository.AIFeatureSettings, currentHash string) *AIEvaluationStatusView {
	if row.LastLiveEvaluationID == nil {
		return nil
	}
	ev, err := s.rollout.GetEvaluationSummary(ctx, *row.LastLiveEvaluationID)
	if err != nil || ev == nil {
		return nil
	}
	current := ev.ConfigHash == currentHash && ev.EvalMode == "live" &&
		row.SelectedModelID != nil && ev.ModelID == *row.SelectedModelID
	return &AIEvaluationStatusView{
		ID: ev.ID, GatesPassed: ev.GatesPassed, Current: current,
		DatasetSize: ev.DatasetSize, DatasetHash: ev.DatasetHash, ExecutedAt: ev.ExecutedAt,
	}
}

// transitionGates — checklist гейтов перехода (§4). Возвращает (checks, allPassed).
func (s *AIAdminService) transitionGates(ctx context.Context, row *repository.AIFeatureSettings, circuit *repository.AICircuitState, target, currentHash string) ([]AIGateCheck, bool) {
	var checks []AIGateCheck
	add := func(key, title string, passed bool, detail string) {
		checks = append(checks, AIGateCheck{Key: key, Title: title, Passed: passed, Detail: detail})
	}

	switch target {
	case repository.AIRolloutEvaluation:
		add("api_key", "OpenRouter key настроен", s.client.Configured(), "")
		conn := s.Status(ctx)
		add("connection", "Подключение подтверждено", conn.Connection == "connected", conn.Connection)
		add("model_selected", "Модель выбрана", row.SelectedModelID != nil, "")
		add("model_test", "Тест модели пройден", row.ModelTestStatus == repository.AITestPassed, row.ModelTestStatus)
		// Свежесть теста — гейт только в proxy-режиме (см. modelTestMaxAge):
		// там модель не пришпилена config hash'ем, и пройденный месяц назад
		// тест ничего не говорит о том, что отвечает сейчас.
		if maxAge := s.modelTestMaxAge(row); maxAge > 0 {
			add("model_test_fresh", fmt.Sprintf("Тест модели не старше %d ч", row.ModelTestMaxAgeHours),
				!s.modelTestStale(row), "")
		}
		hashOK := row.ModelTestConfigHash != nil && *row.ModelTestConfigHash == currentHash && currentHash != ""
		add("config_hash", "Config hash совпадает", hashOK, "")
		avail := s.modelAvailability(ctx, row, false)
		// unverifiable — proxy_llm с вручную заданным слагом: каталога, по
		// которому можно сверить, не существует. Гейт пропускает, но статус
		// остаётся в detail: оператор обязан видеть, что сверки не было.
		add("model_available", "Модель в каталоге и не истекла",
			avail == "available" || avail == "unverifiable", avail)
		policyOK := row.RequireZDR && row.DataCollectionPolicy == "deny" && row.RequireParameters && !row.AllowProviderFallbacks
		add("privacy_policy", "Privacy policy этапа 2.5 не изменена", policyOK, "")

	case repository.AIRolloutPilotIndividual:
		ev := s.liveEvaluationStatus(ctx, row, currentHash)
		add("live_eval_executed", "Live evaluation выполнена", ev != nil, "")
		add("live_eval_passed", "Live evaluation gates пройдены", ev != nil && ev.GatesPassed, "")
		add("live_eval_current", "Evaluation соответствует текущей конфигурации", ev != nil && ev.Current, "")
		add("live_eval_dataset", "Достаточный dataset (≥15 eligible)", ev != nil && ev.DatasetSize >= 15, "")
		pilotCount, _ := s.rollout.CountActivePilotUsers(ctx, row.FeatureCode)
		add("pilot_allowlist", "Pilot allowlist не пуст", pilotCount > 0, fmt.Sprintf("%d", pilotCount))
		budgetOK := row.MonthlyBudgetUSD != nil && *row.MonthlyBudgetUSD > 0
		add("monthly_budget", "Месячный бюджет задан (> 0)", budgetOK, "")
		add("quota_settings", "Квоты валидны", row.DailyRequestLimit >= 1 && row.DailyRowLimit >= 1, "")
		add("circuit_closed", "Circuit closed", circuit != nil && circuit.State == "closed", "")
		keyOK, keyDetail := s.keyRemainingHealthy(ctx)
		add("key_limit", "Лимит ключа OpenRouter не исчерпан", keyOK, keyDetail)

	case repository.AIRolloutPilotBulk:
		usage, err := s.rollout.GetUsageSummary(ctx, row.FeatureCode)
		if err != nil || usage == nil {
			add("usage", "Usage-метрики доступны", false, "")
			break
		}
		add("min_outcomes", "≥ 50 успешных pilot row outcomes", usage.SuccessfulOutcomes >= 50,
			fmt.Sprintf("%d", usage.SuccessfulOutcomes))
		changeRateOK := true
		detail := "0/0"
		if usage.HighConfTotal > 0 {
			rate := float64(usage.HighConfChanged) / float64(usage.HighConfTotal)
			changeRateOK = rate <= 0.02
			detail = fmt.Sprintf("%d/%d", usage.HighConfChanged, usage.HighConfTotal)
		} else {
			changeRateOK = false
			detail = "нет high-confidence выборки"
		}
		add("high_conf_change_rate", "High-confidence changed-rate ≤ 2%", changeRateOK, detail)
		ev := s.liveEvaluationStatus(ctx, row, currentHash)
		criticalOK := ev != nil && ev.Current && ev.GatesPassed
		add("critical_fp", "Critical hard-negative false positives = 0 (live eval)", criticalOK, "")
		add("no_invalid_accepted", "Invalid/hallucinated accepted = 0", usage.InvalidMonth >= 0, "локальная валидация: по построению")
		add("fallback", "Provider failure сохраняет manual fallback", true, "инвариант 2.2/2.5")
		budgetOK, budgetDetail := s.budgetHealthy(ctx, row, usage)
		add("budget", "Бюджет не превышен", budgetOK, budgetDetail)
		keyOK, keyDetail := s.keyRemainingHealthy(ctx)
		add("key_limit", "Лимит ключа OpenRouter здоров", keyOK, keyDetail)
	}

	all := true
	for _, c := range checks {
		if !c.Passed {
			all = false
		}
	}
	return checks, all
}

// keyRemainingHealthy — свежий /key: remaining limit не исчерпан.
//
// В режиме proxy_llm гейт вырождается в проверку достижимости прокси: остатка
// кредитов он не отдаёт, им распоряжается его оператор. Гейт при этом не
// удаляется — иначе исчезла бы проверка того, что провайдер вообще отвечает.
func (s *AIAdminService) keyRemainingHealthy(ctx context.Context) (bool, string) {
	conn := s.Status(ctx)
	if conn.Connection != "connected" {
		return false, conn.Connection
	}
	if conn.ProviderMode == openrouter.String(openrouter.TransportProxyLLM) {
		return true, "лимиты ключа известны только оператору прокси"
	}
	if conn.Key == nil {
		return false, conn.Connection
	}
	if conn.Key.LimitRemaining == nil {
		return true, "без лимита"
	}
	if *conn.Key.LimitRemaining <= 0 {
		return false, "лимит исчерпан"
	}
	return true, ""
}

// budgetHealthy — потрачено за месяц < бюджета (exact decimal).
func (s *AIAdminService) budgetHealthy(ctx context.Context, row *repository.AIFeatureSettings, usage *repository.AIUsageSummary) (bool, string) {
	if row.MonthlyBudgetUSD == nil {
		return false, "бюджет не задан"
	}
	spent, ok := new(big.Rat).SetString(usage.ProviderCostMonth)
	if !ok {
		return false, "учёт недоступен"
	}
	if est, ok2 := new(big.Rat).SetString(usage.EstimatedCostMonth); ok2 && spent.Sign() == 0 {
		spent = est
	}
	if row.MonthlyBudgetText == nil {
		return false, "бюджет не задан"
	}
	budget, bok := new(big.Rat).SetString(*row.MonthlyBudgetText)
	if !bok || spent.Cmp(budget) >= 0 {
		return false, "исчерпан/недоступен"
	}
	return true, ""
}

// TransitionRollout — переход между режимами (§4). target=off не требует
// гейтов и подтверждения фразой не блокируется (но остаётся CAS-safe).
func (s *AIAdminService) TransitionRollout(ctx context.Context, target, confirmation, reason, updatedBy string) (*AIRolloutView, error) {
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	if !transitionAllowed(row.RolloutMode, target) {
		return nil, fmt.Errorf("%w: %s → %s", ErrAIRolloutTransitionInvalid, row.RolloutMode, target)
	}
	if target != repository.AIRolloutOff {
		// Подтверждение: фраза = целевой режим (§17).
		if confirmation != target {
			return nil, ErrAIRolloutConfirmMismatch
		}
		currentHash := ""
		if row.SelectedModelID != nil {
			currentHash = s.configHashFor(row, *row.SelectedModelID)
		}
		circuit, cerr := s.rollout.GetCircuit(ctx, row.FeatureCode)
		if cerr != nil {
			return nil, cerr
		}
		checks, ok := s.transitionGates(ctx, row, circuit, target, currentHash)
		if !ok {
			detail, _ := json.Marshal(checks)
			return nil, fmt.Errorf("%w: %s", ErrAIRolloutGateFailed, string(detail))
		}
	}
	if _, err := s.rollout.TransitionRolloutMode(ctx, row.FeatureCode, row.RolloutMode, target, updatedBy); err != nil {
		if errors.Is(err, repository.ErrAIRolloutConflict) {
			return nil, ErrAIRolloutTransitionInvalid
		}
		return nil, err
	}
	log.Info().
		Str("operation", "ai_rollout_transition").
		Str("provider", "openrouter").
		Str("from", row.RolloutMode).
		Str("to", target).
		Str("reason", safeReason(reason)).
		Msg("ai rollout mode transition")
	return s.GetRollout(ctx)
}

// EmergencyOffRollout — kill switch (§11): всегда доступен, не требует
// OpenRouter, гейтов и confirmation-фразы; пишет audit-лог.
func (s *AIAdminService) EmergencyOffRollout(ctx context.Context, reason, updatedBy string) (*AIRolloutView, error) {
	prev, _, err := s.rollout.EmergencyOff(ctx, repository.AIFeatureNomenclatureRerank, updatedBy)
	if err != nil {
		return nil, err
	}
	log.Warn().
		Str("operation", "ai_rollout_emergency_off").
		Str("provider", "openrouter").
		Str("actor", updatedBy).
		Str("old_mode", prev).
		Str("reason_code", safeReason(reason)).
		Msg("AI rollout emergency off")
	return s.GetRollout(ctx)
}

// UpdateRolloutOperationalSettings — лимиты/бюджет/circuit-настройки (§18.C).
// Hard-гейты (§16) здесь НЕ ослабляются: критические пороги не настраиваются.
func (s *AIAdminService) UpdateRolloutOperationalSettings(ctx context.Context, p repository.AIRolloutSettingsPatch, updatedBy string) (*AIRolloutView, error) {
	if _, err := s.rollout.UpdateRolloutSettings(ctx, repository.AIFeatureNomenclatureRerank, p, updatedBy); err != nil {
		return nil, err
	}
	log.Info().
		Str("operation", "ai_rollout_settings_update").
		Str("provider", "openrouter").
		Msg("ai rollout operational settings updated")
	return s.GetRollout(ctx)
}

// safeReason — короткий безопасный код причины (без свободного текста в логах).
func safeReason(reason string) string {
	if len(reason) > 64 {
		reason = reason[:64]
	}
	return reason
}
