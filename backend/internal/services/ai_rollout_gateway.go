package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math/big"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Live provider path (§12/§20): OpenRouterReranker подключается к normal
// suggest ТОЛЬКО через этот gateway. Он выполняет полную предпроверочную
// цепочку (§7), атомарную резервацию, circuit-учёт и stale-response safety.
// Exact/alias/execute сюда не попадают по построению (suggest получает
// только unresolved-строки; execute провайдера не имеет).

// AILiveSession — один suggest-запрос пилотного пользователя.
type AILiveSession struct {
	svc *AIAdminService

	RequestID string
	userID    string

	// Снимок состояния на момент резервации (§20).
	snapMode    string
	snapVersion int
	snapHash    string
	snapModelID string

	settings *repository.AIFeatureSettings
	inner    *openrouter.Reranker

	mu sync.Mutex
	// observedModel — модель, фактически ответившая в этой сессии. В варианте A
	// прокси игнорирует присланный model, поэтому это единственный источник
	// правды о том, что реально отработало.
	observedModel  string
	promptTokens   int
	completionToks int
	providerCost   *big.Rat // сумма usage.cost (exact)
	latencyMs      int64
	failureCode    string
	staleDiscarded bool
	batches        int
}

// aiKeyStatusMaxAge — допустимый возраст кэша /key для fail-safe политики
// (§9): свежее — разрешаем; старше без обновления — live call не выполняем.
const aiKeyStatusMaxAge = 5 * time.Minute

// AcquireLiveSession — предпроверочная цепочка §7 + atomic reservation.
// Возвращает (nil, denialStatus, nil) когда live-вызов не разрешён —
// deterministic/manual путь продолжает работать.
func (s *AIAdminService) AcquireLiveSession(ctx context.Context, userID string, rowsCount, candidatesCount int, requestHash string) (*AILiveSession, string, error) {
	if userID == "" || rowsCount <= 0 {
		return nil, "", nil
	}
	// 1. Rollout mode.
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, "", err
	}
	switch row.RolloutMode {
	case repository.AIRolloutOff:
		return nil, AICapRolloutOff, nil
	case repository.AIRolloutEvaluation:
		return nil, AICapEvaluationOnly, nil
	}
	// 2. Pilot membership (server-side).
	member, err := s.rollout.GetActivePilotMembership(ctx, row.FeatureCode, userID)
	if err != nil {
		return nil, "", err
	}
	if member == nil {
		return nil, AICapNotAllowed, nil
	}
	// 3. Model/config hash current (тест пройден и относится к текущему hash).
	if row.SelectedModelID == nil || !s.client.Configured() {
		return nil, AICapProviderUnavail, nil
	}
	currentHash := s.configHashFor(row, *row.SelectedModelID)
	if row.ModelTestStatus != repository.AITestPassed ||
		row.ModelTestConfigHash == nil || *row.ModelTestConfigHash != currentHash {
		return nil, AICapProviderUnavail, nil
	}
	// Протухший тест = непроверенная модель. В proxy-режиме config hash не
	// пришпиливает модель, поэтому только это ловит её подмену оператором.
	if s.modelTestStale(row) {
		return nil, AICapProviderUnavail, nil
	}
	// 4. Circuit.
	circuit, err := s.rollout.GetCircuit(ctx, row.FeatureCode)
	if err != nil {
		return nil, "", err
	}
	switch circuit.State {
	case "open":
		if circuit.OpenUntil != nil && !circuit.OpenUntil.After(time.Now()) {
			probe, perr := s.rollout.CircuitAllowProbe(ctx, row.FeatureCode)
			if perr != nil {
				return nil, "", perr
			}
			if !probe {
				return nil, AICapCircuitOpen, nil
			}
			// Этот инстанс выиграл half-open probe — продолжаем.
		} else {
			return nil, AICapCircuitOpen, nil
		}
	case "half_open":
		// Probe уже выполняется другим запросом.
		return nil, AICapCircuitOpen, nil
	}
	// 5-6. Квоты + бюджет + 8. reservation — атомарно (advisory lock в repo).
	reqLimit := row.DailyRequestLimit
	if member.DailyRequestLimitOverride != nil {
		reqLimit = *member.DailyRequestLimitOverride
	}
	rowLimit := row.DailyRowLimit
	if member.DailyRowLimitOverride != nil {
		rowLimit = *member.DailyRowLimitOverride
	}
	if row.MonthlyBudgetText == nil {
		return nil, AICapBudgetExhausted, nil
	}
	budgetRat, budgetOK := new(big.Rat).SetString(*row.MonthlyBudgetText)
	if !budgetOK || budgetRat.Sign() <= 0 {
		return nil, AICapBudgetExhausted, nil
	}
	// 7. Key limit gate (§9) ДО резервации: fail-safe при устаревшем кэше.
	amount := computeReservationAmount(row, rowsCount)
	if denial := s.keyLimitGate(ctx, amount); denial != "" {
		return nil, denial, nil
	}
	budget := budgetRat.FloatString(8)
	// Токенный потолок опционален и дополняет денежный, а не заменяет его:
	// денежный остаётся обязательным (fail-closed выше).
	var tokenBudget int64
	if row.MonthlyTokenBudget != nil {
		tokenBudget = *row.MonthlyTokenBudget
	}
	reservation, err := s.rollout.ReserveUsage(ctx, repository.AIReservationInput{
		FeatureCode:        row.FeatureCode,
		UserID:             userID,
		ModelID:            *row.SelectedModelID,
		PromptVersion:      row.PromptVersion,
		ConfigHash:         currentHash,
		RequestHash:        requestHash,
		RowsCount:          rowsCount,
		CandidatesCount:    candidatesCount,
		Amount:             amount,
		DailyRequestLimit:  reqLimit,
		DailyRowLimit:      rowLimit,
		MonthlyBudget:      budget,
		TimeoutSeconds:     row.ReservationTimeoutSeconds,
		MonthlyTokenBudget: tokenBudget,
		TokenReservation:   computeTokenReservation(row, rowsCount),
	})
	if err != nil {
		switch {
		case errors.Is(err, repository.ErrAIUserQuotaExhausted):
			return nil, AICapUserQuotaExhausted, nil
		case errors.Is(err, repository.ErrAIRowQuotaExhausted):
			return nil, AICapRowQuotaExhausted, nil
		case errors.Is(err, repository.ErrAIBudgetExhausted):
			return nil, AICapBudgetExhausted, nil
		case errors.Is(err, repository.ErrAITokenBudgetExhausted):
			return nil, AICapTokenBudgetExhausted, nil
		}
		return nil, "", err
	}

	session := &AILiveSession{
		svc:          s,
		RequestID:    reservation.RequestID,
		userID:       userID,
		snapMode:     row.RolloutMode,
		snapVersion:  row.RolloutConfigVersion,
		snapHash:     currentHash,
		snapModelID:  *row.SelectedModelID,
		settings:     row,
		providerCost: new(big.Rat),
		inner:        openrouter.NewReranker(s.client, s.rerankSettingsFor(row, *row.SelectedModelID)),
	}
	log.Info().
		Str("operation", "ai_live_session_acquired").
		Str("provider", "openrouter").
		Str("model", *row.SelectedModelID).
		Str("rollout_mode", row.RolloutMode).
		Int("rows", rowsCount).
		Str("reservation_amount", amount).
		Msg("live AI session reserved")
	return session, "", nil
}

// keyLimitGate — §9: свежий/достаточно свежий /key; remaining < reservation →
// key_limit_exhausted; статус недоступен и кэш стар → fail-safe отказ.
func (s *AIAdminService) keyLimitGate(ctx context.Context, reservationAmount string) string {
	view := s.Status(ctx) // кэш ≤ keyTTL (5 мин) либо fresh
	if view.CheckedAt == nil || time.Since(*view.CheckedAt) > aiKeyStatusMaxAge {
		return AICapProviderUnavail
	}
	if view.Connection != "connected" {
		switch view.Connection {
		case "rate_limited":
			return AICapRateLimited
		default:
			return AICapProviderUnavail
		}
	}
	// В режиме proxy_llm лимитов ключа не существует: GET /key у прокси нет,
	// бюджетом ключа владеет его оператор. Проверка свежести выше сохраняется,
	// проверка остатка пропускается. Требовать здесь view.Key != nil означало
	// бы provider_unavailable на КАЖДОМ вызове и неработающий пилот навсегда.
	if view.ProviderMode == openrouter.String(openrouter.TransportProxyLLM) {
		return ""
	}
	if view.Key == nil {
		return AICapProviderUnavail
	}
	if view.Key.LimitRemaining != nil {
		remaining := new(big.Rat).SetFloat64(*view.Key.LimitRemaining)
		amount, ok := new(big.Rat).SetString(reservationAmount)
		if remaining == nil || (ok && remaining.Cmp(amount) < 0) {
			return AICapKeyLimitExhausted
		}
	}
	return ""
}

// Config — ainom.Config для Suggest-оркестратора этапа 2.2.
func (ls *AILiveSession) Config() ainom.Config {
	return ainom.Config{
		Enabled:           true,
		Provider:          "openrouter",
		Model:             ls.snapModelID,
		TimeoutSeconds:    ls.settings.RequestTimeoutSeconds,
		MaxConcurrency:    ls.settings.MaxConcurrency,
		MaxRowsPerRequest: ls.settings.MaxRowsPerRequest,
		CandidateLimit:    ls.settings.CandidateLimit,
		PromptVersion:     ls.settings.PromptVersion,
	}
}

// Rerank implements ainom.NomenclatureReranker: провайдер + circuit-учёт +
// stale-response safety (§20) на каждый батч.
func (ls *AILiveSession) Rerank(ctx context.Context, req ainom.RerankBatchRequest) (ainom.RerankBatchResponse, error) {
	callCtx, cancel := context.WithTimeout(ctx, time.Duration(ls.settings.RequestTimeoutSeconds)*time.Second)
	defer cancel()
	start := time.Now()
	resp, usage, err := ls.inner.RerankWithUsage(callCtx, req)
	elapsed := time.Since(start).Milliseconds()

	ls.mu.Lock()
	ls.batches++
	ls.promptTokens += usage.PromptTokens
	ls.completionToks += usage.CompletionTokens
	ls.latencyMs += elapsed
	// Фактическая модель ответа. В варианте A прокси игнорирует присланный
	// model и вправе сменить его без нашего релиза, а config hash содержит
	// константу "proxy" и такой подмены не увидит НИКОГДА. Запрос при этом не
	// проваливаем: ответ валиден и локально перевалидирован — дрейф здесь
	// штатное поведение, автоотключение на нём было бы самонанесённым простоем.
	if resp.Model != "" && resp.Model != ls.observedModel {
		ls.observedModel = resp.Model
		ls.svc.SetProxyObservedModel(resp.Model)
	}
	if usage.Cost != "" {
		if c, ok := new(big.Rat).SetString(usage.Cost.String()); ok {
			ls.providerCost.Add(ls.providerCost, c)
		}
	}
	ls.mu.Unlock()

	if err != nil || resp.Status != ainom.ProviderAvailable {
		code := resp.Status
		if code == "" || code == ainom.ProviderAvailable {
			code = ainom.ProviderUnavailable
		}
		ls.recordCircuitFailure(ctx, code)
		ls.mu.Lock()
		ls.failureCode = code
		ls.mu.Unlock()
		return resp, err
	}

	// Успех провайдера → circuit success.
	if cerr := ls.svc.rollout.CircuitRecordSuccess(ctx, ls.settings.FeatureCode); cerr != nil {
		log.Warn().Err(cerr).Msg("ai circuit success record failed")
	}

	// §20: повторная проверка ПОСЛЕ ответа, ДО возврата suggestions.
	if ls.isStale(ctx) {
		ls.mu.Lock()
		ls.staleDiscarded = true
		ls.mu.Unlock()
		// Валидный ответ провайдера circuit-failure НЕ считается.
		return ainom.RerankBatchResponse{Status: ainom.ProviderUnavailable}, nil
	}
	return resp, nil
}

// isStale — rollout всё ещё разрешает вызов, config не изменился,
// пользователь всё ещё в пилоте.
func (ls *AILiveSession) isStale(ctx context.Context) bool {
	row, err := ls.svc.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return true // fail-safe: не возвращать AI-результат при сомнении
	}
	if row.RolloutMode != repository.AIRolloutPilotIndividual && row.RolloutMode != repository.AIRolloutPilotBulk {
		return true
	}
	if row.RolloutConfigVersion != ls.snapVersion {
		return true
	}
	if row.SelectedModelID == nil || *row.SelectedModelID != ls.snapModelID {
		return true
	}
	if ls.svc.configHashFor(row, *row.SelectedModelID) != ls.snapHash {
		return true
	}
	member, err := ls.svc.rollout.GetActivePilotMembership(ctx, row.FeatureCode, ls.userID)
	if err != nil || member == nil {
		return true
	}
	return false
}

// recordCircuitFailure — §10: timeout/transport/5xx/invalid/429 → failure;
// abstain/low-confidence/user-ошибки сюда не попадают (это валидные ответы).
func (ls *AILiveSession) recordCircuitFailure(ctx context.Context, code string) {
	switch code {
	case ainom.ProviderTimeout, ainom.ProviderUnavailable,
		ainom.ProviderInvalidResponse, ainom.ProviderRateLimited:
	default:
		return
	}
	if _, err := ls.svc.rollout.CircuitRecordFailure(ctx, ls.settings.FeatureCode, code,
		ls.settings.CircuitFailureThreshold, ls.settings.CircuitCooldownSeconds); err != nil {
		log.Warn().Err(err).Msg("ai circuit failure record failed")
	}
}

// AIRowContextHash — детерминированная ссылка строки (без raw text):
// sha256(request_id | row_reference), первые 32 hex-символа.
func AIRowContextHash(requestID, rowReference string) string {
	sum := sha256.Sum256([]byte(requestID + "|" + rowReference))
	return hex.EncodeToString(sum[:16])
}

// Finish — reconciliation ledger + feedback skeletons (§8/§13). Возвращает
// map row_reference → feedback token и итоговый provider outcome.
func (ls *AILiveSession) Finish(ctx context.Context, rows []ainom.SuggestionRow) (map[string]string, string) {
	ls.mu.Lock()
	outcome := "available"
	status := "completed"
	switch {
	case ls.staleDiscarded:
		outcome = "stale_discarded"
	case ls.failureCode != "":
		outcome = ls.failureCode
		status = "failed"
	}
	prompt, completion := ls.promptTokens, ls.completionToks
	latency := ls.latencyMs
	actual := ""
	if ls.providerCost.Sign() > 0 {
		actual = ls.providerCost.FloatString(8)
	}
	observed := ls.observedModel
	ls.mu.Unlock()

	// upstreamID пока не собирается по батчам: заголовки ответа доступны на
	// уровне клиента, а сессия агрегирует несколько вызовов. Пустая строка —
	// корректное «неизвестно», колонка nullable.
	upstreamID := ""

	estimated := ""
	if pp := ls.settings.SelectedModelPromptPrice; pp != nil {
		cpp := ""
		if cp := ls.settings.SelectedModelCompletionPrice; cp != nil {
			cpp = *cp
		}
		if est, ok := openrouter.EstimateCostUSD(*pp, cpp, "", prompt, completion); ok {
			estimated = est
		}
	}

	if err := ls.svc.rollout.ReconcileUsage(ctx, repository.AIUsageOutcome{
		RequestID:          ls.RequestID,
		Status:             status,
		ProviderOutcome:    outcome,
		PromptTokens:       prompt,
		CompletionTokens:   completion,
		TotalTokens:        prompt + completion,
		ActualProviderCost: actual,
		EstimatedCost:      estimated,
		LatencyMs:          int(latency),
		ObservedModel:      observed,
		UpstreamRequestID:  upstreamID,
	}); err != nil {
		log.Warn().Err(err).Str("request_id", ls.RequestID).Msg("ai usage reconcile failed")
	}

	// Feedback skeletons только для строк, где AI реально участвовал.
	tokens := map[string]string{}
	if outcome == "available" {
		skeletons := make([]repository.AIFeedbackSkeleton, 0, len(rows))
		for _, r := range rows {
			if r.Status != "suggested" && r.Status != "abstain" {
				continue
			}
			hash := AIRowContextHash(ls.RequestID, r.RowReference)
			tokens[r.RowReference] = hash
			var detTop *string
			if len(r.Candidates) > 0 {
				id := r.Candidates[0].ID
				detTop = &id
			}
			skeletons = append(skeletons, repository.AIFeedbackSkeleton{
				RequestID:           ls.RequestID,
				UserID:              ls.userID,
				RowContextHash:      hash,
				Confidence:          r.Confidence,
				DeterministicTopID:  detTop,
				AISelectedCatalogID: r.SelectedCandidateID,
			})
		}
		if err := ls.svc.rollout.InsertFeedbackSkeletons(ctx, skeletons); err != nil {
			log.Warn().Err(err).Str("request_id", ls.RequestID).Msg("ai feedback skeletons failed")
		}
	}

	log.Info().
		Str("operation", "ai_live_session_finished").
		Str("provider", "openrouter").
		Str("model", ls.snapModelID).
		Str("outcome", outcome).
		Int("prompt_tokens", prompt).
		Int("completion_tokens", completion).
		Int64("latency_ms", latency).
		Str("cost_source", map[bool]string{true: "provider_reported", false: "catalog_estimate"}[actual != ""]).
		Msg("live AI session finished")
	return tokens, outcome
}

// StaleDiscarded — true, если AI-результат был отброшен stale-safety.
func (ls *AILiveSession) StaleDiscarded() bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.staleDiscarded
}
