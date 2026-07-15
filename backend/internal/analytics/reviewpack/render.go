package reviewpack

import (
	"bytes"
	"fmt"
	"time"

	"github.com/xuri/excelize/v2"
)

// Имена и фиксированный порядок листов (§8).
var SheetOrder = []string{
	"Сводка", "План действий", "Качество расчёта", "Ценовые отклонения",
	"Источники цен", "Изменения расчёта", "Методика",
}

// ReviewDisclaimer — обязательное предупреждение листа «Сводка» (§9).
const ReviewDisclaimer = "Статистические отклонения и актуальность источника требуют проверки " +
	"и не являются автоматическим доказательством ошибки цены."

// renderCtx — стили одного workbook (единый style helper, §16).
type renderCtx struct {
	f        *excelize.File
	title    int
	header   int
	text     int
	wrap     int
	money    int
	percent  int
	date     int
	bold     int
	warnText int
}

// Render — XLSX из ГОТОВОЙ immutable-модели (§2C): без БД, без вызова
// analytics engines, без пересчёта totals и БЕЗ Excel-формул (только значения).
func Render(m *Model) ([]byte, error) {
	f := excelize.NewFile()
	ctx := &renderCtx{f: f}
	if err := ctx.initStyles(); err != nil {
		return nil, err
	}

	for i, name := range SheetOrder {
		if i == 0 {
			if err := f.SetSheetName("Sheet1", name); err != nil {
				return nil, err
			}
			continue
		}
		if _, err := f.NewSheet(name); err != nil {
			return nil, err
		}
	}

	if err := ctx.renderSummary(m); err != nil {
		return nil, err
	}
	if err := ctx.renderActionPlan(m); err != nil {
		return nil, err
	}
	if err := ctx.renderQuality(m); err != nil {
		return nil, err
	}
	if err := ctx.renderBenchmark(m); err != nil {
		return nil, err
	}
	if err := ctx.renderSource(m); err != nil {
		return nil, err
	}
	if err := ctx.renderChangeImpact(m); err != nil {
		return nil, err
	}
	if err := ctx.renderMethodology(m); err != nil {
		return nil, err
	}

	f.SetActiveSheet(0)
	var buf bytes.Buffer
	if err := f.Write(&buf); err != nil {
		return nil, err
	}
	_ = f.Close()
	return buf.Bytes(), nil
}

func (c *renderCtx) initStyles() error {
	var err error
	if c.title, err = c.f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14}}); err != nil {
		return err
	}
	if c.header, err = c.f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true},
		Fill:      excelize.Fill{Type: "pattern", Pattern: 1, Color: []string{"D9E8DF"}},
		Alignment: &excelize.Alignment{Vertical: "center", WrapText: true},
	}); err != nil {
		return err
	}
	if c.text, err = c.f.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{Vertical: "top"}}); err != nil {
		return err
	}
	if c.wrap, err = c.f.NewStyle(&excelize.Style{Alignment: &excelize.Alignment{Vertical: "top", WrapText: true}}); err != nil {
		return err
	}
	money := "#,##0.00"
	if c.money, err = c.f.NewStyle(&excelize.Style{CustomNumFmt: &money}); err != nil {
		return err
	}
	pct := "0.0\"%\""
	if c.percent, err = c.f.NewStyle(&excelize.Style{CustomNumFmt: &pct}); err != nil {
		return err
	}
	date := "dd.mm.yyyy"
	if c.date, err = c.f.NewStyle(&excelize.Style{CustomNumFmt: &date}); err != nil {
		return err
	}
	if c.bold, err = c.f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}}); err != nil {
		return err
	}
	if c.warnText, err = c.f.NewStyle(&excelize.Style{
		Font:      &excelize.Font{Bold: true, Color: "9A3412"},
		Alignment: &excelize.Alignment{WrapText: true, Vertical: "top"},
	}); err != nil {
		return err
	}
	return nil
}

// ─── низкоуровневые helpers (все user-строки — через SafeExcelText) ─────────

func cell(col, row int) string {
	name, _ := excelize.CoordinatesToCellName(col, row)
	return name
}

func (c *renderCtx) setText(sheet string, col, row int, v string, style int) {
	_ = c.f.SetCellStr(sheet, cell(col, row), SafeExcelText(v))
	if style != 0 {
		_ = c.f.SetCellStyle(sheet, cell(col, row), cell(col, row), style)
	}
}

// setMoney — server-authoritative числа пишутся числовыми ячейками (НЕ text и
// НЕ формулами); nil → «—».
func (c *renderCtx) setMoney(sheet string, col, row int, v *float64) {
	if v == nil {
		c.setText(sheet, col, row, "—", c.text)
		return
	}
	_ = c.f.SetCellValue(sheet, cell(col, row), *v)
	_ = c.f.SetCellStyle(sheet, cell(col, row), cell(col, row), c.money)
}

func (c *renderCtx) setNumber(sheet string, col, row int, v float64) {
	_ = c.f.SetCellValue(sheet, cell(col, row), v)
}

func (c *renderCtx) setPercent(sheet string, col, row int, v float64) {
	_ = c.f.SetCellValue(sheet, cell(col, row), v)
	_ = c.f.SetCellStyle(sheet, cell(col, row), cell(col, row), c.percent)
}

// setDate — даты как Excel date cells (§16); нераспознанное — текстом.
func (c *renderCtx) setDate(sheet string, col, row int, raw string) {
	if raw == "" {
		c.setText(sheet, col, row, "—", c.text)
		return
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05Z", "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			_ = c.f.SetCellValue(sheet, cell(col, row), t)
			_ = c.f.SetCellStyle(sheet, cell(col, row), cell(col, row), c.date)
			return
		}
	}
	c.setText(sheet, col, row, raw, c.text)
}

// tableHeader — заголовки + freeze pane + autofilter (§16).
func (c *renderCtx) tableHeader(sheet string, row int, headers []string, widths []float64) error {
	for i, h := range headers {
		c.setText(sheet, i+1, row, h, c.header)
	}
	if err := c.f.SetPanes(sheet, &excelize.Panes{
		Freeze: true, YSplit: row, TopLeftCell: cell(1, row+1), ActivePane: "bottomLeft",
	}); err != nil {
		return err
	}
	for i, w := range widths {
		col, _ := excelize.ColumnNumberToName(i + 1)
		_ = c.f.SetColWidth(sheet, col, col, w)
	}
	return nil
}

func (c *renderCtx) autoFilter(sheet string, headerRow, lastRow, cols int) {
	if lastRow < headerRow {
		lastRow = headerRow
	}
	_ = c.f.AutoFilter(sheet, cell(1, headerRow)+":"+cell(cols, lastRow), nil)
}

// guardRows — safety-лимит (§18): частично повреждённый файл не создаётся.
func guardRows(sheet string, n int) error {
	if n > MaxDetailRowsPerSheet {
		return &ErrReportTooLarge{Sheet: sheet, Rows: n}
	}
	return nil
}

// kv — пара «метка: значение» на сводных листах.
func (c *renderCtx) kv(sheet string, row int, label, value string) int {
	c.setText(sheet, 1, row, label, c.bold)
	c.setText(sheet, 2, row, value, c.wrap)
	return row + 1
}

func fmtInt(v int) string { return fmt.Sprintf("%d", v) }

func fmtMoneyPtr(v *float64) string {
	if v == nil {
		return "—"
	}
	return fmt.Sprintf("%.2f", *v)
}
