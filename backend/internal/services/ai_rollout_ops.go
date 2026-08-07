package services

import (
	"context"
	"errors"
	"math/big"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/repository"
)

// Операционные действия rollout: пилотная группа, circuit, usage,
// расширенная capability текущего пользователя (§6/§17/§19).

// ─── Pilot users ─────────────────────────────────────────────────────────────

// ListPilot — полный allowlist (только admin; гейт в routes).
func (s *AIAdminService) ListPilot(ctx context.Context) ([]repository.AIPilotUser, error) {
	return s.rollout.ListPilotUsers(ctx, repository.AIFeatureNomenclatureRerank)
}

// AddPilotUser — добавление существующего активного пользователя (§6).
// user_id приходит ТОЛЬКО из admin users API; самодобавление запрещено.
func (s *AIAdminService) AddPilotUser(ctx context.Context, userID string, bulkAllowed bool, expiresAt *time.Time, addedBy string) (*repository.AIPilotUser, error) {
	if userID == addedBy {
		return nil, ErrAIPilotSelfAdd
	}
	p, err := s.rollout.UpsertPilotUser(ctx, repository.AIFeatureNomenclatureRerank, userID, bulkAllowed, expiresAt, addedBy)
	if err != nil {
		if errors.Is(err, repository.ErrAIPilotUserNotFound) {
			return nil, ErrAIPilotUserNotFound
		}
		return nil, err
	}
	log.Info().
		Str("operation", "ai_pilot_user_add").
		Str("provider", "openrouter").
		Msg("pilot user added")
	return p, nil
}

// PatchPilot — изменение membership (лимиты/active/bulk/expiry).
func (s *AIAdminService) PatchPilot(ctx context.Context, userID string, p repository.AIPilotPatch) (*repository.AIPilotUser, error) {
	out, err := s.rollout.PatchPilotUser(ctx, repository.AIFeatureNomenclatureRerank, userID, p)
	if err != nil {
		if errors.Is(err, repository.ErrAIPilotUserNotFound) {
			return nil, ErrAIPilotUserNotFound
		}
		return nil, err
	}
	return out, nil
}

// RemovePilot — немедленное исключение (§6.10): следующий запрос пользователя
// уже не проходит membership-гейт, in-flight ответ отбрасывается stale-check'ом.
func (s *AIAdminService) RemovePilot(ctx context.Context, userID string) error {
	if err := s.rollout.RemovePilotUser(ctx, repository.AIFeatureNomenclatureRerank, userID); err != nil {
		if errors.Is(err, repository.ErrAIPilotUserNotFound) {
			return ErrAIPilotUserNotFound
		}
		return err
	}
	log.Info().
		Str("operation", "ai_pilot_user_remove").
		Str("provider", "openrouter").
		Msg("pilot user removed")
	return nil
}

// ─── Circuit / usage ─────────────────────────────────────────────────────────

// ResetCircuit — админский сброс (§10). Emergency off сильнее: сброс circuit
// НЕ меняет rollout mode.
func (s *AIAdminService) ResetCircuit(ctx context.Context) (*repository.AICircuitState, error) {
	c, err := s.rollout.CircuitReset(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	log.Info().
		Str("operation", "ai_circuit_reset").
		Str("provider", "openrouter").
		Msg("ai circuit manually reset")
	return c, nil
}

// UsageSummary — админская сводка (§18.D).
func (s *AIAdminService) UsageSummary(ctx context.Context) (*repository.AIUsageSummary, error) {
	return s.rollout.GetUsageSummary(ctx, repository.AIFeatureNomenclatureRerank)
}

// Evaluations — история безопасных summaries.
func (s *AIAdminService) Evaluations(ctx context.Context, limit int) ([]repository.AIEvaluationSummary, error) {
	return s.rollout.ListEvaluationSummaries(ctx, repository.AIFeatureNomenclatureRerank, limit)
}

// ─── Extended capability (§17/§19) ───────────────────────────────────────────

// Capability-статусы пользователя.
const (
	AICapRolloutOff         = "rollout_off"
	AICapEvaluationOnly     = "evaluation_only"
	AICapNotAllowed         = "not_allowed"
	AICapAvailable          = "available"
	AICapUserQuotaExhausted = "user_quota_exhausted"
	AICapRowQuotaExhausted  = "row_quota_exhausted"
	AICapBudgetExhausted    = "budget_exhausted"
	// AICapTokenBudgetExhausted — измеримый потолок в токенах (режим proxy_llm,
	// где цены модели неизвестны).
	AICapTokenBudgetExhausted = "token_budget_exhausted"
	AICapKeyLimitExhausted    = "key_limit_exhausted"
	AICapCircuitOpen          = "circuit_open"
	AICapProviderUnavail      = "provider_unavailable"
	AICapRateLimited          = "rate_limited"
)

// AIPilotCapabilityView — безопасное состояние ТЕКУЩЕГО пользователя (§17):
// без allowlist других пользователей, полного ledger, ключа и raw-ошибок.
type AIPilotCapabilityView struct {
	Status                       string `json:"status"`
	RolloutMode                  string `json:"rollout_mode"`
	IsPilot                      bool   `json:"is_pilot"`
	IndividualSuggestionsAllowed bool   `json:"individual_suggestions_allowed"`
	BulkConfirmationAllowed      bool   `json:"bulk_confirmation_allowed"`
	RequestsRemainingToday       int    `json:"requests_remaining_today"`
	RowsRemainingToday           int    `json:"rows_remaining_today"`
	BudgetStatus                 string `json:"budget_status"`   // ok | exhausted | not_set
	ProviderStatus               string `json:"provider_status"` // connected | ...
	ModelLabel                   string `json:"model_label"`
	PromptVersion                string `json:"prompt_version"`
}

// PilotCapability — расширенная capability текущего пользователя.
func (s *AIAdminService) PilotCapability(ctx context.Context, userID string) (*AIPilotCapabilityView, error) {
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, err
	}
	view := &AIPilotCapabilityView{
		RolloutMode:   row.RolloutMode,
		PromptVersion: row.PromptVersion,
		BudgetStatus:  "not_set",
	}
	if row.SelectedModelName != nil {
		view.ModelLabel = *row.SelectedModelName
	} else if row.SelectedModelID != nil {
		view.ModelLabel = *row.SelectedModelID
	}
	conn := s.Status(ctx)
	view.ProviderStatus = conn.Connection

	switch row.RolloutMode {
	case repository.AIRolloutOff:
		view.Status = AICapRolloutOff
		return view, nil
	case repository.AIRolloutEvaluation:
		view.Status = AICapEvaluationOnly
		return view, nil
	}

	// pilot_individual | pilot_bulk: членство server-side.
	member, err := s.rollout.GetActivePilotMembership(ctx, row.FeatureCode, userID)
	if err != nil {
		return nil, err
	}
	if member == nil {
		view.Status = AICapNotAllowed
		return view, nil
	}
	view.IsPilot = true

	reqLimit := row.DailyRequestLimit
	if member.DailyRequestLimitOverride != nil {
		reqLimit = *member.DailyRequestLimitOverride
	}
	rowLimit := row.DailyRowLimit
	if member.DailyRowLimitOverride != nil {
		rowLimit = *member.DailyRowLimitOverride
	}
	quota, err := s.rollout.GetUserQuotaState(ctx, row.FeatureCode, userID)
	if err != nil {
		return nil, err
	}
	view.RequestsRemainingToday = maxInt0(reqLimit - quota.RequestsUsedToday)
	view.RowsRemainingToday = maxInt0(rowLimit - quota.RowsUsedToday)

	usage, err := s.rollout.GetUsageSummary(ctx, row.FeatureCode)
	if err != nil {
		return nil, err
	}
	budgetOK := false
	if row.MonthlyBudgetUSD != nil {
		budgetOK, _ = s.budgetHealthy(ctx, row, usage)
		if budgetOK {
			view.BudgetStatus = "ok"
		} else {
			view.BudgetStatus = "exhausted"
		}
	}

	circuit, err := s.rollout.GetCircuit(ctx, row.FeatureCode)
	if err != nil {
		return nil, err
	}

	switch {
	case circuit.State == "open" && (circuit.OpenUntil == nil || circuit.OpenUntil.After(time.Now())):
		view.Status = AICapCircuitOpen
	case view.RequestsRemainingToday <= 0:
		view.Status = AICapUserQuotaExhausted
	case view.RowsRemainingToday <= 0:
		view.Status = AICapRowQuotaExhausted
	case row.MonthlyBudgetUSD == nil || !budgetOK:
		view.Status = AICapBudgetExhausted
	case conn.Connection == "rate_limited":
		view.Status = AICapRateLimited
	case conn.Connection == "unauthorized" || conn.Connection == "unavailable" || conn.Connection == "not_configured" || conn.Connection == "payment_required":
		view.Status = AICapProviderUnavail
	case conn.Key != nil && conn.Key.LimitRemaining != nil && *conn.Key.LimitRemaining <= 0:
		view.Status = AICapKeyLimitExhausted
	default:
		view.Status = AICapAvailable
	}

	view.IndividualSuggestionsAllowed = view.Status == AICapAvailable
	view.BulkConfirmationAllowed = view.Status == AICapAvailable &&
		row.RolloutMode == repository.AIRolloutPilotBulk && member.BulkConfirmationAllowed
	return view, nil
}

func maxInt0(v int) int {
	if v < 0 {
		return 0
	}
	return v
}

// ─── Feedback finalize после успешного импорта (§13) ─────────────────────────

// AIFinalSelection — подтверждённый выбор строки на execute.
type AIFinalSelection struct {
	RowReference string
	CatalogID    string
	Source       string // exact | ai_confirmed | manual
}

// FinalizeSuggestFeedback — записывает outcome для skeleton-строк запроса
// ПОСЛЕ успешного импорта. Ошибка не откатывает импорт (caller превращает её
// в safe warning). Idempotent: уже финализированные строки не перезаписываются.
func (s *AIAdminService) FinalizeSuggestFeedback(ctx context.Context, userID, requestID string, finals []AIFinalSelection) error {
	if requestID == "" {
		return nil
	}
	skeletons, err := s.rollout.ListFeedbackSkeletons(ctx, requestID, userID)
	if err != nil {
		return err
	}
	if len(skeletons) == 0 {
		return nil
	}
	byHash := make(map[string]AIFinalSelection, len(finals))
	for _, f := range finals {
		byHash[AIRowContextHash(requestID, f.RowReference)] = f
	}
	outcomes := make([]repository.AIFeedbackOutcome, 0, len(skeletons))
	for _, sk := range skeletons {
		if sk.Outcome != nil {
			continue // уже финализирована (double-count protection)
		}
		o := repository.AIFeedbackOutcome{
			RequestID:      requestID,
			RowContextHash: sk.RowContextHash,
		}
		if fin, ok := byHash[sk.RowContextHash]; ok {
			id := fin.CatalogID
			o.FinalCatalogID = &id
			o.SelectionSource = fin.Source
			switch {
			case sk.AISelectedCatalogID == nil:
				// AI не дал пригодного выбора — пользователь выбрал вручную.
				o.Outcome = "manual"
			case *sk.AISelectedCatalogID == fin.CatalogID:
				o.Outcome = "accepted"
			default:
				o.Outcome = "changed"
			}
		} else {
			if sk.AISelectedCatalogID == nil {
				o.Outcome = "abstained"
			} else {
				o.Outcome = "unresolved"
			}
		}
		outcomes = append(outcomes, o)
	}
	if err := s.rollout.FinalizeFeedbackOutcomes(ctx, userID, outcomes); err != nil {
		return err
	}
	log.Info().
		Str("operation", "ai_feedback_finalized").
		Str("provider", "openrouter").
		Int("rows", len(outcomes)).
		Msg("ai pilot feedback outcomes recorded")
	return nil
}

// ─── Reservation amount (§8) ─────────────────────────────────────────────────

// computeReservationAmount — консервативная оценка стоимости запроса:
// prompt_price×(rows×500+800) + completion_price×(max_output×батчи), ×2
// safety factor; сверху ограничивается request_max_reserved_cost. Вся
// арифметика — big.Rat (без binary float).
func computeReservationAmount(row *repository.AIFeatureSettings, rowsCount int) string {
	cap_, capOK := new(big.Rat).SetString(row.RequestMaxReservedCost)
	pp, ppOK := ratFromPtr(row.SelectedModelPromptPrice)
	cp, cpOK := ratFromPtr(row.SelectedModelCompletionPrice)
	if !ppOK || !cpOK {
		if capOK {
			return formatRat8(cap_)
		}
		return "0.05"
	}
	batches := (rowsCount + 14) / 15
	if batches < 1 {
		batches = 1
	}
	inputTokens := int64(rowsCount)*500 + 800
	outputTokens := int64(row.MaxOutputTokens) * int64(batches)
	est := new(big.Rat).Mul(pp, new(big.Rat).SetInt64(inputTokens))
	est.Add(est, new(big.Rat).Mul(cp, new(big.Rat).SetInt64(outputTokens)))
	est.Mul(est, big.NewRat(2, 1)) // safety factor
	if capOK && est.Cmp(cap_) > 0 {
		est = cap_
	}
	return formatRat8(est)
}

// computeTokenReservation — оценка токенов запроса той же формулой, что и
// денежный резерв: prompt-часть от числа строк, completion-часть от
// max_output_tokens × число батчей.
//
// В отличие от денежной оценки, эта работает всегда: она не зависит от цен
// модели, которых в режиме proxy_llm не существует. Именно поэтому токенный
// потолок остаётся измеримым там, где USD-бюджет вырождается в счётчик запросов.
func computeTokenReservation(row *repository.AIFeatureSettings, rowsCount int) int64 {
	batches := (rowsCount + 14) / 15
	if batches < 1 {
		batches = 1
	}
	inputTokens := int64(rowsCount)*500 + 800
	outputTokens := int64(row.MaxOutputTokens) * int64(batches)
	return inputTokens + outputTokens
}

func ratFromPtr(s *string) (*big.Rat, bool) {
	if s == nil || *s == "" {
		return nil, false
	}
	return new(big.Rat).SetString(*s)
}

func formatRat8(r *big.Rat) string {
	return r.FloatString(8)
}
