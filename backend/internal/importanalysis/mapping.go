package importanalysis

import (
	"fmt"
	"sort"
	"strings"

	"github.com/xuri/excelize/v2"
)

// FieldRegistry — канонический registry import-полей (§7). Только поля,
// поддерживаемые текущим import flow (§5); слишком общие алиасы исключены.
var FieldRegistry = []FieldSpec{
	{Code: FieldPositionRef, Label: "Позиция заказчика", Required: true, Kind: KindText,
		Aliases: []string{"позиция", "№ позиции", "номер позиции", "поз.", "№ п/п", "position", "п/п"}},
	{Code: FieldBoqType, Label: "Тип строки", Kind: KindEnum,
		Aliases: []string{"тип", "тип строки", "вид", "type"}},
	{Code: FieldDescription, Label: "Наименование/описание", Required: true, Kind: KindText,
		Aliases: []string{"наименование", "описание", "наименование работ", "наименование работ и затрат", "description", "работы"}},
	{Code: FieldNomenclature, Label: "Номенклатура", Kind: KindText,
		Aliases: []string{"номенклатура", "справочник", "nomenclature"}},
	{Code: FieldUnit, Label: "Единица измерения", Required: true, Kind: KindText,
		Aliases: []string{"ед. изм.", "ед.изм.", "ед изм", "единица", "единица измерения", "unit", "ед."}},
	{Code: FieldQuantity, Label: "Количество", Required: true, Kind: KindNumber,
		Aliases: []string{"количество", "кол-во", "кол.", "объем", "объём", "qty", "quantity"}},
	{Code: FieldBaseQuantity, Label: "Базовое количество", Kind: KindNumber,
		Aliases: []string{"базовое количество", "баз. кол-во", "base qty"}},
	{Code: FieldConversionCoeff, Label: "Коэффициент перевода", Kind: KindNumber,
		Aliases: []string{"коэффициент перевода", "коэф. перевода", "к. перевода"}},
	{Code: FieldUnitRate, Label: "Цена за единицу", Required: true, Kind: KindNumber,
		Aliases: []string{"цена", "цена за ед.", "цена за единицу", "расценка", "ставка", "unit price", "rate", "цена, руб"}},
	{Code: FieldCurrency, Label: "Валюта", Kind: KindEnum,
		Aliases: []string{"валюта", "currency", "вал."}},
	{Code: FieldConsumption, Label: "Коэффициент расхода", Kind: KindNumber,
		Aliases: []string{"коэффициент расхода", "коэф. расхода", "расход", "норма расхода"}},
	{Code: FieldDeliveryType, Label: "Тип доставки", Kind: KindEnum,
		Aliases: []string{"тип доставки", "доставка (тип)"}},
	{Code: FieldDeliveryAmount, Label: "Сумма доставки", Kind: KindNumber,
		Aliases: []string{"доставка", "сумма доставки", "стоимость доставки"}},
	{Code: FieldDetailCategory, Label: "Затрата на строительство", Kind: KindText,
		Aliases: []string{"затрата", "затраты на строительство", "категория затрат", "статья затрат"}},
	{Code: FieldParentRef, Label: "Родительская работа (ссылка)", Kind: KindText,
		Aliases: []string{"родитель", "родительская работа", "parent", "ссылка на работу"}},
	{Code: FieldTempID, Label: "Идентификатор строки (temp)", Kind: KindText,
		Aliases: []string{"id строки", "temp id", "идентификатор"}},
	{Code: FieldQuoteLink, Label: "Источник цены", Kind: KindText,
		Aliases: []string{"источник", "источник цены", "кп", "ссылка на кп", "quote"}},
	{Code: FieldQuotePriceDate, Label: "Дата цены", Kind: KindDate,
		Aliases: []string{"дата цены", "дата кп", "дата предложения"}},
	{Code: FieldQuoteValidUntil, Label: "Срок действия цены", Kind: KindDate,
		Aliases: []string{"действительно до", "срок действия", "срок кп"}},
	// Diagnostic-only (§5): никогда не входит в financial persistence.
	{Code: FieldClientTotal, Label: "Сумма (диагностика)", Kind: KindNumber, DiagnosticOnly: true,
		Aliases: []string{"сумма", "итого по строке", "стоимость", "total", "сумма, руб"}},
}

var fieldByCode = func() map[string]*FieldSpec {
	m := map[string]*FieldSpec{}
	for i := range FieldRegistry {
		m[FieldRegistry[i].Code] = &FieldRegistry[i]
	}
	return m
}()

// aliasIndex — прединдексация алиасов (§16): normalized alias → field code.
var aliasIndex = func() map[string]string {
	m := map[string]string{}
	for _, f := range FieldRegistry {
		for _, a := range f.Aliases {
			m[normText(a)] = f.Code
		}
	}
	return m
}()

// columnProfile — value profile колонки под header-строкой.
type columnProfile struct {
	nonEmpty int
	numbers  int
	dates    int
	texts    int
}

func profileColumn(rows [][]Cell, headerRow, col, limit int) columnProfile {
	p := columnProfile{}
	count := 0
	for ri := headerRow; ri < len(rows) && count < limit; ri++ {
		if col >= len(rows[ri]) {
			continue
		}
		raw := strings.TrimSpace(rows[ri][col].Raw)
		if raw == "" {
			continue
		}
		count++
		p.nonEmpty++
		if _, _, ok := ParseNumber(raw, true); ok {
			p.numbers++
		} else if _, _, ok := NormalizeDate(raw); ok {
			p.dates++
		} else {
			p.texts++
		}
	}
	return p
}

// ─── Header detection (§6) ───────────────────────────────────────────────────

// footerMarkers — точные normalized-значения итоговых строк (§12).
var footerMarkers = map[string]bool{
	"итого": true, "всего": true, "итого:": true, "всего:": true,
	"subtotal": true, "total": true, "итого по смете": true, "итого по разделу": true,
}

type headerScore struct {
	row     int // 0-based
	aliases int
	score   float64
}

// detectHeaderRow — первые HeaderScanRows строк: алиасы + уникальность +
// данные ниже + отсутствие footer-маркеров.
func detectHeaderRow(rows [][]Cell) headerScore {
	best := headerScore{row: -1}
	limit := len(rows)
	if limit > HeaderScanRows {
		limit = HeaderScanRows
	}
	for ri := 0; ri < limit; ri++ {
		row := rows[ri]
		aliases := 0
		nonEmpty := 0
		seen := map[string]bool{}
		unique := true
		footer := false
		for _, c := range row {
			n := normText(c.Raw)
			if n == "" {
				continue
			}
			nonEmpty++
			if seen[n] {
				unique = false
			}
			seen[n] = true
			if _, ok := aliasIndex[n]; ok {
				aliases++
			}
			if footerMarkers[n] {
				footer = true
			}
		}
		if nonEmpty < 2 || footer {
			continue
		}
		dataBelow := 0
		for di := ri + 1; di < len(rows) && di < ri+20; di++ {
			if rowNonEmpty(rows[di]) {
				dataBelow++
			}
		}
		score := float64(aliases)*2 + float64(nonEmpty)*0.2 + float64(dataBelow)*0.1
		if !unique {
			score -= 1
		}
		if score > best.score {
			best = headerScore{row: ri, aliases: aliases, score: score}
		}
	}
	return best
}

func rowNonEmpty(row []Cell) bool {
	for _, c := range row {
		if strings.TrimSpace(c.Raw) != "" {
			return true
		}
	}
	return false
}

// ─── Sheet selection (§6) ────────────────────────────────────────────────────

type sheetScore struct {
	idx      int
	header   headerScore
	dataRows int
	score    float64
}

// scoreSheets — обязательные поля + число data rows + профилируемость.
// Hidden sheet не приоритетен при наличии видимого кандидата; первый лист не
// выбирается только за то, что первый.
func scoreSheets(wb *Workbook) []sheetScore {
	out := make([]sheetScore, 0, len(wb.Sheets))
	for i := range wb.Sheets {
		sh := &wb.Sheets[i]
		hs := detectHeaderRow(sh.Rows)
		data := 0
		if hs.row >= 0 {
			for ri := hs.row + 1; ri < len(sh.Rows); ri++ {
				if rowNonEmpty(sh.Rows[ri]) {
					data++
				}
			}
		}
		s := hs.score + float64(data)*0.01
		if !sh.Visible {
			s *= 0.5
		}
		out = append(out, sheetScore{idx: i, header: hs, dataRows: data, score: s})
	}
	sort.SliceStable(out, func(a, b int) bool { return out[a].score > out[b].score })
	return out
}

// ─── Mapping suggestions (§7) ────────────────────────────────────────────────

type columnInfo struct {
	index   int
	name    string // "A", "B"…
	header  string
	normHdr string
	profile columnProfile
}

// suggestMapping — header match + value profile + конфликты; неоднозначность
// → candidates без случайного выбора.
func suggestMapping(cols []columnInfo, dataRows int) []Mapping {
	type scored struct {
		col    columnInfo
		score  float64
		reason []string
	}
	byField := map[string][]scored{}
	for _, col := range cols {
		if col.normHdr == "" {
			continue
		}
		fieldCode, aliasHit := aliasIndex[col.normHdr]
		for _, spec := range FieldRegistry {
			s := 0.0
			var reasons []string
			if aliasHit && fieldCode == spec.Code {
				s += 0.7
				reasons = append(reasons, "Заголовок соответствует известному алиасу")
			} else if !aliasHit && strings.Contains(col.normHdr, normText(spec.Label)) {
				s += 0.3
				reasons = append(reasons, "Заголовок похож на название поля")
			}
			if s == 0 {
				continue
			}
			// профиль значений
			if col.profile.nonEmpty > 0 {
				numShare := float64(col.profile.numbers) / float64(col.profile.nonEmpty)
				dateShare := float64(col.profile.dates) / float64(col.profile.nonEmpty)
				switch spec.Kind {
				case KindNumber:
					if numShare >= 0.8 {
						s += 0.25
						reasons = append(reasons, fmt.Sprintf("%d%% значений распознаны как числа", int(numShare*100)))
					} else if numShare < 0.3 {
						s -= 0.3
						reasons = append(reasons, "Значения не похожи на числа")
					}
				case KindDate:
					if dateShare >= 0.6 {
						s += 0.25
						reasons = append(reasons, "Значения распознаны как даты")
					}
				case KindText, KindEnum:
					if numShare > 0.9 && spec.Code != FieldPositionRef {
						s -= 0.2
					} else if numShare <= 0.5 {
						s += 0.2
						reasons = append(reasons, "Значения соответствуют типу поля")
					}
				}
			}
			if s > 0 {
				byField[spec.Code] = append(byField[spec.Code], scored{col: col, score: s, reason: reasons})
			}
		}
	}

	usedColumns := map[int]string{}
	out := make([]Mapping, 0, len(FieldRegistry))
	for _, spec := range FieldRegistry {
		m := Mapping{TargetField: spec.Code, Label: spec.Label, Required: spec.Required,
			Confidence: ConfidenceUnresolved, DiagnosticOnly: spec.DiagnosticOnly}
		cands := byField[spec.Code]
		sort.SliceStable(cands, func(a, b int) bool {
			if cands[a].score != cands[b].score {
				return cands[a].score > cands[b].score
			}
			return cands[a].col.index < cands[b].col.index
		})
		for _, c := range cands {
			m.Candidates = append(m.Candidates, MappingCandidate{
				SourceColumn: c.col.name, SourceHeader: c.col.header, Score: round2(c.score),
			})
		}
		if len(cands) > 0 {
			best := cands[0]
			conflictField, taken := usedColumns[best.col.index]
			ambiguous := len(cands) > 1 && cands[1].score >= best.score-0.05
			switch {
			case taken:
				m.Confidence = ConfidenceUnresolved
				m.Reasons = []string{"Колонка уже назначена полю «" + fieldByCode[conflictField].Label + "» — подтвердите вручную"}
			case ambiguous:
				m.SourceColumn, m.SourceHeader = best.col.name, best.col.header
				m.Confidence = ConfidenceLow
				m.ConfidencePercent = 40
				m.Reasons = append(best.reason, "Несколько колонок подходят одинаково — подтвердите выбор")
			default:
				m.SourceColumn, m.SourceHeader = best.col.name, best.col.header
				m.Reasons = best.reason
				switch {
				case best.score >= 0.85:
					m.Confidence, m.ConfidencePercent = ConfidenceHigh, int(85+best.score*10)
				case best.score >= 0.55:
					m.Confidence, m.ConfidencePercent = ConfidenceMedium, int(best.score*100)
				default:
					m.Confidence, m.ConfidencePercent = ConfidenceLow, int(best.score*100)
				}
				usedColumns[best.col.index] = spec.Code
			}
			if m.ConfidencePercent > 99 {
				m.ConfidencePercent = 99
			}
		}
		out = append(out, m)
	}
	return out
}

func round2(v float64) float64 { return float64(int(v*100+0.5)) / 100 }

func columnName(i int) string {
	n, _ := excelize.ColumnNumberToName(i + 1)
	return n
}
