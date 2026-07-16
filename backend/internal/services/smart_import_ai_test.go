package services

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/xuri/excelize/v2"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ─── стабы (§19.44-53: сервисные тесты без БД) ───────────────────────────────

type stubRefsLoader struct{ refs ia.Refs }

func (s stubRefsLoader) LoadRefs(context.Context, string, string) (ia.Refs, error) {
	return s.refs, nil
}

type stubImporter struct {
	last *repository.ImportInput
}

func (s *stubImporter) BulkImport(_ context.Context, in repository.ImportInput) (*repository.ImportResult, error) {
	s.last = &in
	return &repository.ImportResult{}, nil
}

type stubCatalog struct{ entries []ainom.CatalogEntry }

func (s stubCatalog) ListNomenclatureCatalog(context.Context) ([]ainom.CatalogEntry, error) {
	return s.entries, nil
}

func aiTestRefs() ia.Refs {
	return ia.Refs{
		Units: map[string]string{"м2": "м2", "м3": "м3", "шт": "шт", "кг": "кг", "м": "м"},
		WorkNames: map[string][]string{
			"кладка кирпичная": {"w-1"},
		},
		MaterialNames: map[string][]string{
			"кирпич": {"m-1"},
		},
		WorkNameUnits: map[string]string{"w-1": "м2"},
		MatNameUnits:  map[string]string{"m-1": "шт", "m-77": "кг"},
		DetailCats:    map[string][]string{},
		Positions:     map[string]string{"1": "pos-1"},
		PositionLabels: map[string]string{
			"pos-1": "№1",
		},
	}
}

func aiCatalog() []ainom.CatalogEntry {
	return []ainom.CatalogEntry{
		{ID: "m-1", Label: "Кирпич", Type: "material", Unit: "шт"},
		{ID: "m-77", Label: "Кирпич керамический М150", Type: "material", Unit: "кг"},
		{ID: "w-1", Label: "Кладка кирпичная", Type: "work", Unit: "м2"},
	}
}

func buildAITestXLSX(t *testing.T, rows [][]any) []byte {
	t.Helper()
	f := excelize.NewFile()
	_ = f.SetSheetName("Sheet1", "Смета")
	for ri, row := range rows {
		for ci, v := range row {
			cell, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
			if v != nil {
				_ = f.SetCellValue("Смета", cell, v)
			}
		}
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// стандартный workbook: строка 2 — exact work, строка 3 — unresolved material.
func aiTestWorkbook(t *testing.T) []byte {
	return buildAITestXLSX(t, [][]any{
		{"№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена за ед.", "Валюта"},
		{"1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"},
		{"1", "мат", "Кирпич керамический М150", "шт", 5, 50, "RUB"},
	})
}

func newAITestService(importer *stubImporter, reranker ainom.NomenclatureReranker, cfg ainom.Config) *SmartImportService {
	svc := &SmartImportService{refs: stubRefsLoader{refs: aiTestRefs()}, importer: importer}
	return svc.WithNomenclatureAI(stubCatalog{entries: aiCatalog()}, reranker, cfg)
}

// ─── §13: контракт selection_source ──────────────────────────────────────────

// §19.46/§13.4: недопустимые source отклоняются, допустимые — принимаются.
func TestValidateSelectionsSourceContract(t *testing.T) {
	for _, bad := range []string{"ai_auto", "model_selected", "", "auto"} {
		_, _, _, err := ValidateSelections([]NomenclatureSelection{
			{RowReference: "Смета|3", CatalogID: "m-1", SelectionSource: bad}})
		var selErr *InvalidSelectionError
		if !errors.As(err, &selErr) {
			t.Fatalf("source %q должен быть отклонён", bad)
		}
	}
	if _, _, _, err := ValidateSelections([]NomenclatureSelection{
		{RowReference: "", CatalogID: "m-1", SelectionSource: "manual"}}); err == nil {
		t.Fatal("пустой row_reference должен быть отклонён")
	}
	ids, sources, remember, err := ValidateSelections([]NomenclatureSelection{
		{RowReference: "Смета|3", CatalogID: "m-1", SelectionSource: "ai_confirmed"},
		{RowReference: "Смета|4", CatalogID: "m-77", SelectionSource: "manual"},
	})
	if err != nil || ids["Смета|3"] != "m-1" || sources["Смета|4"] != "manual" {
		t.Fatalf("валидные selections отклонены: %v", err)
	}
	if len(remember) != 0 { // §7: remember по умолчанию false
		t.Fatalf("remember default должен быть пуст: %v", remember)
	}
}

// ─── §19.45: без подтверждения строка остаётся blocked ───────────────────────

func TestExecuteUnconfirmedRowStaysBlocked(t *testing.T) {
	imp := &stubImporter{}
	svc := newAITestService(imp, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	_, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, "u-1", nil, "")
	var blocked *BlockersPresentError
	if !errors.As(err, &blocked) {
		t.Fatalf("ожидался BlockersPresentError, получили %v", err)
	}
	if imp.last != nil {
		t.Fatal("импорт не должен запускаться при blockers")
	}
}

// ─── §19.44/49/50/52/53: подтверждённый выбор импортируется, exact остаётся
// exact, финансовые входы не меняются, provenance корректен ──────────────────

func TestExecuteConfirmedSelectionImports(t *testing.T) {
	imp := &stubImporter{}
	mock := &ainom.MockProvider{}
	svc := newAITestService(imp, mock, ainom.Config{Enabled: true})
	data := aiTestWorkbook(t)
	res, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{
			NomenclatureSelections: map[string]string{"Смета|3": "m-1"},
			SelectionSources:       map[string]string{"Смета|3": "ai_confirmed"},
		}, "u-1", nil, "")
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if imp.last == nil || len(imp.last.Items) != 2 {
		t.Fatalf("ожидалось 2 импортируемых строки: %+v", imp.last)
	}
	var work, mat *repository.ImportBoqItem
	for i := range imp.last.Items {
		if imp.last.Items[i].BoqItemType == "раб" {
			work = &imp.last.Items[i]
		} else {
			mat = &imp.last.Items[i]
		}
	}
	// §19.50: exact-строка не тронута selections.
	if work == nil || work.WorkNameID == nil || *work.WorkNameID != "w-1" {
		t.Fatalf("exact work должен сохраниться: %+v", work)
	}
	// §19.44: подтверждённый выбор применён.
	if mat == nil || mat.MaterialNameID == nil || *mat.MaterialNameID != "m-1" {
		t.Fatalf("подтверждённый выбор не применён: %+v", mat)
	}
	// §19.52: selection не меняет финансовые входы (qty/rate из файла).
	if mat.Quantity == nil || *mat.Quantity != 5 || mat.UnitRate == nil || *mat.UnitRate != 50 {
		t.Fatalf("финансовые входы изменились: qty=%v rate=%v", mat.Quantity, mat.UnitRate)
	}
	// §19.51: AI при execute НЕ вызывается даже с enabled config.
	if mock.Calls != 0 {
		t.Fatalf("provider вызван при execute: %d", mock.Calls)
	}
	// §19.53/§14: provenance.
	p := res.Nomenclature
	if p.ExactMatches != 1 || p.AISuggestionsConfirmed != 1 || p.ManuallySelected != 0 || p.UnresolvedRows != 0 {
		t.Fatalf("provenance неверен: %+v", p)
	}
	if p.PromptVersion != ainom.PromptVersion || p.CandidateGenVersion != ainom.CandidateGenerationVersion {
		t.Fatalf("версии provenance неверны: %+v", p)
	}
}

// §19.49: manual-выбор равнозначно принимается; PromptVersion не проставляется.
func TestExecuteManualSelectionAccepted(t *testing.T) {
	imp := &stubImporter{}
	svc := newAITestService(imp, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	res, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{
			NomenclatureSelections: map[string]string{"Смета|3": "m-1"},
			SelectionSources:       map[string]string{"Смета|3": "manual"},
		}, "u-1", nil, "")
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if res.Nomenclature.ManuallySelected != 1 || res.Nomenclature.AISuggestionsConfirmed != 0 {
		t.Fatalf("manual provenance неверен: %+v", res.Nomenclature)
	}
	if res.Nomenclature.PromptVersion != "" {
		t.Fatal("PromptVersion без ai_confirmed должен быть пуст")
	}
}

// ─── §19.46: forged catalog ID → blocker ─────────────────────────────────────

func TestExecuteForgedCatalogIDBlocked(t *testing.T) {
	imp := &stubImporter{}
	svc := newAITestService(imp, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|3": "m-fake-uuid"},
		SelectionSources:       map[string]string{"Смета|3": "ai_confirmed"},
	}
	_, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), opts, "u-1", nil, "")
	var blocked *BlockersPresentError
	if !errors.As(err, &blocked) {
		t.Fatalf("forged ID должен блокировать импорт: %v", err)
	}
	an, err := svc.Analyze(context.Background(), "t-1", "u-1", "smeta.xlsx", data, opts)
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	found := false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_SELECTION_INVALID" {
			found = true
		}
	}
	if !found {
		t.Fatal("ожидался issue NOMENCLATURE_SELECTION_INVALID")
	}
	if imp.last != nil {
		t.Fatal("импорт с forged ID не должен запускаться")
	}
}

// §19.47: выбор несовместимого типа (work ID для материальной строки) → blocker.
func TestExecuteTypeIncompatibleSelectionBlocked(t *testing.T) {
	imp := &stubImporter{}
	svc := newAITestService(imp, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	_, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{
			NomenclatureSelections: map[string]string{"Смета|3": "w-1"}, // work для «мат»
			SelectionSources:       map[string]string{"Смета|3": "manual"},
		}, "u-1", nil, "")
	var blocked *BlockersPresentError
	if !errors.As(err, &blocked) {
		t.Fatalf("несовместимый тип должен блокировать: %v", err)
	}
}

// §19.48: unit-конфликт выбора — warning, импорт продолжается.
func TestExecuteUnitConflictSelectionWarns(t *testing.T) {
	imp := &stubImporter{}
	svc := newAITestService(imp, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|3": "m-77"}, // каталожная единица кг ≠ шт
		SelectionSources:       map[string]string{"Смета|3": "manual"},
	}
	an, err := svc.Analyze(context.Background(), "t-1", "u-1", "smeta.xlsx", data, opts)
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	warned := false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_SELECTION_UNIT_WARNING" && is.Severity == ia.SeverityWarning {
			warned = true
		}
	}
	if !warned {
		t.Fatal("ожидался warning NOMENCLATURE_SELECTION_UNIT_WARNING")
	}
	if _, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), opts, "u-1", nil, ""); err != nil {
		t.Fatalf("unit warning не должен блокировать execute: %v", err)
	}
	if imp.last == nil {
		t.Fatal("импорт должен выполниться")
	}
}

// §13.8: ссылка на строку, которой нет в файле, отклоняется до импорта.
func TestExecuteUnknownRowReferenceRejected(t *testing.T) {
	imp := &stubImporter{}
	svc := newAITestService(imp, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	_, err := svc.Execute(context.Background(), "t-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{
			NomenclatureSelections: map[string]string{"Смета|999": "m-1"},
			SelectionSources:       map[string]string{"Смета|999": "manual"},
		}, "u-1", nil, "")
	var selErr *InvalidSelectionError
	if !errors.As(err, &selErr) {
		t.Fatalf("несуществующий row_reference должен быть отклонён: %v", err)
	}
}

// ─── §10: SuggestNomenclature ────────────────────────────────────────────────

// §19: suggest отдаёт только unresolved-строки; exact в AI не попадает (§2).
func TestSuggestNomenclatureOnlyUnresolvedRows(t *testing.T) {
	svc := newAITestService(&stubImporter{}, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	res, err := svc.SuggestNomenclature(context.Background(), "t-1", "u-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, nil, 0)
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if len(res.Rows) != 1 || res.Rows[0].RowReference != "Смета|3" {
		t.Fatalf("ожидалась одна unresolved-строка Смета|3: %+v", res.Rows)
	}
	if len(res.Rows[0].Candidates) == 0 {
		t.Fatal("deterministic candidates должны быть даже при disabled provider")
	}
	if res.Provider.Status != ainom.ProviderDisabled {
		t.Fatalf("status=%s, want disabled", res.Provider.Status)
	}
	if res.CandidateGenerationVersion != ainom.CandidateGenerationVersion ||
		res.PromptVersion != ainom.PromptVersion || res.SuggestionSchemaVersion != 1 {
		t.Fatalf("версии ответа неверны: %+v", res)
	}
}

// §10.4: fingerprint mismatch — отказ до анализа.
func TestSuggestNomenclatureFingerprintMismatch(t *testing.T) {
	svc := newAITestService(&stubImporter{}, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	_, err := svc.SuggestNomenclature(context.Background(), "t-1", "u-1", "smeta.xlsx", data,
		"deadbeef", ia.Options{}, nil, 0)
	var fp *FingerprintMismatchError
	if !errors.As(err, &fp) {
		t.Fatalf("ожидался FingerprintMismatchError: %v", err)
	}
}

// §10.7: rowRefs-фильтр сужает выборку; несуществующие refs игнорируются.
func TestSuggestNomenclatureRowFilter(t *testing.T) {
	svc := newAITestService(&stubImporter{}, ainom.DisabledProvider{}, ainom.Config{})
	data := aiTestWorkbook(t)
	res, err := svc.SuggestNomenclature(context.Background(), "t-1", "u-1", "smeta.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, []string{"Смета|999"}, 0)
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if len(res.Rows) != 0 {
		t.Fatalf("фильтр по несуществующей строке должен дать 0 строк: %+v", res.Rows)
	}
}
