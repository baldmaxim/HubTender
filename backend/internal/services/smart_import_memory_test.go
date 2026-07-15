package services

import (
	"context"
	"errors"
	"testing"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	importmemory "github.com/su10/hubtender/backend/internal/importmemory"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ─── стабы памяти (§17.31-46) ────────────────────────────────────────────────

type stubMemoryStore struct {
	profiles      map[string]importmemory.Profile
	bumpedProfile []string
	bumpedAliases [][]string
	savedEntries  [][]repository.AliasSaveEntry
	createdNames  []string
	updatedIDs    []string
	failPersist   bool
}

func (m *stubMemoryStore) ListProfilesBySignature(_ context.Context, _, sig string) ([]importmemory.Profile, error) {
	var out []importmemory.Profile
	for _, p := range m.profiles {
		if p.HeaderSignature == sig && p.IsActive {
			out = append(out, p)
		}
	}
	return out, nil
}

func (m *stubMemoryStore) GetProfile(_ context.Context, _, id string) (*importmemory.Profile, error) {
	if p, ok := m.profiles[id]; ok {
		return &p, nil
	}
	return nil, repository.ErrImportMemoryNotFound
}

func (m *stubMemoryStore) CreateProfile(_ context.Context, _, name, _ string,
	_ map[string]string, _ importmemory.FixedOptions, _ string, _ int) (string, error) {
	if m.failPersist {
		return "", errors.New("db down")
	}
	m.createdNames = append(m.createdNames, name)
	return "p-new", nil
}

func (m *stubMemoryStore) UpdateProfileContent(_ context.Context, _, id, _ string,
	_ map[string]string, _ importmemory.FixedOptions, _ string, _ int) error {
	if m.failPersist {
		return errors.New("db down")
	}
	m.updatedIDs = append(m.updatedIDs, id)
	return nil
}

func (m *stubMemoryStore) BumpProfileUse(_ context.Context, _, id string) error {
	if m.failPersist {
		return errors.New("db down")
	}
	m.bumpedProfile = append(m.bumpedProfile, id)
	return nil
}

func (m *stubMemoryStore) BumpAliasUse(_ context.Context, _ string, ids []string) error {
	if m.failPersist {
		return errors.New("db down")
	}
	m.bumpedAliases = append(m.bumpedAliases, ids)
	return nil
}

func (m *stubMemoryStore) SaveAliases(_ context.Context, _ string, entries []repository.AliasSaveEntry) (int, error) {
	if m.failPersist {
		return 0, errors.New("db down")
	}
	m.savedEntries = append(m.savedEntries, entries)
	return len(entries), nil
}

type failingImporter struct{}

func (failingImporter) BulkImport(context.Context, repository.ImportInput) (*repository.ImportResult, error) {
	return nil, errors.New("import failed")
}

func testHeaderSignature() string {
	return importmemory.BuildImportHeaderSignature([]string{
		"№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена за ед.", "Валюта"})
}

func usableProfile(id, name string) importmemory.Profile {
	return importmemory.Profile{
		ID: id, Name: name, HeaderSignature: testHeaderSignature(), IsActive: true,
		MappingSchemaVersion: importmemory.MappingSchemaVersion,
		NormalizationVersion: importmemory.NormalizationVersion,
		Mapping:              map[string]string{"quantity": "E"},
	}
}

func newMemTestService(imp bulkImporter, store importMemoryStore, refs ia.Refs) *SmartImportService {
	svc := &SmartImportService{refs: stubRefsLoader{refs: refs}, importer: imp}
	return svc.WithNomenclatureAI(stubCatalog{entries: aiCatalog()}, ainom.DisabledProvider{}, ainom.Config{}).
		WithImportMemory(store)
}

func refsWithAlias(aliases ...importmemory.Alias) ia.Refs {
	refs := aiTestRefs()
	refs.Aliases = importmemory.NewAliasIndex(aliases)
	return refs
}

func memAlias(id, catalogID string) importmemory.Alias {
	return importmemory.Alias{
		ID: id, CatalogKind: importmemory.KindMaterial, CatalogID: catalogID,
		NormalizedSourceText: importmemory.NormalizeSourceText("Кирпич керамический М150"),
		CanonicalBoqType:     "мат", NormalizedUnitCode: "шт",
		NormalizationVersion: importmemory.NormalizationVersion, SavedAt: "2026-07-01", UseCount: 4,
	}
}

// ─── §17.5-9: profile match/apply через AnalyzeWithMemory ────────────────────

func TestAnalyzeWithMemoryProfileFlow(t *testing.T) {
	store := &stubMemoryStore{profiles: map[string]importmemory.Profile{
		"p-1": usableProfile("p-1", "Смета X"),
	}}
	svc := newMemTestService(&stubImporter{}, store, aiTestRefs())
	data := aiTestWorkbook(t)

	// §17.5: один exact-профиль предложен, ничего не применено автоматически.
	an, mem, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if mem.ProfileMatch != importmemory.ProfileMatchOne || len(mem.Profiles) != 1 {
		t.Fatalf("one profile expected: %+v", mem)
	}
	if mem.AppliedProfileID != "" {
		t.Fatal("профиль не должен применяться без явного выбора")
	}
	for _, m := range an.Result.Mapping {
		if m.Source == "saved_profile" {
			t.Fatal("без применения профиля source-метки быть не должно")
		}
	}

	// Явное применение: поле получает source=saved_profile (§5).
	an2, mem2, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "p-1")
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if mem2.AppliedProfileStatus != "applied" || len(mem2.AppliedFields) != 1 {
		t.Fatalf("apply status wrong: %+v", mem2)
	}
	found := false
	for _, m := range an2.Result.Mapping {
		if m.TargetField == "quantity" && m.Source == "saved_profile" && m.SourceColumn == "E" {
			found = true
		}
	}
	if !found {
		t.Fatalf("saved_profile source missing: %+v", an2.Result.Mapping)
	}

	// §17.7/§9.3: чужой/несуществующий профиль → not found.
	if _, _, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "p-ghost"); !errors.Is(err, repository.ErrImportMemoryNotFound) {
		t.Fatalf("foreign profile must be rejected: %v", err)
	}

	// §17.9/§13: старая schema → requires_review, mapping НЕ применяется.
	old := usableProfile("p-old", "Старый")
	old.MappingSchemaVersion = importmemory.MappingSchemaVersion - 1
	store.profiles["p-old"] = old
	_, mem3, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "p-old")
	if err != nil || mem3.AppliedProfileStatus != importmemory.MemoryRequiresReview {
		t.Fatalf("old schema must require review: %+v (%v)", mem3, err)
	}

	// Сигнатура другого файла → signature_mismatch, не применяется.
	other := usableProfile("p-sig", "Другой файл")
	other.HeaderSignature = "deadbeef"
	store.profiles["p-sig"] = other
	_, mem4, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "p-sig")
	if err != nil || mem4.AppliedProfileStatus != "signature_mismatch" {
		t.Fatalf("signature mismatch expected: %+v (%v)", mem4, err)
	}

	// §17.38: analyze не инкрементирует счётчики.
	if len(store.bumpedProfile) != 0 || len(store.bumpedAliases) != 0 {
		t.Fatal("analyze must not bump use counters")
	}
}

// §17.11-12: профиль не обходит required mapping — колонка из профиля,
// отсутствующая в файле, оставляет поле unresolved (blocker сохраняется).
func TestProfileCannotBypassRequiredMapping(t *testing.T) {
	p := usableProfile("p-1", "X")
	p.Mapping = map[string]string{"quantity": "Z"} // нет такой колонки
	store := &stubMemoryStore{profiles: map[string]importmemory.Profile{"p-1": p}}
	svc := newMemTestService(&stubImporter{}, store, aiTestRefs())
	data := aiTestWorkbook(t)
	an, mem, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "p-1")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if mem.AppliedProfileStatus != "applied" {
		t.Fatalf("profile should apply structurally: %+v", mem)
	}
	if an.Result.Summary.RequiredMappingsMissing == 0 {
		t.Fatal("профиль с несуществующей колонкой не должен обходить required mapping")
	}
}

// ─── §17.15/25-27: alias в analyze/execute ───────────────────────────────────

func TestAliasResolvesRowAndBumpsAfterSuccess(t *testing.T) {
	store := &stubMemoryStore{profiles: map[string]importmemory.Profile{}}
	imp := &stubImporter{}
	svc := newMemTestService(imp, store, refsWithAlias(memAlias("a-1", "m-1")))
	data := aiTestWorkbook(t)

	an, _, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	// §17.15: строка разрешена alias'ом, blockers нет.
	if an.Result.Summary.RowsBlocked != 0 {
		t.Fatalf("alias must resolve row: %+v / %+v", an.Result.Summary, an.Result.Issues)
	}
	// §17.27: provenance виден.
	var prov *ia.AliasProvenance
	for i := range an.Result.PreviewRows {
		if an.Result.PreviewRows[i].AliasProvenance != nil {
			prov = an.Result.PreviewRows[i].AliasProvenance
		}
	}
	if prov == nil || prov.AliasID != "a-1" || prov.SourceLabel != "Подтверждено вами ранее" ||
		prov.MatchMethod != "user_approved_alias" {
		t.Fatalf("alias provenance missing: %+v", prov)
	}

	// Execute: импорт с alias-строкой, счётчик after success (§17.37).
	res, err := svc.Execute(context.Background(), "t-1", "s.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, "u-1", nil)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if res.Memory.Nomenclature.ApprovedAliasMatches != 1 {
		t.Fatalf("alias match count: %+v", res.Memory.Nomenclature)
	}
	if len(store.bumpedAliases) != 1 || store.bumpedAliases[0][0] != "a-1" {
		t.Fatalf("alias use must be bumped after success: %+v", store.bumpedAliases)
	}
	// Импортированная строка получила catalog ID из alias.
	var mat *repository.ImportBoqItem
	for i := range imp.last.Items {
		if imp.last.Items[i].BoqItemType == "мат" {
			mat = &imp.last.Items[i]
		}
	}
	if mat == nil || mat.MaterialNameID == nil || *mat.MaterialNameID != "m-1" {
		t.Fatalf("alias target not imported: %+v", mat)
	}
}

// §17.25: exact canonical match выше alias.
func TestExactCanonicalBeatsAlias(t *testing.T) {
	al := memAlias("a-1", "m-77")
	al.NormalizedSourceText = importmemory.NormalizeSourceText("Кирпич") // exact-имя каталога
	al.NormalizedUnitCode = ""
	svc := newMemTestService(&stubImporter{}, &stubMemoryStore{}, refsWithAlias(al))
	data := buildAITestXLSX(t, [][]any{
		{"№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена за ед.", "Валюта"},
		{"1", "мат", "Кирпич", "шт", 5, 50, "RUB"},
	})
	an, _, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	if an.Items[0].MaterialNameID == nil || *an.Items[0].MaterialNameID != "m-1" {
		t.Fatalf("exact canonical must win: %+v", an.Items[0])
	}
	if an.Items[0].AliasID != "" {
		t.Fatal("alias must not be used when exact match exists")
	}
}

// §17.24: конфликт активных aliases → blocker (execute запрещён).
func TestAliasConflictBlocksExecute(t *testing.T) {
	a1, a2 := memAlias("a-1", "m-1"), memAlias("a-2", "m-77")
	a2.NormalizedUnitCode = "" // другая запись, другая цель, совместима
	svc := newMemTestService(&stubImporter{}, &stubMemoryStore{}, refsWithAlias(a1, a2))
	data := aiTestWorkbook(t)
	an, _, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	conflictSeen := false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_ALIAS_CONFLICT" && is.Severity == ia.SeverityBlocker {
			conflictSeen = true
		}
	}
	if !conflictSeen {
		t.Fatalf("alias conflict blocker expected: %+v", an.Result.Issues)
	}
	var blocked *BlockersPresentError
	if _, err := svc.Execute(context.Background(), "t-1", "s.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, "u-1", nil); !errors.As(err, &blocked) {
		t.Fatalf("conflict must block execute: %v", err)
	}
}

// §17.22-23: недоступная цель alias не применяется и не создаёт dangling.
func TestAliasTargetUnavailable(t *testing.T) {
	svc := newMemTestService(&stubImporter{}, &stubMemoryStore{}, refsWithAlias(memAlias("a-1", "m-ghost")))
	data := aiTestWorkbook(t)
	an, _, err := svc.AnalyzeWithMemory(context.Background(), "t-1", "u-1", "s.xlsx", data, ia.Options{}, "")
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	warned, blocked := false, false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_ALIAS_TARGET_UNAVAILABLE" {
			warned = true
		}
		if is.Code == "NOMENCLATURE_NOT_FOUND" {
			blocked = true
		}
	}
	if !warned || !blocked {
		t.Fatalf("unavailable target: warn=%v blocked=%v issues=%+v", warned, blocked, an.Result.Issues)
	}
	if an.Items[0].MaterialNameID != nil && *an.Items[0].MaterialNameID == "m-ghost" {
		t.Fatal("dangling catalog ID must not be produced")
	}
}

// T/§15: alias-разрешённая строка не отправляется AI-провайдеру.
func TestAliasResolvedRowSkipsAI(t *testing.T) {
	mock := &ainom.MockProvider{}
	svc := &SmartImportService{refs: stubRefsLoader{refs: refsWithAlias(memAlias("a-1", "m-1"))}, importer: &stubImporter{}}
	svc = svc.WithNomenclatureAI(stubCatalog{entries: aiCatalog()}, mock, ainom.Config{Enabled: true}).
		WithImportMemory(&stubMemoryStore{})
	data := aiTestWorkbook(t)
	res, err := svc.SuggestNomenclature(context.Background(), "t-1", "u-1", "s.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, nil, 0)
	if err != nil {
		t.Fatalf("suggest: %v", err)
	}
	if len(res.Rows) != 0 {
		t.Fatalf("alias-resolved rows must not reach AI: %+v", res.Rows)
	}
	if mock.Calls != 0 {
		t.Fatalf("provider must not be called: %d", mock.Calls)
	}
}

// ─── §17.31-36,39-42: persistence policy ─────────────────────────────────────

func executeWithSelection(t *testing.T, svc *SmartImportService, data []byte, remember bool, source string, mem *MemoryRequest) (*ExecuteResult, error) {
	t.Helper()
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|3": "m-1"},
		SelectionSources:       map[string]string{"Смета|3": source},
	}
	if mem == nil {
		mem = &MemoryRequest{}
	}
	if remember {
		mem.RememberByRef = map[string]bool{"Смета|3": true}
	}
	return svc.Execute(context.Background(), "t-1", "s.xlsx", data, ia.Fingerprint(data), opts, "u-1", mem)
}

func TestRememberSemantics(t *testing.T) {
	data := aiTestWorkbook(t)

	// §17.32: подтверждено, но remember=false → не сохраняется.
	store := &stubMemoryStore{}
	svc := newMemTestService(&stubImporter{}, store, aiTestRefs())
	res, err := executeWithSelection(t, svc, data, false, "ai_confirmed", nil)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(store.savedEntries) != 0 || res.Memory.Nomenclature.AliasesRequestedToSave != 0 {
		t.Fatalf("remember=false must not save: %+v", res.Memory.Nomenclature)
	}

	// §17.33: ai_confirmed + remember=true → сохраняется после успеха.
	store = &stubMemoryStore{}
	svc = newMemTestService(&stubImporter{}, store, aiTestRefs())
	res, err = executeWithSelection(t, svc, data, true, "ai_confirmed", nil)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(store.savedEntries) != 1 || len(store.savedEntries[0]) != 1 {
		t.Fatalf("alias must be saved: %+v", store.savedEntries)
	}
	e := store.savedEntries[0][0]
	if e.CatalogID != "m-1" || e.CatalogKind != importmemory.KindMaterial ||
		e.CanonicalBoqType != "мат" || e.SourceText == "" {
		t.Fatalf("save entry wrong: %+v", e)
	}
	if res.Memory.Nomenclature.AliasesSaved != 1 || !res.Memory.MemorySaved {
		t.Fatalf("memory summary wrong: %+v", res.Memory)
	}

	// §17.34: manual + remember=true → сохраняется.
	store = &stubMemoryStore{}
	svc = newMemTestService(&stubImporter{}, store, aiTestRefs())
	if _, err := executeWithSelection(t, svc, data, true, "manual", nil); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(store.savedEntries) != 1 {
		t.Fatal("manual remember must save")
	}

	// §17.31: remember=true для строки БЕЗ подтверждённой selection → ничего.
	store = &stubMemoryStore{}
	svc = newMemTestService(&stubImporter{}, store, refsWithAlias(memAlias("a-1", "m-1")))
	mem := &MemoryRequest{RememberByRef: map[string]bool{"Смета|3": true}}
	if _, err := svc.Execute(context.Background(), "t-1", "s.xlsx", data,
		ia.Fingerprint(data), ia.Options{}, "u-1", mem); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(store.savedEntries) != 0 {
		t.Fatal("unconfirmed suggestion must not be remembered")
	}
}

// §17.35-36: неуспешный импорт не создаёт memory.
func TestFailedImportCreatesNoMemory(t *testing.T) {
	store := &stubMemoryStore{profiles: map[string]importmemory.Profile{"p-1": usableProfile("p-1", "X")}}
	svc := newMemTestService(failingImporter{}, store, aiTestRefs())
	data := aiTestWorkbook(t)
	_, err := executeWithSelection(t, svc, data, true, "manual",
		&MemoryRequest{ProfileID: "p-1", SaveAsNew: true, Name: "Новый"})
	if err == nil {
		t.Fatal("import must fail")
	}
	if len(store.savedEntries) != 0 || len(store.createdNames) != 0 ||
		len(store.bumpedProfile) != 0 || len(store.bumpedAliases) != 0 {
		t.Fatalf("failed import must not persist memory: %+v", store)
	}
}

// §17.39-40: сбой памяти не откатывает импорт, возвращает warning.
func TestMemoryFailureDoesNotFailImport(t *testing.T) {
	store := &stubMemoryStore{failPersist: true}
	imp := &stubImporter{}
	svc := newMemTestService(imp, store, aiTestRefs())
	data := aiTestWorkbook(t)
	res, err := executeWithSelection(t, svc, data, true, "manual", nil)
	if err != nil {
		t.Fatalf("import must succeed despite memory failure: %v", err)
	}
	if imp.last == nil || res.Import == nil {
		t.Fatal("import result must be present")
	}
	if res.Memory.MemorySaved {
		t.Fatal("memory_saved must be false")
	}
	if len(res.Memory.Warnings) == 0 || res.Memory.Warnings[0] != "IMPORT_MEMORY_SAVE_FAILED" {
		t.Fatalf("warning expected: %+v", res.Memory.Warnings)
	}
}

// §17.41-42/§9: профиль сохраняется/обновляется только явно; новый без имени
// отклоняется ДО импорта.
func TestProfilePersistenceExplicitOnly(t *testing.T) {
	data := aiTestWorkbook(t)

	// Изменение mapping без update-флага → профиль не обновляется.
	store := &stubMemoryStore{profiles: map[string]importmemory.Profile{"p-1": usableProfile("p-1", "X")}}
	svc := newMemTestService(&stubImporter{}, store, aiTestRefs())
	res, err := executeWithSelection(t, svc, data, false, "manual", &MemoryRequest{ProfileID: "p-1"})
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if len(store.updatedIDs) != 0 || len(store.createdNames) != 0 {
		t.Fatal("profile must not be updated implicitly")
	}
	if !res.Memory.MappingProfile.Applied || len(store.bumpedProfile) != 1 {
		t.Fatalf("applied profile must bump use: %+v", res.Memory.MappingProfile)
	}

	// Явный save_or_update → обновляется.
	store = &stubMemoryStore{profiles: map[string]importmemory.Profile{"p-1": usableProfile("p-1", "X")}}
	svc = newMemTestService(&stubImporter{}, store, aiTestRefs())
	res, err = executeWithSelection(t, svc, data, false, "manual",
		&MemoryRequest{ProfileID: "p-1", SaveOrUpdate: true})
	if err != nil || !res.Memory.MappingProfile.Updated || len(store.updatedIDs) != 1 {
		t.Fatalf("explicit update failed: %+v (%v)", res.Memory.MappingProfile, err)
	}

	// Новый профиль: имя обязательно, проверка ДО импорта (§9.1).
	store = &stubMemoryStore{}
	imp := &stubImporter{}
	svc = newMemTestService(imp, store, aiTestRefs())
	_, err = executeWithSelection(t, svc, data, false, "manual", &MemoryRequest{SaveAsNew: true})
	var selErr *InvalidSelectionError
	if !errors.As(err, &selErr) {
		t.Fatalf("nameless save_as_new must be rejected: %v", err)
	}
	if imp.last != nil {
		t.Fatal("validation error must fire before import")
	}

	// save_as_new с именем → создаётся после успеха.
	store = &stubMemoryStore{}
	svc = newMemTestService(&stubImporter{}, store, aiTestRefs())
	res, err = executeWithSelection(t, svc, data, false, "manual",
		&MemoryRequest{SaveAsNew: true, Name: "Смета поставщика X"})
	if err != nil || !res.Memory.MappingProfile.Saved || len(store.createdNames) != 1 {
		t.Fatalf("save_as_new failed: %+v (%v)", res.Memory.MappingProfile, err)
	}
}
