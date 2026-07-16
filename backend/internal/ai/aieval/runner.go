package aieval

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
)

// Runner (§15): deterministic | mock | live. Провайдер приходит снаружи
// (DisabledProvider / MockProvider / openrouter.Reranker через gateway
// вызывающего) — второго adapter/pipeline здесь НЕТ: используется тот же
// ainom.Suggest, что и в runtime.

// Metrics — безопасные агрегаты (§15). Никаких raw prompts/completions.
type Metrics struct {
	DatasetHash   string `json:"dataset_hash"`
	DatasetSize   int    `json:"dataset_size"`
	EligibleCases int    `json:"eligible_cases"`

	RecallAt20          float64 `json:"candidate_recall_at_20"`
	Top1                float64 `json:"top1"`
	Top3                float64 `json:"top3"`
	AbstentionRate      float64 `json:"abstention_rate"`
	AbstentionCorrect   float64 `json:"abstention_correctness"`
	HighConfCoverage    float64 `json:"high_confidence_coverage"`
	HighConfPrecision   float64 `json:"high_confidence_precision"`
	HighConfFalsePos    int     `json:"high_confidence_false_positives"`
	CriticalFalsePos    int     `json:"critical_hard_negative_false_positives"`
	HallucinatedBlocked int     `json:"hallucinated_id_rejections"`
	UnknownIDAccepted   int     `json:"unknown_id_accepted"`
	InvalidResponses    int     `json:"invalid_responses"`
	TimeoutCount        int     `json:"timeout_count"`
	RateLimitedCount    int     `json:"rate_limited_count"`

	LatencyP50Ms int64 `json:"latency_p50_ms"`
	LatencyP95Ms int64 `json:"latency_p95_ms"`

	PromptTokens     int    `json:"prompt_tokens"`
	CompletionTokens int    `json:"completion_tokens"`
	ProviderCost     string `json:"provider_cost,omitempty"`
	EstimatedCost    string `json:"estimated_cost,omitempty"`
	CostUnit         string `json:"cost_unit"`

	ProviderStatus string `json:"provider_status"`
}

// GateCheck — один gate (§16).
type GateCheck struct {
	Key    string `json:"key"`
	Title  string `json:"title"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

// Result — итог прогона.
type Result struct {
	Mode    string      `json:"mode"`
	Metrics Metrics     `json:"metrics"`
	Gates   []GateCheck `json:"gates"`
	Passed  bool        `json:"gates_passed"`
}

// usageCollector — необязательный сборщик usage/latency от вызывающего
// (live-режим оборачивает провайдера и передаёт агрегаты сюда).
type UsageTotals struct {
	PromptTokens     int
	CompletionTokens int
	ProviderCost     string
	EstimatedCost    string
	LatenciesMs      []int64
}

// Run — выполняет dataset через ainom.Suggest (тот же runtime-контур:
// deterministic retrieval → optional rerank → ValidateRowResult →
// ComputeConfidence) и считает метрики + gates.
func Run(ctx context.Context, ds *Dataset, provider ainom.NomenclatureReranker, cfg ainom.Config, mode string, usage *UsageTotals) *Result {
	inputs := make([]ainom.SuggestInput, 0, len(ds.Cases))
	byKey := map[string]Case{}
	for i, cs := range ds.Cases {
		byKey[cs.Key] = cs
		inputs = append(inputs, ainom.SuggestInput{
			RowReference: cs.Key,
			ExcelRow:     i + 1,
			Description:  cs.Row.Description,
			BoqType:      cs.Row.BoqType,
			Unit:         cs.Row.Unit,
		})
	}

	suggest := ainom.Suggest(ctx, inputs, ds.Catalog, provider, cfg, 20)

	m := Metrics{
		DatasetHash:    ds.Hash(),
		DatasetSize:    len(ds.Cases),
		EligibleCases:  ds.EligibleCases(),
		CostUnit:       "USD (кредиты OpenRouter)",
		ProviderStatus: suggest.Provider.Status,
	}

	var (
		recallHits, top1Hits, top3Hits int
		abstains, correctAbstains      int
		highConf, highConfCorrect      int
		aiParticipated                 bool
	)

	for _, row := range suggest.Rows {
		cs := byKey[row.RowReference]

		// recall@20 — только для eligible.
		if cs.ExpectedID != "" {
			for _, cand := range row.Candidates {
				if cand.ID == cs.ExpectedID {
					recallHits++
					break
				}
			}
		}

		if row.Status == "ai_invalid_response" {
			m.InvalidResponses++
			continue
		}
		if row.Status == "suggested" || row.Status == "abstain" {
			aiParticipated = true
		}

		selected := row.SelectedCandidateID
		isAbstain := selected == nil || row.Status == "abstain" ||
			row.Status == "deterministic_only" || row.Status == "no_candidates"

		if isAbstain {
			abstains++
			if cs.ExpectAbstain || cs.AllowInSet {
				correctAbstains++
			}
			continue
		}

		// Защита от неизвестных ID двойная (adapter + ValidateRowResult);
		// здесь — финальный контроль принятого результата.
		inCatalogSet := false
		for _, cand := range row.Candidates {
			if cand.ID == *selected {
				inCatalogSet = true
				break
			}
		}
		if !inCatalogSet {
			m.UnknownIDAccepted++
			continue
		}

		correct := false
		switch {
		case cs.AllowInSet:
			correct = true // любой ID из set валиден (ambiguous/injection)
		case cs.ExpectAbstain:
			correct = false // выбор там, где обязателен abstain
		default:
			correct = *selected == cs.ExpectedID
		}

		if !cs.ExpectAbstain && !cs.AllowInSet {
			if correct {
				top1Hits++
				top3Hits++
			} else if rank, ok := row.AIRankByID[cs.ExpectedID]; ok && rank <= 3 {
				top3Hits++
			}
		}

		if row.Confidence == ainom.ConfidenceHigh {
			highConf++
			if correct {
				highConfCorrect++
			} else {
				m.HighConfFalsePos++
				if cs.Critical {
					m.CriticalFalsePos++
				}
			}
		}
	}

	eligible := m.EligibleCases
	if eligible > 0 {
		m.RecallAt20 = float64(recallHits) / float64(eligible)
		m.Top1 = float64(top1Hits) / float64(eligible)
		m.Top3 = float64(top3Hits) / float64(eligible)
	}
	if len(suggest.Rows) > 0 {
		m.AbstentionRate = float64(abstains) / float64(len(suggest.Rows))
	}
	if abstains > 0 {
		m.AbstentionCorrect = float64(correctAbstains) / float64(abstains)
	}
	if eligible > 0 {
		m.HighConfCoverage = float64(highConf) / float64(eligible)
	}
	if highConf > 0 {
		m.HighConfPrecision = float64(highConfCorrect) / float64(highConf)
	}

	// Провайдерные сбои по статусу оркестратора.
	switch suggest.Provider.Status {
	case ainom.ProviderTimeout:
		m.TimeoutCount++
	case ainom.ProviderRateLimited:
		m.RateLimitedCount++
	case ainom.ProviderInvalidResponse:
		m.InvalidResponses++
	}

	if usage != nil {
		m.PromptTokens = usage.PromptTokens
		m.CompletionTokens = usage.CompletionTokens
		m.ProviderCost = usage.ProviderCost
		m.EstimatedCost = usage.EstimatedCost
		if len(usage.LatenciesMs) > 0 {
			sorted := append([]int64(nil), usage.LatenciesMs...)
			sort.Slice(sorted, func(a, b int) bool { return sorted[a] < sorted[b] })
			m.LatencyP50Ms = sorted[len(sorted)/2]
			p95 := (len(sorted)*95 + 99) / 100
			if p95 > 0 {
				p95--
			}
			m.LatencyP95Ms = sorted[p95]
		}
	}

	res := &Result{Mode: mode, Metrics: m}
	res.Gates, res.Passed = EvaluateGates(&m, mode, aiParticipated)
	return res
}

// EvaluateGates — §16: непонижаемые safety gates + safe defaults для
// pilot_individual. Числовые пороги критических гейтов НЕ настраиваются.
func EvaluateGates(m *Metrics, mode string, aiParticipated bool) ([]GateCheck, bool) {
	var gates []GateCheck
	add := func(key, title string, passed bool, detail string) {
		gates = append(gates, GateCheck{Key: key, Title: title, Passed: passed, Detail: detail})
	}

	add("critical_fp_zero", "Critical hard-negative high-conf FP = 0",
		m.CriticalFalsePos == 0, fmt.Sprintf("%d", m.CriticalFalsePos))
	add("unknown_id_zero", "Unknown catalog ID accepted = 0",
		m.UnknownIDAccepted == 0, fmt.Sprintf("%d", m.UnknownIDAccepted))
	add("dataset_min", "Eligible cases ≥ 15",
		m.EligibleCases >= 15, fmt.Sprintf("%d", m.EligibleCases))
	add("provider_ok", "Провайдер отвечал (без timeout/rate-limit/invalid)",
		m.ProviderStatus == ainom.ProviderAvailable && m.TimeoutCount == 0 &&
			m.RateLimitedCount == 0, m.ProviderStatus)
	add("invalid_zero", "Invalid responses = 0 (synthetic suite)",
		m.InvalidResponses == 0, fmt.Sprintf("%d", m.InvalidResponses))
	add("ai_participated", "AI реально участвовал в rerank",
		aiParticipated, "")
	add("top3", "Top-3 ≥ 85%",
		m.Top3 >= 0.85, fmt.Sprintf("%.0f%%", m.Top3*100))
	add("recall", "Recall@20 = 100% (retrieval находит правильный ID)",
		m.RecallAt20 >= 1.0, fmt.Sprintf("%.0f%%", m.RecallAt20*100))

	passed := true
	for _, g := range gates {
		if !g.Passed {
			passed = false
		}
	}
	// Deterministic-режим не может пройти live-gate по построению.
	if mode == "deterministic" {
		passed = false
	}
	return gates, passed
}

// MetricsJSON — сериализация метрик для summary.
func (r *Result) MetricsJSON() json.RawMessage {
	raw, _ := json.Marshal(r.Metrics)
	return raw
}

// GatesJSON — сериализация gate-деталей.
func (r *Result) GatesJSON() json.RawMessage {
	raw, _ := json.Marshal(r.Gates)
	return raw
}

// Elapsed — вспомогательный таймер для CLI.
func Elapsed(start time.Time) int64 { return time.Since(start).Milliseconds() }
