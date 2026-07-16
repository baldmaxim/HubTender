package services

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	"github.com/su10/hubtender/backend/internal/repository"
)

type importRefsLoader interface {
	LoadRefs(ctx context.Context, tenderID, userID string) (ia.Refs, error)
}

type bulkImporter interface {
	BulkImport(ctx context.Context, in repository.ImportInput) (*repository.ImportResult, error)
}

// FingerprintMismatchError — execute получил другой файл (§4).
type FingerprintMismatchError struct{}

func (e *FingerprintMismatchError) Error() string {
	return "BOQ_IMPORT_FINGERPRINT_MISMATCH: файл изменился между анализом и импортом"
}

// BlockersPresentError — execute при blockers запрещён (§13/§14).
type BlockersPresentError struct {
	Blockers int
	Missing  int
}

func (e *BlockersPresentError) Error() string {
	return fmt.Sprintf("BOQ_IMPORT_BLOCKERS_PRESENT: blocked_rows=%d, required_missing=%d", e.Blockers, e.Missing)
}

// SmartImportService — этап 2.1: analyze/execute поверх СУЩЕСТВУЮЩЕГО
// server-authoritative импорта 0-F1. Второго financial path нет: execute
// строит repository.ImportInput и вызывает ImportBoqService.BulkImport
// (server calc, mismatch report, revision/approval, session/audit).
type SmartImportService struct {
	refs     importRefsLoader
	importer bulkImporter

	// Этап 2.2 (optional AI): каталог + reranker; nil/Disabled — всё работает.
	catalog  catalogLoader
	reranker ainom.NomenclatureReranker
	aiCfg    ainom.Config

	// Этап 2.3 (import memory): nil = память выключена.
	memory importMemoryStore

	// Этап 2.6 (controlled rollout): live-gateway. nil = live AI выключен,
	// deterministic/manual путь работает без изменений.
	aiGateway aiLiveGateway
}

// aiLiveGateway — контракт controlled rollout (§12/§13): выдаёт live-сессию
// ТОЛЬКО allowlisted-пилоту при пройденных гейтах и финализирует feedback
// после успешного импорта.
type aiLiveGateway interface {
	AcquireLiveSession(ctx context.Context, userID string, rowsCount, candidatesCount int, requestHash string) (*AILiveSession, string, error)
	FinalizeSuggestFeedback(ctx context.Context, userID, requestID string, finals []AIFinalSelection) error
}

// WithAIRolloutGateway — подключение gateway этапа 2.6.
func (s *SmartImportService) WithAIRolloutGateway(g aiLiveGateway) *SmartImportService {
	s.aiGateway = g
	return s
}

// NewSmartImportService creates a SmartImportService.
func NewSmartImportService(refs *repository.ImportAnalysisRepo, importer *ImportBoqService) *SmartImportService {
	return &SmartImportService{refs: refs, importer: importer}
}

// Analyze — серверный анализ workbook (§3). Файл не сохраняется. userID
// нужен ТОЛЬКО для загрузки персональной памяти (этап 2.3, aliases).
func (s *SmartImportService) Analyze(
	ctx context.Context, tenderID, userID, fileName string, data []byte, opts ia.Options,
) (*ia.Analysis, error) {
	refs, err := s.refs.LoadRefs(ctx, tenderID, userID)
	if err != nil {
		return nil, fmt.Errorf("smartImportService.Analyze: %w", err)
	}
	wb, err := ia.OpenWorkbook(fileName, data)
	if err != nil {
		return nil, err
	}
	an, err := ia.Analyze(wb, opts, refs)
	if err != nil {
		return nil, err
	}
	return an, nil
}

// ExecuteResult — существующий import report + normalization summary (§14) +
// provenance номенклатуры этапа 2.2.
type ExecuteResult struct {
	Import        *repository.ImportResult `json:"import"`
	Normalization ia.Summary               `json:"normalization"`
	SkippedRows   int                      `json:"skipped_rows"`
	Fingerprint   string                   `json:"workbook_fingerprint"`
	Nomenclature  NomenclatureProvenance   `json:"nomenclature_provenance"`
	// Этап 2.3 (§14): memory-сводка; ошибки памяти НЕ откатывают импорт.
	Memory ExecuteMemory `json:"memory"`
	// Этап 2.6 (§13): safe warning при сбое сохранения pilot-feedback.
	AIFeedbackWarning *string `json:"ai_feedback_warning,omitempty"`
}

// Execute — §4: повторный fingerprint, ПОВТОРНЫЙ серверный parse и анализ той
// же pure-границей (preview/normalized rows от frontend НЕ принимаются),
// затем существующий authoritative import. AI-провайдер здесь НЕ вызывается
// никогда (этап 2.2 §13.10 / этап 2.6 §12); aiRequestID нужен только для
// финализации pilot-feedback ПОСЛЕ успешного импорта.
func (s *SmartImportService) Execute(
	ctx context.Context, tenderID, fileName string, data []byte,
	expectedFingerprint string, opts ia.Options, userID string,
	mem *MemoryRequest, aiRequestID string,
) (*ExecuteResult, error) {
	if ia.Fingerprint(data) != expectedFingerprint {
		return nil, &FingerprintMismatchError{}
	}
	// Этап 2.3: профиль применяется к opts тем же путём, что и в analyze,
	// с повторной серверной валидацией (§8.2).
	opts, memSignature, err := s.prepareExecuteMemory(ctx, tenderID, userID, fileName, data, opts, mem)
	if err != nil {
		return nil, err
	}
	an, err := s.Analyze(ctx, tenderID, userID, fileName, data, opts)
	if err != nil {
		return nil, err
	}
	// §13.8: ссылки selections должны указывать на реальные строки файла.
	if len(opts.NomenclatureSelections) > 0 {
		if err := resolveSelectionRefs(an, an.Result.SelectedSheet,
			opts.NomenclatureSelections); err != nil {
			return nil, err
		}
	}
	if an.Result.Summary.RowsBlocked > 0 || an.Result.Summary.RequiredMappingsMissing > 0 {
		return nil, &BlockersPresentError{
			Blockers: an.Result.Summary.RowsBlocked,
			Missing:  an.Result.Summary.RequiredMappingsMissing,
		}
	}

	items := make([]repository.ImportBoqItem, 0, len(an.Items))
	for i := range an.Items {
		it := an.Items[i]
		row := it.ExcelRow
		items = append(items, repository.ImportBoqItem{
			RowIndex:         &row,
			ClientPositionID: it.PositionID,
			TempID:           it.TempID,
			ParentWorkTempID: it.ParentTempID,
			BoqItemType:      it.BoqItemType,
			WorkNameID:       it.WorkNameID,
			MaterialNameID:   it.MaterialNameID,
			UnitCode:         it.UnitCode,
			Quantity:         it.Quantity,
			BaseQuantity:     it.BaseQuantity,
			ConversionCoeff:  it.ConversionCoeff,
			ConsumptionCoeff: it.ConsumptionCoeff,
			UnitRate:         it.UnitRate,
			CurrencyType:     it.CurrencyType,
			// §5: клиентский total — ТОЛЬКО diagnostic (mismatch report 0-F1);
			// сервер всегда пересчитывает total_amount сам.
			TotalAmount:          it.ClientTotalDiagnostic,
			DeliveryPriceType:    it.DeliveryType,
			DeliveryAmount:       it.DeliveryAmount,
			QuoteLink:            it.QuoteLink,
			DetailCostCategoryID: it.DetailCategoryID,
			Description:          it.Description,
		})
	}

	result, err := s.importer.BulkImport(ctx, repository.ImportInput{
		TenderID: tenderID,
		FileName: fileName,
		UserID:   userID,
		Items:    items,
	})
	if err != nil {
		return nil, fmt.Errorf("smartImportService.Execute: %w", err)
	}
	return &ExecuteResult{
		Import:        result,
		Normalization: an.Result.Summary,
		SkippedRows:   an.Result.Summary.RowsSkipped,
		Fingerprint:   expectedFingerprint,
		Nomenclature:  buildProvenance(an, opts.SelectionSources),
		// §8: memory persistence СТРОГО после успешного импорта; сбой памяти
		// не откатывает BOQ (policy A: warning + memory_saved=false).
		Memory: s.finishExecuteMemory(ctx, userID, an, opts, mem, memSignature),
		// Этап 2.6 (§13): pilot-feedback СТРОГО после успешного импорта;
		// сбой персистенса — только safe warning, импорт не откатывается.
		AIFeedbackWarning: s.finishAIFeedback(ctx, userID, aiRequestID, opts),
	}, nil
}

// finishAIFeedback — финализация outcome'ов пилота (§13). Возвращает safe
// warning при сбое; nil = успех либо feedback не запрашивался.
func (s *SmartImportService) finishAIFeedback(ctx context.Context, userID, aiRequestID string, opts ia.Options) *string {
	if s.aiGateway == nil || aiRequestID == "" {
		return nil
	}
	finals := make([]AIFinalSelection, 0, len(opts.NomenclatureSelections))
	for ref, catalogID := range opts.NomenclatureSelections {
		finals = append(finals, AIFinalSelection{
			RowReference: ref,
			CatalogID:    catalogID,
			Source:       opts.SelectionSources[ref],
		})
	}
	if err := s.aiGateway.FinalizeSuggestFeedback(ctx, userID, aiRequestID, finals); err != nil {
		log.Warn().Err(err).
			Str("operation", "ai_feedback_finalize_failed").
			Msg("pilot feedback persistence failed; import is NOT rolled back")
		w := "Обратная связь пилота не сохранена; импорт выполнен успешно."
		return &w
	}
	return nil
}
