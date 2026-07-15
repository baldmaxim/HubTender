package nomenclature

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
)

// SuggestionRow — итог по строке для API (§10).
type SuggestionRow struct {
	RowReference        string         `json:"row_reference"`
	ExcelRow            int            `json:"excel_row"`
	SourceDescription   string         `json:"source_description"`
	SourceType          string         `json:"source_type"`
	SourceUnit          string         `json:"source_unit,omitempty"`
	Status              string         `json:"status"` // suggested | abstain | no_candidates | ai_invalid_response | deterministic_only
	Confidence          string         `json:"confidence"`
	SelectedCandidateID *string        `json:"selected_candidate_id"`
	Explanation         string         `json:"explanation,omitempty"`
	AbstainReason       string         `json:"abstain_reason,omitempty"`
	MatchedFeatures     []string       `json:"matched_features,omitempty"`
	ConflictingFeatures []string       `json:"conflicting_features,omitempty"`
	Candidates          []Candidate    `json:"candidates"`
	AIRankByID          map[string]int `json:"ai_rank_by_id,omitempty"`
}

// ProviderInfo — безопасные идентификаторы (§10): без секретов/endpoint.
type ProviderInfo struct {
	Status        string `json:"status"`
	Provider      string `json:"provider,omitempty"`
	Model         string `json:"model,omitempty"`
	RowsRequested int    `json:"rows_requested"`
	RowsProcessed int    `json:"rows_processed"`
	RowsAbstained int    `json:"rows_abstained"`
}

// SuggestInput — одна unresolved-строка на входе оркестратора.
type SuggestInput struct {
	RowReference string
	ExcelRow     int
	Description  string
	BoqType      string
	Unit         string
}

// SuggestResult — итог Suggest.
type SuggestResult struct {
	Provider ProviderInfo    `json:"provider"`
	Rows     []SuggestionRow `json:"rows"`
}

// RequestHash — hash для observability (§23): без raw-текста в логах.
func RequestHash(rows []SuggestInput) string {
	var b strings.Builder
	for _, r := range rows {
		b.WriteString(r.RowReference)
		b.WriteString("|")
		b.WriteString(normalizeMatchText(r.Description))
		b.WriteString("\n")
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:8])
}

// Suggest — двухэтапная модель (§2): детерминированный retrieval всегда,
// optional AI reranking батчами с дедупликацией идентичных строк (§12).
// Отказ/сбой провайдера НЕ уничтожает deterministic candidates (§11).
func Suggest(
	ctx context.Context,
	rows []SuggestInput,
	catalog []CatalogEntry,
	provider NomenclatureReranker,
	cfg Config,
	candidateLimit int,
) SuggestResult {
	if candidateLimit <= 0 {
		candidateLimit = DefaultCandidateLimit
	}
	if candidateLimit > MaxCandidateLimit {
		candidateLimit = MaxCandidateLimit
	}

	res := SuggestResult{Provider: ProviderInfo{
		Status: ProviderDisabled, RowsRequested: len(rows),
	}}
	if cfg.Enabled {
		res.Provider.Status = ProviderAvailable
		res.Provider.Provider = cfg.Provider
		res.Provider.Model = cfg.Model
	}

	// Стадия A: deterministic candidates для каждой строки.
	out := make([]SuggestionRow, len(rows))
	type dedupeKey struct{ desc, typ, unit, cands string }
	groups := map[dedupeKey][]int{}
	catalogIndex := NewCatalogIndex(catalog)
	for i, r := range rows {
		cands := catalogIndex.Find(RetrievalQuery{
			Description: r.Description, BoqType: r.BoqType, Unit: r.Unit, Limit: candidateLimit,
		})
		sr := SuggestionRow{
			RowReference: r.RowReference, ExcelRow: r.ExcelRow,
			SourceDescription: r.Description, SourceType: r.BoqType, SourceUnit: r.Unit,
			Candidates: cands, Status: "deterministic_only", Confidence: ConfidenceAbstain,
		}
		if len(cands) == 0 {
			sr.Status = "no_candidates"
			sr.AbstainReason = "Подходящих кандидатов в справочнике не найдено"
		}
		out[i] = sr
		if len(cands) > 0 {
			ids := make([]string, len(cands))
			for j, c := range cands {
				ids[j] = c.ID
			}
			key := dedupeKey{
				desc: normalizeMatchText(r.Description), typ: typeGroup(r.BoqType),
				unit: normalizeMatchText(r.Unit), cands: strings.Join(ids, ","),
			}
			groups[key] = append(groups[key], i)
		}
	}

	if !cfg.Enabled {
		res.Rows = out
		return res
	}

	// Стадия B: AI reranking — один inference на группу идентичных строк.
	groupKeys := make([]dedupeKey, 0, len(groups))
	for k := range groups {
		groupKeys = append(groupKeys, k)
	}
	sort.Slice(groupKeys, func(a, b int) bool {
		if groupKeys[a].desc != groupKeys[b].desc {
			return groupKeys[a].desc < groupKeys[b].desc
		}
		return groupKeys[a].cands < groupKeys[b].cands
	})

	batch := make([]RerankRow, 0, ProviderBatchSize)
	batchGroups := make([]dedupeKey, 0, ProviderBatchSize)
	flush := func() {
		if len(batch) == 0 {
			return
		}
		req := RerankBatchRequest{PromptVersion: cfg.PromptVersion, Rows: batch}
		if req.PromptVersion == "" {
			req.PromptVersion = PromptVersion
		}
		resp, err := provider.Rerank(ctx, req)
		status := resp.Status
		if err != nil {
			status = classifyProviderError(err)
		}
		if status != ProviderAvailable {
			res.Provider.Status = status // §11: partial assistance, candidates остаются
		} else {
			byRef := map[string]RowResult{}
			for _, rr := range resp.Results {
				byRef[rr.RowReference] = rr
			}
			for bi, brow := range batch {
				key := batchGroups[bi]
				rr, ok := byRef[brow.Row.RowReference]
				for _, idx := range groups[key] {
					if !ok {
						out[idx].Status = "ai_invalid_response"
						out[idx].AbstainReason = "AI не вернул результат для строки"
						continue
					}
					rrCopy := rr
					rrCopy.RowReference = out[idx].RowReference // дедуп: тот же результат для идентичной строки
					applyAIResult(&out[idx], rrCopy)
					res.Provider.RowsProcessed++
					if out[idx].Confidence == ConfidenceAbstain {
						res.Provider.RowsAbstained++
					}
				}
			}
		}
		batch = batch[:0]
		batchGroups = batchGroups[:0]
	}

	for _, key := range groupKeys {
		idx := groups[key][0]
		row := rows[idx]
		sr := out[idx]
		cands := make([]CandidateInput, 0, len(sr.Candidates))
		for _, c := range sr.Candidates {
			cands = append(cands, CandidateInput{
				ID: c.ID, Label: c.Label, Type: c.Type, Unit: c.Unit,
				RetrievalScore: c.DeterministicScore, RetrievalReasons: c.RetrievalReasons,
			})
		}
		batch = append(batch, RerankRow{
			// §6: только минимальные данные; финансовых полей в типах нет.
			Row: RowInput{
				RowReference: row.RowReference, Description: row.Description,
				BoqType: row.BoqType, Unit: row.Unit,
			},
			Candidates: cands,
		})
		batchGroups = append(batchGroups, key)
		if len(batch) >= ProviderBatchSize {
			flush()
		}
	}
	flush()

	res.Rows = out
	return res
}

// applyAIResult — валидация ответа (§7/§8) + итоговый confidence (§9).
func applyAIResult(sr *SuggestionRow, rr RowResult) {
	allowed := map[string]bool{}
	for _, c := range sr.Candidates {
		allowed[c.ID] = true
	}
	validated, invalidReason := ValidateRowResult(rr, sr.RowReference, allowed)
	if invalidReason != "" {
		sr.Status = "ai_invalid_response"
		sr.AbstainReason = invalidReason
		return // deterministic candidates остаются доступны
	}
	sr.Explanation = validated.Explanation
	sr.MatchedFeatures = validated.MatchedFeatures
	sr.ConflictingFeatures = validated.ConflictingFeatures
	if len(validated.RankedCandidateIDs) > 0 {
		sr.AIRankByID = map[string]int{}
		for i, id := range validated.RankedCandidateIDs {
			sr.AIRankByID[id] = i + 1
		}
	}
	if validated.SelectedCandidateID == nil || validated.Confidence == ConfidenceAbstain {
		sr.Status = "abstain"
		sr.Confidence = ConfidenceAbstain
		if validated.AbstainReason != nil {
			sr.AbstainReason = *validated.AbstainReason
		}
		if sr.AbstainReason == "" {
			sr.AbstainReason = "Подходящий вариант не определён"
		}
		return
	}
	sr.SelectedCandidateID = validated.SelectedCandidateID
	sr.Status = "suggested"
	sr.Confidence = ComputeConfidence(sr.Candidates, *validated.SelectedCandidateID, validated)
}

func classifyProviderError(err error) string {
	var timeoutErr interface{ Timeout() bool }
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return ProviderTimeout
	case errors.As(err, &timeoutErr) && timeoutErr.Timeout():
		return ProviderTimeout
	case strings.Contains(strings.ToLower(err.Error()), "rate"):
		return ProviderRateLimited
	default:
		return ProviderUnavailable
	}
}

// MarshalProviderRequest — сериализация запроса (для теста data-minimization
// §6: доказывает отсутствие financial/sensitive полей).
func MarshalProviderRequest(req RerankBatchRequest) ([]byte, error) {
	return json.Marshal(req)
}
