package importanalysis

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"
)

// ─── Fixtures: xlsx строится в памяти через excelize ─────────────────────────

type sheetSpec struct {
	name string
	rows [][]any
}

func buildXLSX(t *testing.T, sheets ...sheetSpec) []byte {
	t.Helper()
	f := excelize.NewFile()
	for i, sp := range sheets {
		if i == 0 {
			_ = f.SetSheetName("Sheet1", sp.name)
		} else {
			_, _ = f.NewSheet(sp.name)
		}
		for ri, row := range sp.rows {
			for ci, v := range row {
				cell, _ := excelize.CoordinatesToCellName(ci+1, ri+1)
				if s, ok := v.(string); ok && len(s) > 1 && s[0] == '=' {
					_ = f.SetCellFormula(sp.name, cell, s[1:])
				} else if v != nil {
					_ = f.SetCellValue(sp.name, cell, v)
				}
			}
		}
	}
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func testRefs() Refs {
	return Refs{
		Units: map[string]string{"м2": "м2", "м3": "м3", "шт": "шт", "т": "т"},
		WorkNames: map[string][]string{
			"кладка кирпичная":             {"w-1"},
			"бетонирование":                {"w-2"},
			"демонтаж «итого» конструкций": {"w-3"},
		},
		MaterialNames: map[string][]string{
			"кирпич": {"m-1"},
			"бетон":  {"m-2", "m-3"},
		},
		DetailCats: map[string][]string{"смр": {"dc-1"}},
		Positions: map[string]string{
			"1": "pos-1", "2": "pos-2", "01": "pos-1",
		},
		PositionLabels: map[string]string{"pos-1": "№1 Работы", "pos-2": "№2 Материалы"},
	}
}

var stdHeader = []any{"№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена за ед.", "Валюта"}

func stdRow(pos, typ, name, unit string, qty, rate any, cur string) []any {
	return []any{pos, typ, name, unit, qty, rate, cur}
}

func analyzeBytes(t *testing.T, data []byte, opts Options) *Analysis {
	t.Helper()
	wb, err := OpenWorkbook("test.xlsx", data)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	an, err := Analyze(wb, opts, testRefs())
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}
	return an
}

func stdWorkbook(t *testing.T, dataRows ...[]any) []byte {
	rows := [][]any{stdHeader}
	rows = append(rows, dataRows...)
	return buildXLSX(t, sheetSpec{name: "Смета", rows: rows})
}

func mappingFor(an *Analysis, field string) *Mapping {
	for i := range an.Result.Mapping {
		if an.Result.Mapping[i].TargetField == field {
			return &an.Result.Mapping[i]
		}
	}
	return nil
}

func hasIssueCode(an *Analysis, code string) bool {
	for _, is := range an.Result.Issues {
		if is.Code == code {
			return true
		}
	}
	return false
}

// ─── §17.1-5: листы и header ─────────────────────────────────────────────────

func TestSheetSelectionPrefersDataSheet(t *testing.T) { // 1-2
	data := buildXLSX(t,
		sheetSpec{name: "Титул", rows: [][]any{{"Проект строительства"}, {"Согласовано"}}},
		sheetSpec{name: "Локальная смета", rows: [][]any{
			stdHeader,
			stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"),
			stdRow("1", "раб", "Бетонирование", "м3", 5, 200, "RUB"),
		}},
	)
	an := analyzeBytes(t, data, Options{})
	if an.Result.SelectedSheet != "Локальная смета" { // не первый лист
		t.Fatalf("selected=%s, want data sheet", an.Result.SelectedSheet)
	}
}

func TestHeaderRowFirstAndAfterTitle(t *testing.T) { // 3-4
	an := analyzeBytes(t, stdWorkbook(t,
		stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB")), Options{})
	if an.Result.DetectedHeaderRow != 1 {
		t.Fatalf("header row=%d, want 1", an.Result.DetectedHeaderRow)
	}
	data := buildXLSX(t, sheetSpec{name: "Смета", rows: [][]any{
		{"ООО Стройка"}, {"Смета №5"}, {},
		stdHeader,
		stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"),
	}})
	an2 := analyzeBytes(t, data, Options{})
	if an2.Result.DetectedHeaderRow != 4 {
		t.Fatalf("header row=%d, want 4 (после служебной шапки)", an2.Result.DetectedHeaderRow)
	}
}

func TestCloseSheetScoresRequireConfirmation(t *testing.T) { // 5
	rows := [][]any{stdHeader, stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB")}
	data := buildXLSX(t,
		sheetSpec{name: "Смета А", rows: rows},
		sheetSpec{name: "Смета Б", rows: rows},
	)
	an := analyzeBytes(t, data, Options{})
	if an.Result.SheetConfidence == ConfidenceHigh {
		t.Fatalf("близкие score должны требовать подтверждения: %s", an.Result.SheetConfidence)
	}
}

// ─── §17.6-11: mapping ───────────────────────────────────────────────────────

func TestHeaderAliasesMapping(t *testing.T) { // 6-8, 11
	an := analyzeBytes(t, stdWorkbook(t,
		stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "руб.")), Options{})
	for field, wantCol := range map[string]string{
		FieldQuantity: "E", FieldUnitRate: "F", FieldCurrency: "G",
	} {
		m := mappingFor(an, field)
		if m == nil || m.SourceColumn != wantCol {
			t.Fatalf("%s → %v, want %s", field, m, wantCol)
		}
		if m.Confidence != ConfidenceHigh || len(m.Reasons) == 0 { // 11: reasons
			t.Fatalf("%s: confidence=%s reasons=%v", field, m.Confidence, m.Reasons)
		}
	}
}

func TestMappingConflictAndUnresolved(t *testing.T) { // 9-10
	data := buildXLSX(t, sheetSpec{name: "Смета", rows: [][]any{
		{"№ позиции", "Наименование", "Кол-во", "Кол-во"}, // двойной quantity-алиас
		{"1", "Кладка кирпичная", 10, 20},
	}})
	an := analyzeBytes(t, data, Options{})
	qm := mappingFor(an, FieldQuantity)
	if qm.Confidence == ConfidenceHigh {
		t.Fatalf("duplicate alias columns must not be high: %s", qm.Confidence)
	}
	if len(qm.Candidates) < 2 {
		t.Fatalf("candidates=%d, want ≥2", len(qm.Candidates))
	}
	// 10: unresolved required (цена не сопоставлена) → blocker.
	rm := mappingFor(an, FieldUnitRate)
	if rm.SourceColumn != "" || an.Result.Summary.RequiredMappingsMissing == 0 {
		t.Fatalf("unit_rate must be unresolved: %+v", rm)
	}
	if !hasIssueCode(an, "REQUIRED_MAPPING_MISSING") {
		t.Fatal("REQUIRED_MAPPING_MISSING issue missing")
	}
}

// ─── строки: типы/валюты/номенклатура/пропуски ──────────────────────────────

func TestRowNormalizationAndExactMatch(t *testing.T) { // 22, 25-28, 12
	an := analyzeBytes(t, stdWorkbook(t,
		stdRow("1", "Работа", "Кладка кирпичная", "м²", "1 234,5", "1 000,25", "руб."),
	), Options{})
	if an.Result.Summary.RowsReady != 1 || len(an.Items) != 1 {
		t.Fatalf("row must be ready: %+v issues=%+v", an.Result.Summary, an.Result.Issues)
	}
	it := an.Items[0]
	if it.BoqItemType != "раб" || *it.UnitCode != "м2" || *it.Quantity != 1234.5 ||
		*it.UnitRate != 1000.25 || *it.CurrencyType != "RUB" ||
		it.WorkNameID == nil || *it.WorkNameID != "w-1" || it.PositionID != "pos-1" {
		t.Fatalf("normalized item wrong: %+v", it)
	}
	if !hasIssueCode(an, "NOMENCLATURE_EXACT_MATCH") {
		t.Fatal("exact match info issue missing")
	}
	// transformations видимы
	if len(an.Result.PreviewRows[0].Transformations) == 0 {
		t.Fatal("transformations must be visible")
	}
}

func TestUnknownValuesBlockRow(t *testing.T) { // 21, 24, 27, 29, 30
	an := analyzeBytes(t, stdWorkbook(t,
		stdRow("1", "раб", "Бетонирование", "попугаи", 10, 100, "тугрик"), // unit+currency
		stdRow("1", "", "Кладка кирпичная", "м2", 10, 100, "RUB"),         // тип отсутствует
		stdRow("1", "мат", "Бетон", "м3", 1, 50, "RUB"),                   // ambiguous номенклатура
		stdRow("1", "мат", "Неизвестный материал", "шт", 1, 50, "RUB"),    // missing номенклатура
	), Options{})
	for _, code := range []string{"UNIT_UNKNOWN", "CURRENCY_UNKNOWN", "BOQ_TYPE_MISSING",
		"NOMENCLATURE_AMBIGUOUS", "NOMENCLATURE_NOT_FOUND"} {
		if !hasIssueCode(an, code) {
			t.Fatalf("issue %s missing", code)
		}
	}
	if an.Result.Summary.RowsBlocked != 4 {
		t.Fatalf("blocked=%d, want 4", an.Result.Summary.RowsBlocked)
	}
}

func TestDefaultTypeAndCurrencyOptions(t *testing.T) { // 27 (fixed range), currency default
	data := buildXLSX(t, sheetSpec{name: "Смета", rows: [][]any{
		{"№ позиции", "Наименование", "Ед. изм.", "Кол-во", "Цена"},
		{"1", "Кладка кирпичная", "м2", 10, 100},
	}})
	an := analyzeBytes(t, data, Options{DefaultBoqType: "раб", DefaultCurrency: "руб."})
	if an.Result.Summary.RowsBlocked != 0 || len(an.Items) != 1 {
		t.Fatalf("defaults must unblock row: %+v %+v", an.Result.Summary, an.Result.Issues)
	}
	if an.Items[0].BoqItemType != "раб" || *an.Items[0].CurrencyType != "RUB" {
		t.Fatalf("defaults wrong: %+v", an.Items[0])
	}
	if !hasIssueCode(an, "CURRENCY_DEFAULT") {
		t.Fatal("default currency must be visible warning")
	}
}

// §17.35: будущая дата цены.
func TestFutureQuoteDateBlocked(t *testing.T) {
	future := time.Now().UTC().AddDate(0, 0, 30).Format("02.01.2006")
	data := buildXLSX(t, sheetSpec{name: "Смета", rows: [][]any{
		append(stdHeader, "Дата цены"),
		append(stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"), future),
	}})
	an := analyzeBytes(t, data, Options{})
	if !hasIssueCode(an, "QUOTE_DATE_FUTURE") {
		t.Fatalf("future quote date must block: %+v", an.Result.Issues)
	}
}

// ─── §17.36-39: footers/повторный header/пустые ──────────────────────────────

func TestFooterRepeatHeaderEmptySkipped(t *testing.T) {
	an := analyzeBytes(t, stdWorkbook(t,
		stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"),
		[]any{"", "", "", "", "", "", ""},      // 39: пустая
		[]any{"", "", "Итого", "", "", "", ""}, // 36: footer
		stdHeader, // 37: повторный header
		stdRow("2", "раб", "Демонтаж «итого» конструкций", "м2", 5, 50, "RUB"), // 38: слово «итого» в описании
	), Options{})
	if !hasIssueCode(an, SkipFooter) || !hasIssueCode(an, SkipRepeatHeader) {
		t.Fatalf("footer/repeat header must be visible skips: %+v", an.Result.Issues)
	}
	// 38: строка с «итого» в описании — НЕ пропущена (есть qty/rate).
	if len(an.Items) != 2 {
		t.Fatalf("items=%d, want 2 (row with «итого» in description kept)", len(an.Items))
	}
	if an.Result.Summary.RowsSkipped != 3 {
		t.Fatalf("skipped=%d, want 3 (empty+footer+repeat)", an.Result.Summary.RowsSkipped)
	}
}

// ─── §17.40-44: parent ───────────────────────────────────────────────────────

func parentWorkbook(t *testing.T, rows ...[]any) []byte {
	header := []any{"№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена", "Валюта", "ID строки", "Родитель"}
	all := [][]any{header}
	all = append(all, rows...)
	return buildXLSX(t, sheetSpec{name: "Смета", rows: all})
}

func TestParentSemantics(t *testing.T) {
	// 40: явный корректный parent.
	an := analyzeBytes(t, parentWorkbook(t,
		[]any{"1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB", "W1", ""},
		[]any{"1", "мат", "Кирпич", "шт", 500, 20, "RUB", "", "W1"},
	), Options{})
	if len(an.Items) != 2 || an.Items[1].ParentTempID == nil || *an.Items[1].ParentTempID != "W1" {
		t.Fatalf("explicit parent failed: %+v issues=%+v", an.Items, an.Result.Issues)
	}
	// 41: отсутствующий parent.
	an = analyzeBytes(t, parentWorkbook(t,
		[]any{"1", "мат", "Кирпич", "шт", 500, 20, "RUB", "", "W404"},
	), Options{})
	if !hasIssueCode(an, "PARENT_NOT_FOUND") {
		t.Fatal("missing parent must block")
	}
	// 42: parent — не работа.
	an = analyzeBytes(t, parentWorkbook(t,
		[]any{"1", "мат", "Кирпич", "шт", 500, 20, "RUB", "M1", ""},
		[]any{"1", "мат", "Бетон", "м3", 1, 50, "RUB", "", "M1"},
	), Options{})
	if !hasIssueCode(an, "PARENT_NOT_WORK") {
		t.Fatal("non-work parent must block")
	}
	// 43: self-parent.
	an = analyzeBytes(t, parentWorkbook(t,
		[]any{"1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB", "W1", "W1"},
	), Options{})
	if !hasIssueCode(an, "PARENT_SELF") {
		t.Fatal("self parent must block")
	}
	// 44: цикл невозможен по построению (родитель обязан идти раньше в файле;
	// ссылка вперёд = PARENT_NOT_FOUND) — фиксируем поведение.
	an = analyzeBytes(t, parentWorkbook(t,
		[]any{"1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB", "W1", "W2"},
		[]any{"1", "раб", "Бетонирование", "м3", 5, 200, "RUB", "W2", "W1"},
	), Options{})
	if !hasIssueCode(an, "PARENT_NOT_FOUND") {
		t.Fatal("forward reference (cycle attempt) must block")
	}
	// duplicate temp id (§11).
	an = analyzeBytes(t, parentWorkbook(t,
		[]any{"1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB", "W1", ""},
		[]any{"1", "раб", "Бетонирование", "м3", 5, 200, "RUB", "W1", ""},
	), Options{})
	if !hasIssueCode(an, "TEMP_ID_DUPLICATE") {
		t.Fatal("duplicate temp id must block")
	}
}

// ─── §17.45-46: формулы ──────────────────────────────────────────────────────

func TestFormulaPolicy(t *testing.T) {
	data := stdWorkbook(t,
		stdRow("1", "раб", "Кладка кирпичная", "м2", "=10*2", 100, "RUB"))
	// 45: формула без cached value (excelize не рассчитывает) → blocker.
	an := analyzeBytes(t, data, Options{})
	if !hasIssueCode(an, "FORMULA_NO_CACHED_VALUE") {
		t.Fatalf("formula without cached value must block: %+v", an.Result.Issues)
	}
	// 46: cached value + подтверждение. excelize кэширует значение только при
	// пересчёте Excel'ем; смоделируем через прямую сборку Workbook.
	wb := &Workbook{FileName: "t.xlsx", Fingerprint: "f", Sheets: []Sheet{{
		Name: "Смета", Visible: true,
		Rows: [][]Cell{
			cellsFromStrings("№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена", "Валюта"),
			{{Raw: "1"}, {Raw: "раб"}, {Raw: "Кладка кирпичная"}, {Raw: "м2"},
				{Raw: "20", IsFormula: true, Formula: "10*2"}, {Raw: "100"}, {Raw: "RUB"}},
		},
	}}}
	anNoConfirm, err := Analyze(wb, Options{}, testRefs())
	if err != nil {
		t.Fatal(err)
	}
	if !hasIssueCode(anNoConfirm, "FORMULA_CACHED_VALUE") || anNoConfirm.Result.Summary.FormulaConfirmations == 0 {
		t.Fatal("cached formula must require confirmation")
	}
	anConfirmed, err := Analyze(wb, Options{AcceptFormulaCached: true}, testRefs())
	if err != nil {
		t.Fatal(err)
	}
	if anConfirmed.Result.Summary.RowsBlocked != 0 || len(anConfirmed.Items) != 1 || *anConfirmed.Items[0].Quantity != 20 {
		t.Fatalf("confirmed cached formula must pass: %+v", anConfirmed.Result.Summary)
	}
}

func cellsFromStrings(vals ...string) []Cell {
	out := make([]Cell, len(vals))
	for i, v := range vals {
		out[i] = Cell{Raw: v}
	}
	return out
}

// ─── §17.47-51, 53 ───────────────────────────────────────────────────────────

func TestFingerprintStability(t *testing.T) { // 47-48
	data := stdWorkbook(t, stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"))
	if Fingerprint(data) != Fingerprint(data) {
		t.Fatal("fingerprint must be stable")
	}
	other := stdWorkbook(t, stdRow("1", "раб", "Бетонирование", "м3", 5, 200, "RUB"))
	if Fingerprint(data) == Fingerprint(other) {
		t.Fatal("different files must differ")
	}
}

func TestIssueIDStableAndDeterministic(t *testing.T) { // 49-50, 53
	data := stdWorkbook(t,
		stdRow("1", "раб", "Кладка кирпичная", "м2", 10, 100, "RUB"),
		stdRow("9", "раб", "Бетонирование", "м3", 5, 200, "RUB"), // позиция 9 не существует
	)
	an1 := analyzeBytes(t, data, Options{})
	an2 := analyzeBytes(t, data, Options{})
	j1, _ := json.Marshal(an1.Result)
	j2, _ := json.Marshal(an2.Result)
	if string(j1) != string(j2) {
		t.Fatal("repeated analysis must be identical")
	}
	if len(an1.Result.Issues) == 0 || an1.Result.Issues[0].ID == "" {
		t.Fatal("issue IDs missing")
	}
	// 53: workbook model не мутируется.
	wb, _ := OpenWorkbook("t.xlsx", data)
	before, _ := json.Marshal(wb)
	_, _ = Analyze(wb, Options{}, testRefs())
	after, _ := json.Marshal(wb)
	if string(before) != string(after) {
		t.Fatal("analysis mutated workbook model")
	}
	// 51: no NaN/Inf — quantity/rate валидны либо nil (проверка структурная).
	for _, it := range an1.Items {
		if it.Quantity != nil && (*it.Quantity != *it.Quantity) {
			t.Fatal("NaN in quantity")
		}
	}
}

// §17.52: 10 000 строк × 30 колонок.
func TestLargeWorkbookPerformance(t *testing.T) {
	rows := make([][]any, 0, 10001)
	header := make([]any, 30)
	copy(header, stdHeader)
	for i := len(stdHeader); i < 30; i++ {
		header[i] = fmt.Sprintf("Прочее %d", i)
	}
	rows = append(rows, header)
	for i := 0; i < 10000; i++ {
		row := make([]any, 30)
		copy(row, stdRow("1", "раб", "Кладка кирпичная", "м2", "1 234,5", "1 000,25", "RUB"))
		for c := len(stdHeader); c < 30; c++ {
			row[c] = fmt.Sprintf("x%d", i%7)
		}
		rows = append(rows, row)
	}
	data := buildXLSX(t, sheetSpec{name: "Смета", rows: rows})
	start := time.Now()
	an := analyzeBytes(t, data, Options{})
	elapsed := time.Since(start)
	if len(an.Items) != 10000 {
		t.Fatalf("items=%d, want 10000 (summary=%+v)", len(an.Items), an.Result.Summary)
	}
	if elapsed > 20*time.Second {
		t.Fatalf("10k×30 analysis too slow: %v", elapsed)
	}
	t.Logf("10k×30: %v, file %d KB", elapsed, len(data)/1024)
}
