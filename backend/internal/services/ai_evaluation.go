package services

import (
	"context"
	"errors"
	"math/big"
	"sync"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/aieval"
	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	"github.com/su10/hubtender/backend/internal/ai/openrouter"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Этап 2.6 (§14-16): evaluation через ЕДИНСТВЕННЫЙ runtime-контур
// (ainom.Suggest + openrouter.Reranker). Live-режим строго гейтится:
// OPENROUTER_LIVE_TEST + key + выбранная протестированная модель +
// rollout mode = evaluation + явное подтверждение стоимости.

// Ошибки evaluation.
var (
	ErrAIEvalLiveGate = errors.New("AI_EVAL_LIVE_GATE_NOT_MET")
	ErrAIEvalMode     = errors.New("AI_EVAL_INVALID_MODE")
)

// WithLiveTestFlag — env-флаг OPENROUTER_LIVE_TEST (передаёт wire; значение
// ключа сюда не попадает).
func (s *AIAdminService) WithLiveTestFlag(enabled bool) *AIAdminService {
	s.liveTestEnabled = enabled
	return s
}

// evalUsageReranker — обёртка live-провайдера: собирает usage/latency для
// метрик (§15). Второго pipeline нет — внутри тот же openrouter.Reranker.
type evalUsageReranker struct {
	inner  *openrouter.Reranker
	mu     sync.Mutex
	totals aieval.UsageTotals
	cost   *costAccumulator
}

func (e *evalUsageReranker) Rerank(ctx context.Context, req ainom.RerankBatchRequest) (ainom.RerankBatchResponse, error) {
	start := time.Now()
	resp, usage, err := e.inner.RerankWithUsage(ctx, req)
	elapsed := time.Since(start).Milliseconds()
	e.mu.Lock()
	e.totals.PromptTokens += usage.PromptTokens
	e.totals.CompletionTokens += usage.CompletionTokens
	e.totals.LatenciesMs = append(e.totals.LatenciesMs, elapsed)
	if usage.Cost != "" {
		e.cost.add(usage.Cost.String())
	}
	e.mu.Unlock()
	return resp, err
}

// RunEvaluation — §15/§17: dataset=synthetic; mode deterministic|mock|live.
// Read-only относительно BOQ/aliases; rollout/pilot/модель НЕ изменяются;
// сохраняется только безопасный summary (saveSummary).
func (s *AIAdminService) RunEvaluation(ctx context.Context, mode string, executedBy string, confirmLiveCost, saveSummary bool) (*aieval.Result, *repository.AIEvaluationSummary, error) {
	ds := aieval.SyntheticDataset()
	row, err := s.settings.GetFeatureSettings(ctx, repository.AIFeatureNomenclatureRerank)
	if err != nil {
		return nil, nil, err
	}

	modelID := ""
	if row.SelectedModelID != nil {
		modelID = *row.SelectedModelID
	}
	cfg := ainom.Config{
		Enabled:           true,
		Provider:          "openrouter",
		Model:             modelID,
		TimeoutSeconds:    row.RequestTimeoutSeconds,
		MaxRowsPerRequest: row.MaxRowsPerRequest,
		CandidateLimit:    row.CandidateLimit,
		PromptVersion:     row.PromptVersion,
	}

	var provider ainom.NomenclatureReranker
	var usage *aieval.UsageTotals
	var costAcc *costAccumulator

	switch mode {
	case "deterministic":
		provider = ainom.DisabledProvider{}
		cfg.Enabled = false
	case "mock":
		provider = mockPerfectProvider(ds)
	case "live":
		// §15: все live-гейты одновременно.
		currentHash := ""
		if row.SelectedModelID != nil {
			currentHash = configHashFor(row, *row.SelectedModelID)
		}
		switch {
		case !s.liveTestEnabled,
			!s.client.Configured(),
			row.SelectedModelID == nil,
			row.ModelTestStatus != repository.AITestPassed,
			row.ModelTestConfigHash == nil || *row.ModelTestConfigHash != currentHash,
			row.RolloutMode != repository.AIRolloutEvaluation,
			!confirmLiveCost:
			return nil, nil, ErrAIEvalLiveGate
		}
		costAcc = newCostAccumulator()
		wrapper := &evalUsageReranker{
			inner: openrouter.NewReranker(s.client, rerankSettingsFor(row, modelID)),
			cost:  costAcc,
		}
		provider = wrapper
		usage = &wrapper.totals
	default:
		return nil, nil, ErrAIEvalMode
	}

	evalCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	result := aieval.Run(evalCtx, ds, provider, cfg, mode, usage)

	if usage != nil {
		result.Metrics.ProviderCost = costAcc.String()
		if pp := row.SelectedModelPromptPrice; pp != nil {
			cp := ""
			if c := row.SelectedModelCompletionPrice; c != nil {
				cp = *c
			}
			if est, ok := openrouter.EstimateCostUSD(*pp, cp, "", result.Metrics.PromptTokens, result.Metrics.CompletionTokens); ok {
				result.Metrics.EstimatedCost = est
			}
		}
	}

	var summary *repository.AIEvaluationSummary
	if saveSummary {
		summary = &repository.AIEvaluationSummary{
			FeatureCode:   row.FeatureCode,
			EvalMode:      mode,
			DatasetKind:   ds.Kind,
			DatasetHash:   result.Metrics.DatasetHash,
			DatasetSize:   result.Metrics.DatasetSize,
			ModelID:       modelID,
			PromptVersion: row.PromptVersion,
			ConfigHash:    "",
			Metrics:       result.MetricsJSON(),
			GatesPassed:   result.Passed,
			GateDetails:   result.GatesJSON(),
		}
		if row.SelectedModelID != nil {
			summary.ConfigHash = configHashFor(row, *row.SelectedModelID)
		}
		if executedBy != "" {
			summary.ExecutedBy = &executedBy
		}
		id, ierr := s.rollout.InsertEvaluationSummary(ctx, summary)
		if ierr != nil {
			return result, nil, ierr
		}
		summary.ID = id
		if mode == "live" {
			if err := s.rollout.SetLastLiveEvaluation(ctx, row.FeatureCode, id); err != nil {
				return result, summary, err
			}
		}
	}

	log.Info().
		Str("operation", "ai_evaluation").
		Str("provider", "openrouter").
		Str("mode", mode).
		Str("model", modelID).
		Str("dataset_hash", openrouter.HashPrefix(result.Metrics.DatasetHash)).
		Int("dataset_size", result.Metrics.DatasetSize).
		Bool("gates_passed", result.Passed).
		Int("prompt_tokens", result.Metrics.PromptTokens).
		Int("completion_tokens", result.Metrics.CompletionTokens).
		Str("provider_cost", result.Metrics.ProviderCost).
		Msg("ai evaluation finished")
	return result, summary, nil
}

// costAccumulator — exact-суммирование provider-reported cost (big.Rat,
// без binary float).
type costAccumulator struct {
	mu  sync.Mutex
	sum *big.Rat
}

func newCostAccumulator() *costAccumulator {
	return &costAccumulator{sum: new(big.Rat)}
}

func (c *costAccumulator) add(dec string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if r, ok := new(big.Rat).SetString(dec); ok {
		c.sum.Add(c.sum, r)
	}
}

func (c *costAccumulator) String() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.sum.Sign() == 0 {
		return ""
	}
	return c.sum.FloatString(8)
}

// mockPerfectProvider — scripted-идеальные ответы (проверка контура §15 mock).
func mockPerfectProvider(ds *aieval.Dataset) *ainom.MockProvider {
	script := map[string]ainom.RowResult{}
	for _, cs := range ds.Cases {
		switch {
		case cs.ExpectedID != "":
			script[cs.Key] = ainom.SelectTop(cs.Key, cs.ExpectedID, ainom.ConfidenceHigh)
		default:
			script[cs.Key] = ainom.AbstainResult(cs.Key, "кандидаты не соответствуют строке")
		}
	}
	return &ainom.MockProvider{Script: script}
}
