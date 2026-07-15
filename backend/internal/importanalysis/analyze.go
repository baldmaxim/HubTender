package importanalysis

import (
	"fmt"
	"sort"
	"strings"
)

// NormalizedItem — нормализованная строка для существующего import-контура
// (service мапит её 1:1 в repository.ImportBoqItem; НИКАКОЙ финансовой
// математики здесь нет).
type NormalizedItem struct {
	ExcelRow         int
	PositionID       string
	TempID           *string
	ParentTempID     *string
	BoqItemType      string
	WorkNameID       *string
	MaterialNameID   *string
	UnitCode         *string
	Quantity         *float64
	BaseQuantity     *float64
	ConversionCoeff  *float64
	ConsumptionCoeff *float64
	UnitRate         *float64
	CurrencyType     *string
	DeliveryType     *string
	DeliveryAmount   *float64
	DetailCategoryID *string
	Description      *string
	QuoteLink        *string
	QuotePriceDate   *string
	QuoteValidUntil  *string
	// Диагностический клиентский total (§5): передаётся существующему
	// mismatch-report'у и НИКОГДА не персистится как результат.
	ClientTotalDiagnostic *float64
	// Этап 2.3: alias, разрешивший номенклатуру строки (для use-счётчиков
	// ПОСЛЕ успешного импорта). Финансовых данных не несёт.
	AliasID string
}

// Analysis — результат Analyze: API-Result + нормализованные строки для
// execute (frontend их не передаёт — сервер строит сам).
type Analysis struct {
	Result Result
	Items  []NormalizedItem
}

type analyzer struct {
	wb    *Workbook
	sheet *Sheet
	opts  Options
	refs  Refs

	headerRow0   int // 0-based
	colByField   map[string]columnInfo
	fixedByField map[string]string
	decimalComma bool

	issues  []Issue
	rows    []PreviewRow
	items   []NormalizedItem
	summary Summary
	formats DetectedFormats
}

// Analyze — pure-анализ (§2B): выбор листа, header, mapping, нормализация,
// row issues. Workbook не мутируется; БД не трогается (refs загружены заранее).
func Analyze(wb *Workbook, opts Options, refs Refs) (*Analysis, error) {
	scores := scoreSheets(wb)
	res := Result{
		WorkbookFingerprint: wb.Fingerprint,
		FileName:            wb.FileName,
		SheetConfidence:     ConfidenceHigh,
	}
	for _, sc := range scores {
		res.Sheets = append(res.Sheets, SheetInfo{
			Name: wb.Sheets[sc.idx].Name, RowsDetected: sc.dataRows,
			ColumnsDetected: sheetWidth(&wb.Sheets[sc.idx]), Score: round2(sc.score),
		})
	}
	// Выбор листа: явный параметр либо лучший score (§6).
	selIdx := -1
	if opts.SheetName != "" {
		for i := range wb.Sheets {
			if wb.Sheets[i].Name == opts.SheetName {
				selIdx = i
				break
			}
		}
		if selIdx < 0 {
			return nil, &InvalidWorkbookError{Reason: "лист «" + opts.SheetName + "» не найден"}
		}
	} else {
		selIdx = scores[0].idx
		if len(scores) > 1 && scores[0].score > 0 &&
			scores[1].score >= scores[0].score*(1-CloseSheetScoreDelta) {
			res.SheetConfidence = ConfidenceMedium // близкие score → подтверждение
		}
	}
	for i := range res.Sheets {
		res.Sheets[i].Suggested = wb.Sheets[selIdx].Name == res.Sheets[i].Name
	}
	sheet := &wb.Sheets[selIdx]
	res.SelectedSheet = sheet.Name

	// Header row: явный либо detected.
	hs := detectHeaderRow(sheet.Rows)
	headerRow0 := hs.row
	if opts.HeaderRow > 0 {
		headerRow0 = opts.HeaderRow - 1
	}
	if headerRow0 < 0 || headerRow0 >= len(sheet.Rows) {
		return nil, &InvalidWorkbookError{Reason: "не удалось определить строку заголовков"}
	}
	res.DetectedHeaderRow = headerRow0 + 1
	for _, hc := range sheet.Rows[headerRow0] {
		res.RawHeaders = append(res.RawHeaders, hc.Raw)
	}

	a := &analyzer{wb: wb, sheet: sheet, opts: opts, refs: refs, headerRow0: headerRow0,
		colByField: map[string]columnInfo{}, fixedByField: map[string]string{}}
	a.profileFormats()

	// Колонки + профили + mapping.
	cols := a.buildColumns()
	mapping := suggestMapping(cols, len(sheet.Rows)-headerRow0-1)
	a.applyOverrides(mapping, cols)
	res.Mapping = mapping

	for _, m := range mapping {
		if m.SourceColumn != "" {
			for _, c := range cols {
				if c.name == m.SourceColumn {
					a.colByField[m.TargetField] = c
				}
			}
		}
		if m.FixedValue != "" {
			a.fixedByField[m.TargetField] = m.FixedValue
		}
		if m.Required && m.SourceColumn == "" && m.FixedValue == "" {
			a.summary.RequiredMappingsMissing++
			a.addIssue(Issue{Code: "REQUIRED_MAPPING_MISSING", Severity: SeverityBlocker,
				TargetField: m.TargetField,
				Message:     "Обязательное поле «" + m.Label + "» не сопоставлено с колонкой",
				FixHint:     "Выберите колонку на шаге сопоставления"})
		}
	}

	a.processRows()

	res.DetectedFormats = a.formats
	res.Summary = a.summary
	res.PreviewRows = a.rows
	if len(res.PreviewRows) > PreviewRowsLimit {
		res.PreviewRows = res.PreviewRows[:PreviewRowsLimit]
	}
	sort.SliceStable(a.issues, func(i, j int) bool {
		if a.issues[i].ExcelRow != a.issues[j].ExcelRow {
			return a.issues[i].ExcelRow < a.issues[j].ExcelRow
		}
		return a.issues[i].ID < a.issues[j].ID
	})
	res.Issues = a.issues
	return &Analysis{Result: res, Items: a.items}, nil
}

func sheetWidth(s *Sheet) int {
	w := 0
	for _, r := range s.Rows {
		if len(r) > w {
			w = len(r)
		}
	}
	return w
}

// profileFormats — детект десятичного разделителя по данным (§8).
func (a *analyzer) profileFormats() {
	comma, dot := 0, 0
	for ri := a.headerRow0 + 1; ri < len(a.sheet.Rows) && ri < a.headerRow0+200; ri++ {
		for _, c := range a.sheet.Rows[ri] {
			s := strings.TrimSpace(c.Raw)
			if strings.ContainsAny(s, "0123456789") {
				if strings.Contains(s, ",") {
					comma++
				}
				if strings.Contains(s, ".") {
					dot++
				}
			}
		}
	}
	a.decimalComma = comma >= dot || a.opts.Locale == "" || strings.HasPrefix(a.opts.Locale, "ru")
	a.formats.DecimalSeparator = "."
	if a.decimalComma {
		a.formats.DecimalSeparator = ","
	}
	if comma > 0 && dot > 0 {
		a.formats.DecimalSeparator = "mixed"
	}
	a.formats.ThousandsSeparator = " "
}

func (a *analyzer) buildColumns() []columnInfo {
	header := a.sheet.Rows[a.headerRow0]
	cols := make([]columnInfo, 0, len(header))
	for ci := range header {
		info := columnInfo{
			index: ci, name: columnName(ci),
			header:  strings.TrimSpace(header[ci].Raw),
			normHdr: normText(header[ci].Raw),
			profile: profileColumn(a.sheet.Rows, a.headerRow0+1, ci, 200),
		}
		cols = append(cols, info)
	}
	return cols
}

// applyOverrides — пользовательский выбор колонок/фиксированных значений.
func (a *analyzer) applyOverrides(mapping []Mapping, cols []columnInfo) {
	if len(a.opts.MappingOverrides) == 0 {
		return
	}
	for i := range mapping {
		ov, ok := a.opts.MappingOverrides[mapping[i].TargetField]
		if !ok {
			continue
		}
		mapping[i].SourceColumn, mapping[i].SourceHeader, mapping[i].FixedValue = "", "", ""
		switch {
		case ov == "":
			mapping[i].Confidence = ConfidenceUnresolved
		case strings.HasPrefix(ov, "="):
			mapping[i].FixedValue = strings.TrimPrefix(ov, "=")
			mapping[i].Confidence = ConfidenceHigh
			mapping[i].ConfidencePercent = 100
			mapping[i].Reasons = []string{"Фиксированное значение задано пользователем"}
		default:
			for _, c := range cols {
				if c.name == ov {
					mapping[i].SourceColumn, mapping[i].SourceHeader = c.name, c.header
					mapping[i].Confidence = ConfidenceHigh
					mapping[i].ConfidencePercent = 100
					mapping[i].Reasons = []string{"Колонка выбрана пользователем"}
				}
			}
		}
		// Этап 2.3 (§5): происхождение из сохранённого профиля явно видно;
		// отсутствующая в файле колонка остаётся unresolved и не скрывается.
		if a.opts.ProfileFields[mapping[i].TargetField] {
			mapping[i].Source = "saved_profile"
			if mapping[i].SourceColumn != "" || mapping[i].FixedValue != "" {
				mapping[i].Reasons = []string{"Из сохранённого профиля («Подтверждено вами ранее»)"}
			} else {
				mapping[i].Reasons = []string{"Колонка из профиля не найдена в файле — требуется выбор"}
			}
		}
	}
}

// ─── строки ──────────────────────────────────────────────────────────────────

func (a *analyzer) cellFor(row []Cell, field string) (Cell, string, bool) {
	if fixed, ok := a.fixedByField[field]; ok {
		return Cell{Raw: fixed}, "fixed", true
	}
	col, ok := a.colByField[field]
	if !ok || col.index >= len(row) {
		return Cell{}, "", false
	}
	return row[col.index], col.name, true
}

func (a *analyzer) addIssue(is Issue) string {
	is.Sheet = a.sheet.Name
	fp := a.wb.Fingerprint
	if len(fp) > 12 {
		fp = fp[:12]
	}
	is.ID = fmt.Sprintf("%s|%s|%d|%s|%s", fp, is.Sheet, is.ExcelRow, is.TargetField, is.Code)
	a.issues = append(a.issues, is)
	return is.ID
}

// classifySkip — §12: пустые/footer/повторный header/section rows.
func (a *analyzer) classifySkip(row []Cell) string {
	if !rowNonEmpty(row) {
		return SkipEmpty
	}
	// повторный header: совпадает с header-строкой по normalized-значениям.
	same, headerCells := 0, 0
	for ci, hc := range a.sheet.Rows[a.headerRow0] {
		hn := normText(hc.Raw)
		if hn == "" {
			continue
		}
		headerCells++
		if ci < len(row) && normText(row[ci].Raw) == hn {
			same++
		}
	}
	if headerCells > 2 && same >= headerCells-1 {
		return SkipRepeatHeader
	}
	// footer: точный маркер в текстовой ячейке + отсутствие qty/rate.
	qtyCell, _, hasQty := a.cellFor(row, FieldQuantity)
	rateCell, _, hasRate := a.cellFor(row, FieldUnitRate)
	_, qtyOK := parsedNumber(qtyCell, hasQty, a.decimalComma)
	_, rateOK := parsedNumber(rateCell, hasRate, a.decimalComma)
	hasFooterMarker := false
	for _, c := range row {
		if footerMarkers[normText(c.Raw)] {
			hasFooterMarker = true
		}
	}
	if hasFooterMarker && !qtyOK && !rateOK {
		return SkipFooter
	}
	// section row: есть описание/позиция, но нет ни qty, ни rate, ни unit.
	descCell, _, hasDesc := a.cellFor(row, FieldDescription)
	unitCell, _, hasUnit := a.cellFor(row, FieldUnit)
	if hasDesc && strings.TrimSpace(descCell.Raw) != "" && !qtyOK && !rateOK &&
		(!hasUnit || strings.TrimSpace(unitCell.Raw) == "") {
		return SkipSectionRow
	}
	return ""
}

func parsedNumber(c Cell, has bool, decimalComma bool) (float64, bool) {
	if !has || strings.TrimSpace(c.Raw) == "" {
		return 0, false
	}
	v, _, ok := ParseNumber(c.Raw, decimalComma)
	return v, ok
}

// authoritativeNumericFields — формула здесь = policy §9.
var authoritativeNumericFields = map[string]bool{
	FieldQuantity: true, FieldUnitRate: true, FieldBaseQuantity: true,
	FieldConversionCoeff: true, FieldConsumption: true, FieldDeliveryAmount: true,
}

func (a *analyzer) processRows() {
	tempSeen := map[string]int{}
	workTemp := map[string]bool{} // temp id → является работой
	for ri := a.headerRow0 + 1; ri < len(a.sheet.Rows); ri++ {
		excelRow := ri + 1
		row := a.sheet.Rows[ri]
		pr := PreviewRow{ExcelRow: excelRow, Status: RowReady, Raw: map[string]string{}}
		a.summary.RowsTotal++

		if code := a.classifySkip(row); code != "" {
			pr.Status = RowSkipped
			pr.SkipCode = code
			a.summary.RowsSkipped++
			a.summary.RowsTotal-- // §3: rows_total — данные, не служебные строки
			if code != SkipEmpty {
				id := a.addIssue(Issue{Code: code, Severity: SeverityWarning, ExcelRow: excelRow,
					Message: "Строка распознана как служебная и будет пропущена",
					FixHint: "Если это данные — проверьте mapping/заголовки"})
				pr.IssueIDs = append(pr.IssueIDs, id)
				a.rows = append(a.rows, pr)
			}
			continue
		}

		it := NormalizedItem{ExcelRow: excelRow}
		blocked, warned := false, false
		blockedF := func() { blocked = true }
		warnedF := func() { warned = true }

		a.extractRow(row, &pr, &it, excelRow, tempSeen, workTemp, blockedF, warnedF)

		switch {
		case blocked:
			pr.Status = RowBlocked
			a.summary.RowsBlocked++
		case warned:
			pr.Status = RowWarning
			a.summary.RowsWithWarnings++
			a.items = append(a.items, it)
		default:
			pr.Status = RowReady
			a.summary.RowsReady++
			a.items = append(a.items, it)
		}
		a.rows = append(a.rows, pr)
	}
}
