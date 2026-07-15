package repository

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	importmemory "github.com/su10/hubtender/backend/internal/importmemory"
)

// PostgreSQL integration tests for stage 2.3 (§18): Smart Import Memory поверх
// живой схемы. COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run ImportMemoryIntegration -v

const memUserB = "00000000-0000-0000-0000-00000000000b"

func ensureMemUserB(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `
		INSERT INTO auth.users (id, email) VALUES ($1::uuid, 'itest-b@example.com')
		ON CONFLICT (id) DO NOTHING`, memUserB); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO public.users (id, email, full_name, role_code, access_enabled)
		SELECT $1::uuid, 'itest-b@example.com', 'Itest B', r.code, true
		FROM public.roles r LIMIT 1
		ON CONFLICT (id) DO NOTHING`, memUserB); err != nil {
		t.Fatal(err)
	}
}

func memAnalyze(t *testing.T, pool *pgxpool.Pool, tenderID, userID string, data []byte, opts ia.Options) *ia.Analysis {
	t.Helper()
	refs, err := NewImportAnalysisRepo(pool).LoadRefs(context.Background(), tenderID, userID)
	if err != nil {
		t.Fatalf("refs: %v", err)
	}
	wb, err := ia.OpenWorkbook("test.xlsx", data)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	an, err := ia.Analyze(wb, opts, refs)
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	return an
}

func memCleanup(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM public.nomenclature_import_aliases WHERE user_id IN ($1::uuid, $2::uuid)`, rbActor, memUserB)
	_, _ = pool.Exec(ctx, `DELETE FROM public.boq_import_mapping_profiles WHERE user_id IN ($1::uuid, $2::uuid)`, rbActor, memUserB)
}

// A/B/C/D/E/P/R — жизненный цикл профилей: сохранение, exact-совпадение по
// сигнатуре, повторная валидация mapping, множественный выбор, изоляция
// пользователей, деактивация, forged ID.
func TestImportMemoryIntegration_ProfileLifecycle(t *testing.T) {
	pool := newTestPool(t)
	ensureMemUserB(t, pool)
	memCleanup(t, pool)
	ctx := context.Background()
	repo := NewImportMemoryRepo(pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-A")

	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "раб", "itest-shared-work", "м2", 10, 100, "RUB"},
	})
	an := memAnalyze(t, pool, tenderID, rbActor, data, ia.Options{})
	sig := importmemory.BuildImportHeaderSignature(an.Result.RawHeaders)
	if sig == "" {
		t.Fatal("signature empty")
	}

	// A: сохранение профиля (server-validated mapping — из результата анализа).
	mapping := map[string]string{}
	for _, m := range an.Result.Mapping {
		if m.SourceColumn != "" {
			mapping[m.TargetField] = m.SourceColumn
		}
	}
	profileID, err := repo.CreateProfile(ctx, rbActor, "Смета поставщика X", sig,
		mapping, importmemory.FixedOptions{DefaultCurrency: "RUB"}, an.Result.SelectedSheet, an.Result.DetectedHeaderRow)
	if err != nil {
		t.Fatalf("create profile: %v", err)
	}

	// B: второй файл с теми же headers → exact-совпадение сигнатуры.
	data2 := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "раб", "itest-shared-work", "м2", 99, 5, "RUB"},
		{"1", "раб", "itest-shared-work", "м2", 1, 2, "RUB"},
	})
	an2 := memAnalyze(t, pool, tenderID, rbActor, data2, ia.Options{})
	sig2 := importmemory.BuildImportHeaderSignature(an2.Result.RawHeaders)
	if sig2 != sig { // §17.3: значения строк не влияют
		t.Fatalf("same headers must give same signature")
	}
	found, err := repo.ListProfilesBySignature(ctx, rbActor, sig2)
	if err != nil || len(found) != 1 || found[0].ID != profileID {
		t.Fatalf("profile lookup failed: %+v (%v)", found, err)
	}

	// C: mapping профиля применяется и повторно валидируется текущим анализом.
	allowed := map[string]bool{}
	for _, m := range an2.Result.Mapping {
		allowed[m.TargetField] = true
	}
	merged, fromProfile, _ := importmemory.MergeProfileMapping(found[0].Mapping, nil, allowed)
	an3 := memAnalyze(t, pool, tenderID, rbActor, data2, ia.Options{
		MappingOverrides: merged, ProfileFields: map[string]bool{},
	})
	if an3.Result.Summary.RowsReady != 2 {
		t.Fatalf("profile mapping must validate: %+v", an3.Result.Summary)
	}
	if len(fromProfile) == 0 {
		t.Fatal("profile fields must be applied")
	}

	// D: два профиля с одной сигнатурой → выбор обязателен.
	if _, err := repo.CreateProfile(ctx, rbActor, "Смета поставщика Y", sig,
		mapping, importmemory.FixedOptions{}, "", 0); err != nil {
		t.Fatalf("second profile: %v", err)
	}
	both, _ := repo.ListProfilesBySignature(ctx, rbActor, sig)
	match := importmemory.MatchProfiles(both, sig)
	if match.Status != importmemory.ProfileMatchMultiple {
		t.Fatalf("multiple choice required: %+v", match)
	}

	// E: пользователь B не видит профили A.
	bProfiles, err := repo.ListProfilesBySignature(ctx, memUserB, sig)
	if err != nil || len(bProfiles) != 0 {
		t.Fatalf("user B must not see A profiles: %+v", bProfiles)
	}
	// R: чужой profile ID → not found.
	if _, err := repo.GetProfile(ctx, memUserB, profileID); err != ErrImportMemoryNotFound {
		t.Fatalf("foreign profile must be not-found: %v", err)
	}

	// P: деактивированный профиль не предлагается.
	if err := repo.PatchProfile(ctx, rbActor, profileID, nil, boolPtr(false)); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	after, _ := repo.ListProfilesBySignature(ctx, rbActor, sig)
	for _, p := range after {
		if p.ID == profileID {
			t.Fatal("inactive profile must not be suggested")
		}
	}
	memCleanup(t, pool)
}

func boolPtr(v bool) *bool { return &v }

// F/G/H/S — alias: сохранение после «успешного импорта», авто-разрешение
// строки, приоритет exact canonical, server-authoritative total.
func TestImportMemoryIntegration_AliasResolvesAndImports(t *testing.T) {
	pool := newTestPool(t)
	memCleanup(t, pool)
	ctx := context.Background()
	repo := NewImportMemoryRepo(pool)
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-F")

	// F: «первый импорт» подтвердил вручную и запомнил.
	saved, err := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: matID,
		SourceText: "itest-alias материал особый", CanonicalBoqType: "мат", UnitCode: "м2",
	}})
	if err != nil || saved != 1 {
		t.Fatalf("save alias: %d %v", saved, err)
	}

	// G: следующий import — alias разрешает строку автоматически, но видимо.
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-alias материал особый", "м2", 4, 25, "RUB"},
	})
	an := memAnalyze(t, pool, tenderID, rbActor, data, ia.Options{})
	if an.Result.Summary.RowsBlocked != 0 {
		t.Fatalf("alias must resolve row: %+v / %+v", an.Result.Summary, an.Result.Issues)
	}
	aliasSeen := false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_ALIAS_MATCH" {
			aliasSeen = true
		}
	}
	if !aliasSeen || an.Items[0].AliasID == "" {
		t.Fatalf("alias provenance missing: %+v", an.Result.Issues)
	}
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), ia.Options{}); err != nil {
		t.Fatalf("execute: %v", err)
	}
	var persisted string
	var total float64
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(material_name_id::text, ''), total_amount
		FROM public.boq_items WHERE tender_id = $1::uuid`, tenderID).Scan(&persisted, &total); err != nil {
		t.Fatal(err)
	}
	if persisted != matID {
		t.Fatalf("alias target not persisted: %q != %q", persisted, matID)
	}
	if total != 100 { // S: 4 × 25 — сервер считает сам, alias не несёт цен
		t.Fatalf("total=%v, want 100 (server-authoritative)", total)
	}

	// Use-счётчик: только «после успешного импорта» (эмулируем шаг 5 §8).
	if err := repo.BumpAliasUse(ctx, rbActor, []string{an.Items[0].AliasID}); err != nil {
		t.Fatalf("bump: %v", err)
	}
	var useCount int
	_ = pool.QueryRow(ctx, `SELECT use_count FROM public.nomenclature_import_aliases WHERE id = $1::uuid`,
		an.Items[0].AliasID).Scan(&useCount)
	if useCount != 1 {
		t.Fatalf("use_count=%d, want 1", useCount)
	}

	// H: exact canonical match имеет приоритет — alias на ДРУГУЮ цель не
	// перебивает точное совпадение имени каталога.
	if _, err := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: matID,
		SourceText: "itest-shared-material", CanonicalBoqType: "мат", UnitCode: "м2",
	}}); err != nil {
		t.Fatal(err)
	}
	dataExact := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material", "м2", 1, 1, "RUB"},
	})
	anExact := memAnalyze(t, pool, tenderID, rbActor, dataExact, ia.Options{})
	if anExact.Items[0].AliasID != "" {
		t.Fatal("exact canonical must win over alias")
	}
	for _, is := range anExact.Result.Issues {
		if is.Code == "NOMENCLATURE_ALIAS_MATCH" {
			t.Fatal("alias match must not fire on exact canonical")
		}
	}
	memCleanup(t, pool)
}

// I/J/K — remember-семантика: без remember alias не создаётся; с remember —
// только после успешного импорта; неуспешный импорт не создаёт память.
func TestImportMemoryIntegration_RememberSemantics(t *testing.T) {
	pool := newTestPool(t)
	memCleanup(t, pool)
	ctx := context.Background()
	repo := NewImportMemoryRepo(pool)
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-I")

	countAliases := func() int {
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM public.nomenclature_import_aliases WHERE user_id = $1::uuid`, rbActor).Scan(&n)
		return n
	}

	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-alias-remember", "м2", 2, 10, "RUB"},
	})
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|2": matID},
		SelectionSources:       map[string]string{"Смета|2": "ai_confirmed"},
	}
	// I: подтверждено, но remember НЕ запрошен → импорт есть, alias нет.
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), opts); err != nil {
		t.Fatalf("execute: %v", err)
	}
	if countAliases() != 0 {
		t.Fatal("alias must not be created without explicit remember")
	}

	// K: неуспешный импорт (blockers: нет selection) не создаёт память —
	// SaveAliases вызывается только после успеха (§8), эмулируем порядок.
	dataBlocked := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-alias-remember", "м2", 2, 10, "RUB"},
	})
	if _, _, err := smartExecute(t, pool, tenderID, dataBlocked, ia.Fingerprint(dataBlocked), ia.Options{}); err == nil {
		t.Fatal("blocked import must fail")
	}
	if countAliases() != 0 {
		t.Fatal("failed import must not create memory")
	}

	// J: remember=true → alias создаётся ПОСЛЕ успешного импорта.
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), opts); err != nil {
		t.Fatalf("execute: %v", err)
	}
	saved, err := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: matID,
		SourceText: "itest-alias-remember", CanonicalBoqType: "мат", UnitCode: "м2",
	}})
	if err != nil || saved != 1 || countAliases() != 1 {
		t.Fatalf("remember=true must save after success: %d %v", saved, err)
	}
	// Идемпотентность: повторный remember той же пары не плодит дубликаты.
	saved2, _ := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: matID,
		SourceText: "itest-alias-remember", CanonicalBoqType: "мат", UnitCode: "м2",
	}})
	if saved2 != 0 || countAliases() != 1 {
		t.Fatalf("same alias must be idempotent: %d, count=%d", saved2, countAliases())
	}
	memCleanup(t, pool)
}

// M/N/O — устаревание: удаление цели каскадом убирает alias (без dangling);
// конфликт блокирует; деактивация выключает применение.
func TestImportMemoryIntegration_StaleConflictDeactivate(t *testing.T) {
	pool := newTestPool(t)
	memCleanup(t, pool)
	ctx := context.Background()
	repo := NewImportMemoryRepo(pool)
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-M")

	// M: цель удалена (hard delete) → alias исчезает каскадом, строка снова
	// unresolved; штатное удаление каталога НЕ заблокировано.
	var tmpID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.material_names (name, unit) VALUES ('itest-temp-target', 'м2')
		RETURNING id::text`).Scan(&tmpID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: tmpID,
		SourceText: "itest-alias-temp", CanonicalBoqType: "мат", UnitCode: "м2",
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM public.material_names WHERE id = $1::uuid`, tmpID); err != nil {
		t.Fatalf("catalog delete must not be blocked: %v", err)
	}
	var dangling int
	_ = pool.QueryRow(ctx, `
		SELECT count(*) FROM public.nomenclature_import_aliases
		WHERE user_id = $1::uuid AND material_name_id = $2::uuid`, rbActor, tmpID).Scan(&dangling)
	if dangling != 0 {
		t.Fatalf("dangling alias after target delete: %d", dangling)
	}
	dataTemp := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-alias-temp", "м2", 1, 1, "RUB"},
	})
	anTemp := memAnalyze(t, pool, tenderID, rbActor, dataTemp, ia.Options{})
	if anTemp.Result.Summary.RowsBlocked != 1 {
		t.Fatalf("row must be unresolved again: %+v", anTemp.Result.Summary)
	}

	// N: две активные записи (generic + unit-specific) на РАЗНЫЕ цели → conflict.
	var mat2 string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.material_names (name, unit) VALUES ('itest-conflict-target', 'м2')
		RETURNING id::text`).Scan(&mat2); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		memCleanup(t, pool)
		_, _ = pool.Exec(ctx, `DELETE FROM public.material_names WHERE id = $1::uuid`, mat2)
	})
	if _, err := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{
		{CatalogKind: importmemory.KindMaterial, CatalogID: matID,
			SourceText: "itest-alias-conflict", CanonicalBoqType: "мат", UnitCode: "м2"},
		{CatalogKind: importmemory.KindMaterial, CatalogID: mat2,
			SourceText: "itest-alias-conflict", CanonicalBoqType: "мат", UnitCode: ""},
	}); err != nil {
		t.Fatal(err)
	}
	dataConf := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-alias-conflict", "м2", 1, 1, "RUB"},
	})
	anConf := memAnalyze(t, pool, tenderID, rbActor, dataConf, ia.Options{})
	conflict := false
	for _, is := range anConf.Result.Issues {
		if is.Code == "NOMENCLATURE_ALIAS_CONFLICT" && is.Severity == ia.SeverityBlocker {
			conflict = true
		}
	}
	if !conflict {
		t.Fatalf("conflict blocker expected: %+v", anConf.Result.Issues)
	}
	if _, _, err := smartExecute(t, pool, tenderID, dataConf, ia.Fingerprint(dataConf), ia.Options{}); err == nil {
		t.Fatal("conflict must block import until user chooses")
	}

	// O: деактивация конфликтующего alias → строка разрешается второй записью.
	rows, _, err := repo.ListAliases(ctx, rbActor, "itest-alias-conflict", true, 1, 10)
	if err != nil || len(rows) != 2 {
		t.Fatalf("list aliases: %d %v", len(rows), err)
	}
	var toDisable string
	for _, r := range rows {
		if r.CatalogID == mat2 {
			toDisable = r.ID
		}
	}
	if err := repo.SetAliasActive(ctx, rbActor, toDisable, false); err != nil {
		t.Fatalf("deactivate: %v", err)
	}
	anAfter := memAnalyze(t, pool, tenderID, rbActor, dataConf, ia.Options{})
	if anAfter.Result.Summary.RowsBlocked != 0 {
		t.Fatalf("deactivated alias must not participate: %+v", anAfter.Result.Issues)
	}
	if anAfter.Items[0].MaterialNameID == nil || *anAfter.Items[0].MaterialNameID != matID {
		t.Fatalf("remaining alias must resolve to %s", matID)
	}
}

// Q/R — management не трогает финансовую ревизию; изоляция alias.
func TestImportMemoryIntegration_ManagementSafety(t *testing.T) {
	pool := newTestPool(t)
	ensureMemUserB(t, pool)
	memCleanup(t, pool)
	ctx := context.Background()
	repo := NewImportMemoryRepo(pool)
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-Q")

	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "раб", "itest-shared-work", "м2", 10, 100, "RUB"},
	})
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), ia.Options{}); err != nil {
		t.Fatalf("seed import: %v", err)
	}
	before := readFinState(t, pool, tenderID)

	profileID, err := repo.CreateProfile(ctx, rbActor, "Q-профиль", "sig-q",
		map[string]string{"quantity": "E"}, importmemory.FixedOptions{}, "", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SaveAliases(ctx, rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: matID,
		SourceText: "itest-q-alias", CanonicalBoqType: "мат",
	}}); err != nil {
		t.Fatal(err)
	}
	rows, _, _ := repo.ListAliases(ctx, rbActor, "itest-q-alias", true, 1, 10)
	if len(rows) != 1 {
		t.Fatalf("alias rows: %d", len(rows))
	}
	// Q: rename/deactivate не меняют financial state.
	newName := "Q-профиль переименован"
	if err := repo.PatchProfile(ctx, rbActor, profileID, &newName, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetAliasActive(ctx, rbActor, rows[0].ID, false); err != nil {
		t.Fatal(err)
	}
	after := readFinState(t, pool, tenderID)
	if before != after {
		t.Fatalf("management must not touch financial state: %+v → %+v", before, after)
	}
	// R: пользователь B не управляет чужими записями.
	if err := repo.SetAliasActive(ctx, memUserB, rows[0].ID, true); err != ErrImportMemoryNotFound {
		t.Fatalf("foreign alias must be not-found: %v", err)
	}
	if err := repo.PatchProfile(ctx, memUserB, profileID, &newName, nil); err != ErrImportMemoryNotFound {
		t.Fatalf("foreign profile must be not-found: %v", err)
	}
	memCleanup(t, pool)
}

// T — alias-разрешённая строка не отправляется AI (suggest не видит её).
func TestImportMemoryIntegration_AliasSkipsAI(t *testing.T) {
	pool := newTestPool(t)
	memCleanup(t, pool)
	repo := NewImportMemoryRepo(pool)
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-T")
	if _, err := repo.SaveAliases(context.Background(), rbActor, []AliasSaveEntry{{
		CatalogKind: importmemory.KindMaterial, CatalogID: matID,
		SourceText: "itest-ai-skip материал", CanonicalBoqType: "мат", UnitCode: "м2",
	}}); err != nil {
		t.Fatal(err)
	}
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-ai-skip материал", "м2", 1, 1, "RUB"},
	})
	mock := &ainom.MockProvider{ForcedStatus: ainom.ProviderAvailable}
	res, an := suggestMirror(t, pool, tenderID, data, mock, ainom.Config{Enabled: true},
		ia.Options{})
	_ = an
	if len(res.Rows) != 0 {
		t.Fatalf("alias-resolved row must not reach AI: %+v", res.Rows)
	}
	if mock.Calls != 0 {
		t.Fatalf("provider must not be called: %d", mock.Calls)
	}
	memCleanup(t, pool)
}

// suggestMirror из этапа 2.2 использует rbActor-refs? Он вызывает smartAnalyze
// (rbActor) — подходит и для 2.3: aliases загружаются в тех же refs.

// W — 10 000 строк + 5 000 aliases + 100 profiles: без квадратичного поведения.
func TestImportMemoryIntegration_Performance(t *testing.T) {
	pool := newTestPool(t)
	memCleanup(t, pool)
	ctx := context.Background()
	repo := NewImportMemoryRepo(pool)
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "MEM-W")
	t.Cleanup(func() { memCleanup(t, pool) })

	entries := make([]AliasSaveEntry, 0, 5000)
	for i := 0; i < 5000; i++ {
		entries = append(entries, AliasSaveEntry{
			CatalogKind: importmemory.KindMaterial, CatalogID: matID,
			SourceText:       fmt.Sprintf("itest-perf материал %d", i),
			CanonicalBoqType: "мат", UnitCode: "м2",
		})
	}
	if _, err := repo.SaveAliases(ctx, rbActor, entries); err != nil {
		t.Fatalf("bulk save: %v", err)
	}
	for i := 0; i < 100; i++ {
		if _, err := repo.CreateProfile(ctx, rbActor, fmt.Sprintf("perf-%03d", i),
			fmt.Sprintf("sig-%03d", i), map[string]string{"quantity": "E"},
			importmemory.FixedOptions{}, "", 0); err != nil {
			t.Fatal(err)
		}
	}

	rows := [][]any{importHeader()}
	for i := 0; i < 10000; i++ {
		rows = append(rows, []any{"1", "мат", fmt.Sprintf("itest-perf материал %d", i%5000), "м2", 1, 1, "RUB"})
	}
	data := buildTestXLSX(t, rows)

	start := time.Now()
	an := memAnalyze(t, pool, tenderID, rbActor, data, ia.Options{})
	elapsed := time.Since(start)
	if an.Result.Summary.RowsBlocked != 0 {
		t.Fatalf("all rows must resolve via aliases: %+v", an.Result.Summary)
	}
	if elapsed > 30*time.Second {
		t.Fatalf("analyze too slow: %v", elapsed)
	}
	t.Logf("10k rows + 5k aliases + 100 profiles: analyze %v", elapsed)
}

// L/U/V/X/Y — консолидация: L (memory failure warning) и U (memory summary)
// покрыты unit-тестами сервиса; V (идемпотентность миграции) — Docker-ритуал
// применяет baseline+incremental дважды; X (auth/404) — handler-паттерн +
// user-scope в ProfileLifecycle/ManagementSafety; Y — instrumentation
// query-count недоступна (LoadRefs — фиксированное число запросов).
func TestImportMemoryIntegration_SkippedCases(t *testing.T) {
	t.Skip("L/U: unit-уровень сервиса; V: миграции применяются дважды Docker-ритуалом; X: handler auth-паттерн; Y: instrumentation недоступна")
}
