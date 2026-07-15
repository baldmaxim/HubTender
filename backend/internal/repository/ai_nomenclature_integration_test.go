package repository

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	ainom "github.com/su10/hubtender/backend/internal/ai/nomenclature"
	ia "github.com/su10/hubtender/backend/internal/importanalysis"
)

// PostgreSQL integration tests for stage 2.2 (§20): AI-подбор номенклатуры с
// MOCK provider поверх живого справочника и живого import-контура 0-F1.
// COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run AiNomIntegration -v

// suggestMirror — зеркало SmartImportService.SuggestNomenclature (без
// import-cycle): unresolved-строки анализа → живой каталог → ainom.Suggest.
func suggestMirror(
	t *testing.T, pool *pgxpool.Pool, tenderID string, data []byte,
	provider ainom.NomenclatureReranker, cfg ainom.Config, opts ia.Options,
) (ainom.SuggestResult, *ia.Analysis) {
	t.Helper()
	an := smartAnalyze(t, pool, tenderID, data, opts)
	var inputs []ainom.SuggestInput
	seen := map[string]bool{}
	for _, is := range an.Result.Issues {
		if is.Code != "NOMENCLATURE_NOT_FOUND" && is.Code != "NOMENCLATURE_AMBIGUOUS" {
			continue
		}
		ref := is.Sheet + "|" + fmt.Sprintf("%d", is.ExcelRow)
		if seen[ref] {
			continue
		}
		seen[ref] = true
		for i := range an.Result.PreviewRows {
			pr := &an.Result.PreviewRows[i]
			if pr.ExcelRow == is.ExcelRow {
				inputs = append(inputs, ainom.SuggestInput{
					RowReference: ref, ExcelRow: pr.ExcelRow,
					Description: pr.Description, BoqType: pr.BoqType, Unit: pr.Unit,
				})
				break
			}
		}
	}
	catalog, err := NewImportAnalysisRepo(pool).ListNomenclatureCatalog(context.Background())
	if err != nil {
		t.Fatalf("catalog: %v", err)
	}
	return ainom.Suggest(context.Background(), inputs, catalog, provider, cfg, 0), an
}

// A/B — unresolved-строка получает детерминированных кандидатов из ЖИВОГО
// справочника даже при выключенном провайдере (§11).
func TestAiNomIntegration_SuggestDeterministic(t *testing.T) {
	pool := newTestPool(t)
	ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "AI-A")

	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material монтажный", "м2", 5, 50, "RUB"},
	})
	res, an := suggestMirror(t, pool, tenderID, data, ainom.DisabledProvider{}, ainom.Config{}, ia.Options{})
	if an.Result.Summary.RowsBlocked != 1 { // строка unresolved → blocker
		t.Fatalf("row must be blocked: %+v", an.Result.Summary)
	}
	if res.Provider.Status != ainom.ProviderDisabled {
		t.Fatalf("status=%s, want disabled", res.Provider.Status)
	}
	if len(res.Rows) != 1 || len(res.Rows[0].Candidates) == 0 {
		t.Fatalf("deterministic candidates required: %+v", res.Rows)
	}
	if res.Rows[0].Candidates[0].Label != "itest-shared-material" {
		t.Fatalf("top1=%s", res.Rows[0].Candidates[0].Label)
	}
}

// C/D/G/H — mock-rerank поверх живого каталога, подтверждение, execute
// персистит выбранный material_name_id, AI при execute не вызывается.
func TestAiNomIntegration_MockRerankConfirmExecute(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "AI-C")

	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material монтажный", "м2", 5, 50, "RUB"},
	})
	ref := "Смета|2"
	mock := &ainom.MockProvider{Script: map[string]ainom.RowResult{
		ref: ainom.SelectTop(ref, matID, ainom.ConfidenceHigh),
	}}
	res, _ := suggestMirror(t, pool, tenderID, data, mock, ainom.Config{Enabled: true}, ia.Options{})
	if mock.Calls != 1 {
		t.Fatalf("provider calls=%d, want 1", mock.Calls)
	}
	if len(res.Rows) != 1 || res.Rows[0].SelectedCandidateID == nil || *res.Rows[0].SelectedCandidateID != matID {
		t.Fatalf("rerank did not select %s: %+v", matID, res.Rows)
	}
	// C: согласие AI + deterministic top → high (§9).
	if res.Rows[0].Confidence != ainom.ConfidenceHigh {
		t.Fatalf("confidence=%s, want high", res.Rows[0].Confidence)
	}

	// D: подтверждённый выбор → execute → живой контур персистит ID.
	opts := ia.Options{
		NomenclatureSelections: map[string]string{ref: matID},
		SelectionSources:       map[string]string{ref: "ai_confirmed"},
	}
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), opts); err != nil {
		t.Fatalf("execute: %v", err)
	}
	var persisted string
	if err := pool.QueryRow(ctx, `
		SELECT COALESCE(material_name_id::text,'') FROM public.boq_items
		WHERE tender_id=$1::uuid`, tenderID).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != matID {
		t.Fatalf("persisted material_name_id=%q, want %q", persisted, matID)
	}
	// H: execute не обращается к провайдеру (§13.10).
	if mock.Calls != 1 {
		t.Fatalf("execute must not call provider: calls=%d", mock.Calls)
	}
}

// E — forged catalog ID: блокер, в БД ничего не попадает.
func TestAiNomIntegration_ForgedSelectionBlocked(t *testing.T) {
	pool := newTestPool(t)
	ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "AI-E")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material монтажный", "м2", 5, 50, "RUB"},
	})
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|2": "ffffffff-ffff-ffff-ffff-ffffffffffff"},
		SelectionSources:       map[string]string{"Смета|2": "ai_confirmed"},
	}
	an := smartAnalyze(t, pool, tenderID, data, opts)
	found := false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_SELECTION_INVALID" && is.Severity == ia.SeverityBlocker {
			found = true
		}
	}
	if !found {
		t.Fatalf("forged ID must raise blocker: %+v", an.Result.Issues)
	}
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), opts); err == nil {
		t.Fatal("execute with forged ID must fail")
	}
	var cnt int
	_ = pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID).Scan(&cnt)
	if cnt != 0 {
		t.Fatalf("nothing must be imported, got %d", cnt)
	}
}

// F — сбой провайдера (timeout): deterministic candidates остаются, ручное
// подтверждение разблокирует импорт (§11).
func TestAiNomIntegration_ProviderFailureDegrades(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	_, matID := ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "AI-F")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material монтажный", "м2", 5, 50, "RUB"},
	})
	mock := &ainom.MockProvider{ForcedStatus: ainom.ProviderTimeout}
	res, _ := suggestMirror(t, pool, tenderID, data, mock, ainom.Config{Enabled: true}, ia.Options{})
	if res.Provider.Status != ainom.ProviderTimeout {
		t.Fatalf("status=%s, want timeout", res.Provider.Status)
	}
	if len(res.Rows) != 1 || len(res.Rows[0].Candidates) == 0 {
		t.Fatalf("candidates must survive provider failure: %+v", res.Rows)
	}
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|2": matID},
		SelectionSources:       map[string]string{"Смета|2": "manual"},
	}
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), opts); err != nil {
		t.Fatalf("manual path must work during outage: %v", err)
	}
	var cnt int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("imported=%d, want 1", cnt)
	}
}

// I — изоляция типов на живом каталоге: для «мат» не приходят work-кандидаты.
func TestAiNomIntegration_TypeIsolation(t *testing.T) {
	pool := newTestPool(t)
	ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "AI-I")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-work", "м2", 5, 50, "RUB"}, // имя РАБОТЫ в мат-строке
	})
	res, _ := suggestMirror(t, pool, tenderID, data, ainom.DisabledProvider{}, ainom.Config{}, ia.Options{})
	if len(res.Rows) != 1 {
		t.Fatalf("rows=%d", len(res.Rows))
	}
	for _, c := range res.Rows[0].Candidates {
		if c.Type != "material" {
			t.Fatalf("work candidate leaked into material row: %+v", c)
		}
		if c.Label == "itest-shared-work" {
			t.Fatalf("exact work name must not be material candidate")
		}
	}
}

// J/K — unit-warning выбора не блокирует, финансовые входы не меняются
// (server-authoritative total как в 2.1).
func TestAiNomIntegration_UnitWarningAndFinancialIsolation(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	_, matID := ensureTestNames(t, pool) // каталожная единица м2
	tenderID, _ := seedSourceTender(t, pool, "AI-J")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material монтажный", "шт", 4, 25, "RUB"}, // строка шт ≠ каталог м2
	})
	opts := ia.Options{
		NomenclatureSelections: map[string]string{"Смета|2": matID},
		SelectionSources:       map[string]string{"Смета|2": "manual"},
	}
	an := smartAnalyze(t, pool, tenderID, data, opts)
	warned := false
	for _, is := range an.Result.Issues {
		if is.Code == "NOMENCLATURE_SELECTION_UNIT_WARNING" && is.Severity == ia.SeverityWarning {
			warned = true
		}
	}
	if !warned {
		t.Fatalf("unit warning expected: %+v", an.Result.Issues)
	}
	if _, _, err := smartExecute(t, pool, tenderID, data, ia.Fingerprint(data), opts); err != nil {
		t.Fatalf("warning must not block execute: %v", err)
	}
	var total float64
	if err := pool.QueryRow(ctx, `
		SELECT total_amount FROM public.boq_items WHERE tender_id=$1::uuid`, tenderID).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total != 100 { // K: 4 × 25 — сервер посчитал сам, selection не влияет
		t.Fatalf("total=%v, want 100", total)
	}
}

// L — data minimization на живом пути: provider-запрос не содержит
// количеств/цен/идентичности тендера (§6).
func TestAiNomIntegration_ProviderPayloadMinimized(t *testing.T) {
	pool := newTestPool(t)
	ensureTestNames(t, pool)
	tenderID, _ := seedSourceTender(t, pool, "AI-L")
	data := buildTestXLSX(t, [][]any{
		importHeader(),
		{"1", "мат", "itest-shared-material монтажный", "м2", 987654, 321.99, "USD"},
	})
	mock := &ainom.MockProvider{ForcedStatus: ainom.ProviderAvailable}
	suggestMirror(t, pool, tenderID, data, mock, ainom.Config{Enabled: true}, ia.Options{})
	if len(mock.Requests) != 1 {
		t.Fatalf("requests=%d", len(mock.Requests))
	}
	payload, err := ainom.MarshalProviderRequest(mock.Requests[0])
	if err != nil {
		t.Fatal(err)
	}
	s := strings.ToLower(string(payload))
	for _, forbidden := range []string{"987654", "321.99", "usd", tenderID, "quantity", "unit_rate", "total_amount"} {
		if strings.Contains(s, strings.ToLower(forbidden)) {
			t.Fatalf("provider payload leaks %q", forbidden)
		}
	}
	if !strings.Contains(s, "itest-shared-material") {
		t.Fatal("payload must contain row description")
	}
}

// M-X — консолидация: живой сетевой провайдер (нет одобренного провайдера —
// adapter не реализован); N+1/query-count instrumentation недоступна;
// concurrency/batch-лимиты и dedupe покрыты unit-тестами ai/nomenclature;
// auth/лимит 200 строк — handler-паттерн + константы (§10/§12).
func TestAiNomIntegration_SkippedCases(t *testing.T) {
	t.Skip("M-X: live provider отсутствует (решение владельца); instrumentation query-count недоступна; batching/dedupe/limits покрыты unit-уровнем")
}
