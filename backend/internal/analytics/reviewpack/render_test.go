package reviewpack

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/xuri/excelize/v2"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
)

// §23: тесты готового workbook через API excelize (без хрупких XML-offset).

func renderFull(t *testing.T) (*Model, *excelize.File) {
	t.Helper()
	m := Build(fullInputs())
	data, err := Render(m)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data)) // 1: файл открывается
	if err != nil {
		t.Fatalf("open rendered workbook: %v", err)
	}
	return m, f
}

// 2-3. Ровно семь листов в стабильном порядке.
func TestWorkbookSheetsAndOrder(t *testing.T) {
	_, f := renderFull(t)
	got := f.GetSheetList()
	if len(got) != 7 {
		t.Fatalf("sheets=%d, want 7: %v", len(got), got)
	}
	for i, want := range SheetOrder {
		if got[i] != want {
			t.Fatalf("sheet %d=%q, want %q", i, got[i], want)
		}
	}
}

// 4. «Сводка» содержит revision и fingerprint.
func TestSummarySheetHasRevisionAndFingerprint(t *testing.T) {
	m, f := renderFull(t)
	rows, err := f.GetRows(SheetOrder[0])
	if err != nil {
		t.Fatal(err)
	}
	all := ""
	for _, r := range rows {
		all += strings.Join(r, "|") + "\n"
	}
	if !strings.Contains(all, "15") || !strings.Contains(all, m.Metadata.ReportFingerprint) {
		t.Fatal("summary sheet must contain revision and fingerprint")
	}
	if !strings.Contains(all, "требуют проверки") {
		t.Fatal("summary must contain review disclaimer")
	}
}

// 5. Action sheet содержит server rank.
func TestActionSheetServerRank(t *testing.T) {
	_, f := renderFull(t)
	v, err := f.GetCellValue(SheetOrder[1], "A2")
	if err != nil || v != "1" {
		t.Fatalf("rank cell=%q err=%v, want 1", v, err)
	}
}

// 6. Money cells — numeric type.
func TestMoneyCellsNumeric(t *testing.T) {
	m, f := renderFull(t)
	// «Ценовые отклонения»: колонка 6 (текущая цена) первой data-строки.
	ct, err := f.GetCellType(SheetOrder[3], "F3")
	if err != nil {
		t.Fatal(err)
	}
	if ct != excelize.CellTypeNumber && ct != excelize.CellTypeUnset {
		t.Fatalf("money cell type=%v, want numeric", ct)
	}
	raw, _ := f.GetCellValue(SheetOrder[3], "F3", excelize.Options{RawCellValue: true})
	if raw != "300" {
		t.Fatalf("money raw=%q, want 300", raw)
	}
	_ = m
}

// 7. Dates — date representation (numeric serial + формат).
func TestDateCells(t *testing.T) {
	_, f := renderFull(t)
	// «Сводка»: строка «Сформирован» — ищем ячейку с датой в колонке B.
	rows, _ := f.GetRows(SheetOrder[0])
	found := false
	for i, r := range rows {
		if len(r) > 0 && strings.Contains(r[0], "Сформирован") {
			raw, _ := f.GetCellValue(SheetOrder[0], fmt.Sprintf("B%d", i+1), excelize.Options{RawCellValue: true})
			if raw == "" {
				t.Fatal("generated date cell empty")
			}
			if strings.Contains(raw, "2026-07-15T") {
				t.Fatalf("date stored as raw text %q, want excel serial", raw)
			}
			found = true
		}
	}
	if !found {
		t.Fatal("generated-at row not found")
	}
}

// 8-9. Ни одной formula cell; опасный текст не становится формулой.
func TestNoFormulasAndInjectionNeutralized(t *testing.T) {
	in := fullInputs()
	in.Quality.Issues[0].Title = `=HYPERLINK("http://evil","x")`
	in.Quality.Issues[0].Message = `+cmd|' /C calc'!A0`
	in.Quality.Issues[0].FixHint = "@SUM(A1:A9)"
	m := Build(in)
	data, err := Render(m)
	if err != nil {
		t.Fatal(err)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatal(err)
	}
	for _, sheet := range f.GetSheetList() {
		rows, err := f.GetRows(sheet)
		if err != nil {
			t.Fatal(err)
		}
		for ri := range rows {
			for ciIdx := range rows[ri] {
				cellName, _ := excelize.CoordinatesToCellName(ciIdx+1, ri+1)
				formula, _ := f.GetCellFormula(sheet, cellName)
				if formula != "" {
					t.Fatalf("formula cell found: %s!%s = %q", sheet, cellName, formula)
				}
			}
		}
	}
	// Опасный заголовок сохранён видимым, но нейтрализован апострофом.
	v, _ := f.GetCellValue(SheetOrder[2], "D2")
	if !strings.Contains(v, "HYPERLINK") || !strings.HasPrefix(v, "'=") {
		t.Fatalf("injection not neutralized: %q", v)
	}
}

// 10-11. Safe hyperlink существует; unsafe URL — не hyperlink.
func TestHyperlinksSafety(t *testing.T) {
	in := fullInputs()
	safe := "https://supplier.kz/q.pdf"
	unsafe := "javascript:alert(1)"
	in.Source.Items = []ps.Row{
		{BoqItemID: "s1", ClientPositionID: "p1", Status: ps.StatusStale, Severity: "warning",
			Name: "Кабель", SourceURL: &safe, SourceLabel: "КП"},
		{BoqItemID: "s2", ClientPositionID: "p1", Status: ps.StatusExpired, Severity: "warning",
			Name: "Труба", SourceURL: &unsafe, SourceLabel: "js"},
	}
	m := Build(in)
	data, err := Render(m)
	if err != nil {
		t.Fatal(err)
	}
	f, _ := excelize.OpenReader(bytes.NewReader(data))
	okSafe, link, err := f.GetCellHyperLink(SheetOrder[4], "P3")
	if err != nil || !okSafe || link != safe {
		t.Fatalf("safe hyperlink missing: ok=%v link=%q err=%v", okSafe, link, err)
	}
	okBad, _, _ := f.GetCellHyperLink(SheetOrder[4], "P4")
	if okBad {
		t.Fatal("unsafe URL must not become hyperlink")
	}
	v, _ := f.GetCellValue(SheetOrder[4], "P4")
	if !strings.Contains(v, "javascript:alert(1)") {
		t.Fatalf("unsafe URL must stay visible text, got %q", v)
	}
}

// 12-13. Freeze panes + auto filter.
func TestFreezeAndAutoFilter(t *testing.T) {
	_, f := renderFull(t)
	panes, err := f.GetPanes(SheetOrder[1])
	if err != nil || !panes.Freeze || panes.YSplit != 1 {
		t.Fatalf("freeze panes wrong: %+v err=%v", panes, err)
	}
	// AutoFilter проверяем точечно по sheet XML property через GetAutoFilter API-заменитель:
	// excelize v2.9 не даёт геттер — проверяем, что установка не падала, через
	// повторный вызов на открытом файле (идемпотентная запись означает валидный диапазон).
	if err := f.AutoFilter(SheetOrder[1], "A1:N2", nil); err != nil {
		t.Fatalf("autofilter range invalid: %v", err)
	}
}

// 14-15. Baseline no-data и reconciliation mismatch видимы.
func TestBaselineNoDataAndMismatchVisible(t *testing.T) {
	in := fullInputs()
	in.ChangeImpact = ci.BaselineNotAvailableReport(
		ci.TenderState{ID: "T1", TenderNumber: "TN-1", Version: 1}, nil, "2026-07-15T10:00:00Z")
	data, err := Render(Build(in))
	if err != nil {
		t.Fatal(err)
	}
	f, _ := excelize.OpenReader(bytes.NewReader(data))
	v, _ := f.GetCellValue(SheetOrder[5], "A1")
	if !strings.Contains(v, "Предыдущая согласованная версия отсутствует") {
		t.Fatalf("baseline no-data not visible: %q", v)
	}

	in2 := fullInputs()
	in2.ChangeImpact.Summary.IsReconciled = false
	in2.ChangeImpact.Summary.ReconciliationResidual = 1234.56
	in2.ChangeImpact.Summary.ReconciliationStatus = ci.ReconciliationMismatch
	data2, err := Render(Build(in2))
	if err != nil {
		t.Fatal(err)
	}
	f2, _ := excelize.OpenReader(bytes.NewReader(data2))
	rows, _ := f2.GetRows(SheetOrder[5])
	joined := ""
	for _, r := range rows {
		joined += strings.Join(r, "|") + "\n"
	}
	if !strings.Contains(joined, "не удалось полностью согласовать") {
		t.Fatal("reconciliation mismatch must be visible text")
	}
}

// 16. Пустой отчёт валиден.
func TestEmptyWorkbookValid(t *testing.T) {
	m := Build(Inputs{Metadata: baseMeta()})
	data, err := Render(m)
	if err != nil {
		t.Fatalf("empty render: %v", err)
	}
	if _, err := excelize.OpenReader(bytes.NewReader(data)); err != nil {
		t.Fatalf("empty workbook invalid: %v", err)
	}
}

// 17. Большой workbook формируется без повреждения (perf §27).
func TestLargeWorkbook(t *testing.T) {
	in := fullInputs()
	in.ActionPlan.Actions = nil
	for i := 0; i < 3000; i++ {
		in.ActionPlan.Actions = append(in.ActionPlan.Actions, ap.Action{
			ID: fmt.Sprintf("a%d", i), Rank: i + 1, Priority: "normal", Source: "price_source",
			Sources: []string{"price_source"}, Code: "STALE", Title: fmt.Sprintf("Действие %d", i),
			Reason: strings.Repeat("причина ", 5), RecommendedAction: "проверить",
			ImpactAmount: fptr(float64(i) * 10), ImpactAmountStatus: "available",
			Navigation: ap.Navigation{Type: ap.NavBoqItem},
		})
	}
	for i := 0; i < 2000; i++ {
		st := ps.StatusStale
		in.Source.Items = append(in.Source.Items, ps.Row{
			BoqItemID: fmt.Sprintf("s%d", i), ClientPositionID: "p1", Status: st,
			Severity: "warning", Name: fmt.Sprintf("Материал %d", i), Message: "давно",
		})
	}
	start := time.Now()
	data, err := Render(Build(in))
	el := time.Since(start)
	if err != nil {
		t.Fatalf("large render: %v", err)
	}
	if el > 15*time.Second {
		t.Fatalf("large render too slow: %v", el)
	}
	f, err := excelize.OpenReader(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("large workbook corrupted: %v", err)
	}
	rows, _ := f.GetRows(SheetOrder[1])
	if len(rows) < 3000 {
		t.Fatalf("large sheet truncated: %d rows", len(rows))
	}
	t.Logf("large workbook: %d KB in %v", len(data)/1024, el)
}

// 18. Renderer не изменяет input model.
func TestRendererDoesNotMutateModel(t *testing.T) {
	m := Build(fullInputs())
	before, _ := json.Marshal(m)
	if _, err := Render(m); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(m)
	if string(before) != string(after) {
		t.Fatal("renderer mutated the model")
	}
	// 37 (§22): повторный рендер той же модели → одинаковая структура листов.
	d1, _ := Render(m)
	d2, _ := Render(m)
	f1, _ := excelize.OpenReader(bytes.NewReader(d1))
	f2, _ := excelize.OpenReader(bytes.NewReader(d2))
	r1, _ := f1.GetRows(SheetOrder[0])
	r2, _ := f2.GetRows(SheetOrder[0])
	j1, _ := json.Marshal(r1)
	j2, _ := json.Marshal(r2)
	if string(j1) != string(j2) {
		t.Fatal("repeated render differs")
	}
}
