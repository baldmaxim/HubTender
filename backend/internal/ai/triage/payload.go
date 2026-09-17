// Package triage — ИИ-разбор находок проверки данных: сборка контекста для модели,
// промпт со строгой схемой ответа и проверка ответа. Пакет чистый: ни сети, ни БД.
//
// Модель видит позицию заказчика и строки расчёта под короткими псевдонимами (p1, r3,
// f2) и обязана подкреплять оценку ссылками вида «r3.conversion_coefficient» со
// значением, дословно взятым из данных. Сервер сверяет каждую ссылку с тем, что
// реально отправил; оценка без подтверждённых ссылок сводится к «не уверен».
package triage

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// MaxRowsPerPosition — сколько строк позиции уходит модели. Строки, на которые
// указывают находки, и работы, к которым они привязаны, уходят всегда.
const MaxRowsPerPosition = 60

// Position — позиция заказчика с расчётом.
type Position struct {
	ID             string
	ItemNo         string
	CustomerName   string
	Unit           string
	CustomerVolume string
	GPVolume       string
	GPNote         string
	ClientNote     string
	Rows           []Row
}

// Row — строка расчёта. Числа — строками в том виде, в каком лежат в БД
// (trim_scale): так модель цитирует их дословно, а сервер сравнивает строки.
type Row struct {
	ID                     string
	Type                   string
	Name                   string
	Unit                   string
	Quantity               string
	ConversionCoefficient  string
	ConsumptionCoefficient string
	UnitRate               string
	Currency               string
	Total                  string
	ParentWorkID           string
	CostCategory           string
	Description            string
}

// Finding — находка правила.
type Finding struct {
	ID          string
	RuleCode    string
	RuleTitle   string
	RuleSummary string
	Detail      string
	EntityType  string // boq_item | client_position
	EntityID    string
	PositionID  string
	Fingerprint string
}

// Batch — одна позиция и её находки: один запрос к модели.
type Batch struct {
	Position Position
	Findings []Finding
}

type payloadRow struct {
	Ref          string `json:"ref"`
	Type         string `json:"type"`
	Name         string `json:"name"`
	Unit         string `json:"unit,omitempty"`
	Quantity     string `json:"quantity,omitempty"`
	Conversion   string `json:"conversion_coefficient,omitempty"`
	Consumption  string `json:"consumption_coefficient,omitempty"`
	UnitRate     string `json:"unit_rate,omitempty"`
	Currency     string `json:"currency,omitempty"`
	Total        string `json:"total,omitempty"`
	BoundToWork  string `json:"bound_to_work,omitempty"`
	CostCategory string `json:"cost_category,omitempty"`
	Description  string `json:"description,omitempty"`
}

type payloadPosition struct {
	Ref            string       `json:"ref"`
	ItemNo         string       `json:"item_no,omitempty"`
	CustomerName   string       `json:"customer_name"`
	Unit           string       `json:"unit,omitempty"`
	CustomerVolume string       `json:"customer_volume,omitempty"`
	GPVolume       string       `json:"gp_volume,omitempty"`
	GPNote         string       `json:"gp_note,omitempty"`
	ClientNote     string       `json:"client_note,omitempty"`
	Rows           []payloadRow `json:"rows"`
	RowsOmitted    int          `json:"rows_omitted,omitempty"`
}

type payloadFinding struct {
	Ref         string `json:"ref"`
	Rule        string `json:"rule"`
	RuleTitle   string `json:"rule_title"`
	RuleSummary string `json:"rule_summary,omitempty"`
	Detail      string `json:"detail"`
	Row         string `json:"row,omitempty"`
}

type payload struct {
	Position payloadPosition  `json:"position"`
	Findings []payloadFinding `json:"findings"`
}

// Prepared — то, что уходит модели, и всё, чем сервер проверит ответ.
type Prepared struct {
	JSON []byte
	// Facts — «ссылка → значение» по всем полям, которые видела модель.
	Facts map[string]string
	// FindingRefs — «f1 → id находки».
	FindingRefs map[string]string
}

// maxTextRunes — длинные тексты режутся: описание строки заказчика бывает на
// страницу, а модели хватает начала.
const maxTextRunes = 400

func clip(s string) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) > maxTextRunes {
		return string(r[:maxTextRunes]) + "…"
	}
	return s
}

// Prepare собирает запрос по одной позиции.
func Prepare(b Batch) (*Prepared, error) {
	if len(b.Findings) == 0 {
		return nil, fmt.Errorf("triage: пустой пакет")
	}
	p := &Prepared{Facts: map[string]string{}, FindingRefs: map[string]string{}}
	fact := func(ref, field, value string) string {
		if value != "" {
			p.Facts[ref+"."+field] = value
		}
		return value
	}

	rows := selectRows(b)
	rowRef := make(map[string]string, len(rows))
	for i, r := range rows {
		rowRef[r.ID] = fmt.Sprintf("r%d", i+1)
	}

	const posRef = "p1"
	pos := payloadPosition{
		Ref:            posRef,
		ItemNo:         fact(posRef, "item_no", clip(b.Position.ItemNo)),
		CustomerName:   fact(posRef, "customer_name", clip(b.Position.CustomerName)),
		Unit:           fact(posRef, "unit", b.Position.Unit),
		CustomerVolume: fact(posRef, "customer_volume", b.Position.CustomerVolume),
		GPVolume:       fact(posRef, "gp_volume", b.Position.GPVolume),
		GPNote:         fact(posRef, "gp_note", clip(b.Position.GPNote)),
		ClientNote:     fact(posRef, "client_note", clip(b.Position.ClientNote)),
		RowsOmitted:    len(b.Position.Rows) - len(rows),
	}
	for _, r := range rows {
		ref := rowRef[r.ID]
		pr := payloadRow{
			Ref:          ref,
			Type:         fact(ref, "type", r.Type),
			Name:         fact(ref, "name", clip(r.Name)),
			Unit:         fact(ref, "unit", r.Unit),
			Quantity:     fact(ref, "quantity", r.Quantity),
			Conversion:   fact(ref, "conversion_coefficient", r.ConversionCoefficient),
			Consumption:  fact(ref, "consumption_coefficient", r.ConsumptionCoefficient),
			UnitRate:     fact(ref, "unit_rate", r.UnitRate),
			Currency:     fact(ref, "currency", r.Currency),
			Total:        fact(ref, "total", r.Total),
			CostCategory: fact(ref, "cost_category", clip(r.CostCategory)),
			Description:  fact(ref, "description", clip(r.Description)),
		}
		if parent, ok := rowRef[r.ParentWorkID]; ok {
			pr.BoundToWork = fact(ref, "bound_to_work", parent)
		}
		pos.Rows = append(pos.Rows, pr)
	}

	out := payload{Position: pos}
	for i, f := range b.Findings {
		ref := fmt.Sprintf("f%d", i+1)
		p.FindingRefs[ref] = f.ID
		pf := payloadFinding{
			Ref:         ref,
			Rule:        f.RuleCode,
			RuleTitle:   f.RuleTitle,
			RuleSummary: clip(f.RuleSummary),
			Detail:      fact(ref, "detail", f.Detail),
		}
		if f.EntityType == "boq_item" {
			pf.Row = rowRef[f.EntityID]
		}
		out.Findings = append(out.Findings, pf)
	}
	js, err := json.Marshal(out)
	if err != nil {
		return nil, fmt.Errorf("triage: marshal: %w", err)
	}
	p.JSON = js
	return p, nil
}

// selectRows оставляет строки, на которые указывают находки, их работы и первые
// строки позиции по порядку — до MaxRowsPerPosition.
func selectRows(b Batch) []Row {
	rows := b.Position.Rows
	if len(rows) <= MaxRowsPerPosition {
		return rows
	}
	byID := make(map[string]int, len(rows))
	for i, r := range rows {
		byID[r.ID] = i
	}
	keep := map[int]bool{}
	for _, f := range b.Findings {
		if i, ok := byID[f.EntityID]; ok {
			keep[i] = true
			if j, ok := byID[rows[i].ParentWorkID]; ok {
				keep[j] = true
			}
		}
	}
	for i := 0; i < len(rows) && len(keep) < MaxRowsPerPosition; i++ {
		keep[i] = true
	}
	idx := make([]int, 0, len(keep))
	for i := range keep {
		idx = append(idx, i)
	}
	sort.Ints(idx)
	out := make([]Row, 0, len(idx))
	for _, i := range idx {
		out = append(out, rows[i])
	}
	return out
}
