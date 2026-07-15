package services

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	ia "github.com/su10/hubtender/backend/internal/importanalysis"
)

// catalogLoader — батч-загрузка справочника (§4, без N+1).
type catalogLoader interface {
	ListNomenclatureCatalog(ctx context.Context) ([]ainom.CatalogEntry, error)
}

// WithNomenclatureAI — подключение AI-границы этапа 2.2 (reranker может быть
// DisabledProvider — всё остальное продолжает работать).
func (s *SmartImportService) WithNomenclatureAI(
	catalog catalogLoader, reranker ainom.NomenclatureReranker, cfg ainom.Config,
) *SmartImportService {
	s.catalog = catalog
	s.reranker = reranker
	s.aiCfg = cfg
	return s
}

// NomenclatureSelection — подтверждённый пользователем выбор (§13).
type NomenclatureSelection struct {
	RowReference    string `json:"row_reference"`
	CatalogID       string `json:"catalog_id"`
	SelectionSource string `json:"selection_source"` // exact | ai_confirmed | manual
	// Этап 2.3 (§7): «Запомнить для следующих импортов». Default false;
	// backend не доверяет флагу без успешной повторной проверки selection.
	RememberSelection bool `json:"remember_selection"`
}

// InvalidSelectionError — недопустимый source/forged выбор (§13).
type InvalidSelectionError struct{ Reason string }

func (e *InvalidSelectionError) Error() string {
	return "BOQ_IMPORT_INVALID_SELECTION: " + e.Reason
}

// allowedSelectionSources — §13: ai_auto/model_selected/unconfirmed запрещены.
var allowedSelectionSources = map[string]bool{
	"exact": true, "ai_confirmed": true, "manual": true,
}

// ValidateSelections — проверка source-контракта до анализа. remember-флаги
// (этап 2.3 §7) возвращаются отдельно и применяются ТОЛЬКО после успешного
// импорта и повторной валидации самой selection.
func ValidateSelections(selections []NomenclatureSelection) (map[string]string, map[string]string, map[string]bool, error) {
	ids := map[string]string{}
	sources := map[string]string{}
	remember := map[string]bool{}
	for _, sel := range selections {
		if !allowedSelectionSources[sel.SelectionSource] {
			return nil, nil, nil, &InvalidSelectionError{
				Reason: "недопустимый selection_source «" + sel.SelectionSource + "»"}
		}
		if sel.RowReference == "" || sel.CatalogID == "" {
			return nil, nil, nil, &InvalidSelectionError{Reason: "пустой row_reference или catalog_id"}
		}
		ids[sel.RowReference] = sel.CatalogID
		sources[sel.RowReference] = sel.SelectionSource
		if sel.RememberSelection {
			remember[sel.RowReference] = true
		}
	}
	return ids, sources, remember, nil
}

// SuggestNomenclatureResult — ответ suggest (§10). Ничего не сохраняется.
type SuggestNomenclatureResult struct {
	WorkbookFingerprint        string                `json:"workbook_fingerprint"`
	SuggestionSchemaVersion    int                   `json:"suggestion_schema_version"`
	CandidateGenerationVersion string                `json:"candidate_generation_version"`
	PromptVersion              string                `json:"prompt_version"`
	Provider                   ainom.ProviderInfo    `json:"provider"`
	Rows                       []ainom.SuggestionRow `json:"rows"`
}

// SuggestNomenclature — §10: повторный fingerprint + повторный серверный parse
// (preview от frontend не принимается) → unresolved-строки → deterministic
// candidates → optional AI reranking. Read-only: без import session/мутаций.
func (s *SmartImportService) SuggestNomenclature(
	ctx context.Context, tenderID, userID, fileName string, data []byte,
	expectedFingerprint string, opts ia.Options,
	rowRefs []string, candidateLimit int,
) (*SuggestNomenclatureResult, error) {
	if ia.Fingerprint(data) != expectedFingerprint {
		return nil, &FingerprintMismatchError{}
	}
	an, err := s.Analyze(ctx, tenderID, userID, fileName, data, opts)
	if err != nil {
		return nil, err
	}

	// Только строки с nomenclature-блокерами (§10.6); exact unique AI не
	// получает (§2). Явный rowRefs-фильтр сужает выборку.
	wanted := map[string]bool{}
	for _, r := range rowRefs {
		wanted[r] = true
	}
	byRow := map[int]*ia.PreviewRow{}
	for i := range an.Result.PreviewRows {
		byRow[an.Result.PreviewRows[i].ExcelRow] = &an.Result.PreviewRows[i]
	}
	var inputs []ainom.SuggestInput
	seenRefs := map[string]bool{}
	for _, is := range an.Result.Issues {
		if is.Code != "NOMENCLATURE_NOT_FOUND" && is.Code != "NOMENCLATURE_AMBIGUOUS" {
			continue
		}
		ref := is.Sheet + "|" + fmt.Sprintf("%d", is.ExcelRow)
		if seenRefs[ref] {
			continue
		}
		if len(wanted) > 0 && !wanted[ref] {
			continue
		}
		pr := byRow[is.ExcelRow]
		if pr == nil {
			continue
		}
		seenRefs[ref] = true
		inputs = append(inputs, ainom.SuggestInput{
			RowReference: ref, ExcelRow: is.ExcelRow,
			Description: pr.Description, BoqType: pr.BoqType, Unit: pr.Unit,
		})
		if len(inputs) >= ainom.MaxRowsPerSuggestRequest { // §12
			break
		}
	}

	catalog, err := s.catalog.ListNomenclatureCatalog(ctx)
	if err != nil {
		return nil, fmt.Errorf("smartImportService.Suggest: catalog: %w", err)
	}

	reranker := s.reranker
	if reranker == nil {
		reranker = ainom.DisabledProvider{}
	}
	res := ainom.Suggest(ctx, inputs, catalog, reranker, s.aiCfg, candidateLimit)

	// Observability (§23): только безопасные поля, без raw-текста.
	log.Info().
		Str("operation", "boq_import_suggest_nomenclature").
		Str("provider_status", res.Provider.Status).
		Str("model", res.Provider.Model).
		Str("prompt_version", ainom.PromptVersion).
		Str("candidate_generation_version", ainom.CandidateGenerationVersion).
		Int("rows_requested", res.Provider.RowsRequested).
		Int("rows_processed", res.Provider.RowsProcessed).
		Int("rows_abstained", res.Provider.RowsAbstained).
		Str("request_hash", ainom.RequestHash(inputs)).
		Msg("nomenclature suggestions built")

	return &SuggestNomenclatureResult{
		WorkbookFingerprint:        expectedFingerprint,
		SuggestionSchemaVersion:    1,
		CandidateGenerationVersion: ainom.CandidateGenerationVersion,
		PromptVersion:              ainom.PromptVersion,
		Provider:                   res.Provider,
		Rows:                       res.Rows,
	}, nil
}

// NomenclatureProvenance — сводка execute (§14): без новой таблицы.
type NomenclatureProvenance struct {
	ExactMatches           int    `json:"exact_nomenclature_matches"`
	AISuggestionsConfirmed int    `json:"ai_suggestions_confirmed"`
	ManuallySelected       int    `json:"manually_selected_nomenclature"`
	UnresolvedRows         int    `json:"unresolved_nomenclature_rows"`
	CandidateGenVersion    string `json:"candidate_generation_version"`
	PromptVersion          string `json:"prompt_version,omitempty"`
}

// buildProvenance — счётчики из issues + selections (AI при execute НЕ
// вызывается — §13.10).
func buildProvenance(an *ia.Analysis, sources map[string]string) NomenclatureProvenance {
	p := NomenclatureProvenance{CandidateGenVersion: ainom.CandidateGenerationVersion}
	unresolved := map[string]bool{}
	for _, is := range an.Result.Issues {
		switch is.Code {
		case "NOMENCLATURE_EXACT_MATCH":
			p.ExactMatches++
		case "NOMENCLATURE_NOT_FOUND", "NOMENCLATURE_AMBIGUOUS", "NOMENCLATURE_SELECTION_INVALID":
			unresolved[is.Sheet+"|"+fmt.Sprintf("%d", is.ExcelRow)] = true
		}
	}
	for _, src := range sources {
		switch src {
		case "ai_confirmed":
			p.AISuggestionsConfirmed++
			p.PromptVersion = ainom.PromptVersion
		case "manual":
			p.ManuallySelected++
		}
	}
	p.UnresolvedRows = len(unresolved)
	return p
}

// resolveSelectionRefs — §13.8: каждая ссылка selections обязана указывать на
// реальную строку выбранного листа; иное — blocker-ошибка (forged reference).
func resolveSelectionRefs(an *ia.Analysis, sheet string, ids map[string]string) error {
	valid := map[string]bool{}
	for _, pr := range an.Result.PreviewRows {
		valid[sheet+"|"+fmt.Sprintf("%d", pr.ExcelRow)] = true
	}
	for ref := range ids {
		if !valid[ref] {
			return &InvalidSelectionError{Reason: "row_reference «" + ref + "» не найден в файле"}
		}
	}
	return nil
}
