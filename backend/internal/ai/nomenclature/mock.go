package nomenclature

import (
	"context"
	"sync"
)

// MockProvider — тестовая реализация (§3.2): скриптованные ответы +
// фиксация запросов (для тестов data-minimization и дедупликации).
// Используется unit/integration-тестами; сеть не вызывается.
type MockProvider struct {
	mu sync.Mutex

	// Script: row_reference → результат. Отсутствующий ref не возвращается
	// (моделирует пропуск строки провайдером).
	Script map[string]RowResult
	// Err/Status позволяют моделировать timeout/rate limit/unavailable/
	// malformed.
	Err          error
	ForcedStatus string

	Requests []RerankBatchRequest
	Calls    int
}

// Rerank implements NomenclatureReranker.
func (m *MockProvider) Rerank(_ context.Context, req RerankBatchRequest) (RerankBatchResponse, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Calls++
	m.Requests = append(m.Requests, req)
	if m.Err != nil {
		return RerankBatchResponse{Status: ProviderUnavailable}, m.Err
	}
	if m.ForcedStatus != "" && m.ForcedStatus != ProviderAvailable {
		return RerankBatchResponse{Status: m.ForcedStatus}, nil
	}
	resp := RerankBatchResponse{Status: ProviderAvailable, Model: "mock-model"}
	for _, row := range req.Rows {
		if rr, ok := m.Script[row.Row.RowReference]; ok {
			resp.Results = append(resp.Results, rr)
		}
	}
	return resp, nil
}

// SelectTop — helper скриптов: модель выбирает top-1 детерминированного set.
func SelectTop(ref string, topID string, confidence string) RowResult {
	id := topID
	return RowResult{
		RowReference: ref, SelectedCandidateID: &id,
		RankedCandidateIDs: []string{topID},
		Confidence:         confidence,
		Explanation:        "Возможно соответствует: совпадают название и единица.",
	}
}

// AbstainResult — helper скриптов: отказ.
func AbstainResult(ref, reason string) RowResult {
	r := reason
	return RowResult{RowReference: ref, Confidence: ConfidenceAbstain, AbstainReason: &r,
		Explanation: "Возможно соответствия нет: " + reason}
}
