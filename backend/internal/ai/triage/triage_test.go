package triage

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// insulation — пример из разбора «Большой Татарской»: утеплитель двумя слоями.
func insulation() Batch {
	return Batch{
		Position: Position{
			ID: "pos-1", ItemNo: "16.3", CustomerName: "Утепление стен минплитой, толщина 150 мм",
			Unit: "м2", CustomerVolume: "102.61", GPVolume: "102.61",
			Rows: []Row{
				{ID: "w1", Type: "раб", Name: "Монтаж утеплителя", Unit: "м2", Quantity: "102.61", UnitRate: "900", Total: "92349"},
				{ID: "m1", Type: "мат", Name: "ТЕХНОФАС ОПТИМА", Unit: "м3", Quantity: "5.900075",
					ConversionCoefficient: "0.05", ConsumptionCoefficient: "1.15", UnitRate: "9068", Total: "53502", ParentWorkID: "w1"},
				{ID: "m2", Type: "мат", Name: "ТЕХНОФАС ОПТИМА", Unit: "м3", Quantity: "11.80015",
					ConversionCoefficient: "0.1", ConsumptionCoefficient: "1.15", UnitRate: "9068", Total: "107004", ParentWorkID: "w1"},
			},
		},
		Findings: []Finding{
			{ID: "find-1", RuleCode: "GA", RuleTitle: "Дубль материала", Detail: "ТЕХНОФАС ОПТИМА заведён 2 раза",
				EntityType: "boq_item", EntityID: "m1", Fingerprint: "fp1"},
			{ID: "find-2", RuleCode: "QA", RuleTitle: "Нулевая цена", Detail: "без цены",
				EntityType: "client_position", EntityID: "pos-1", Fingerprint: "fp2"},
		},
	}
}

func TestPrepareReferencesAndFacts(t *testing.T) {
	p, err := Prepare(insulation())
	if err != nil {
		t.Fatal(err)
	}
	var got payload
	if err := json.Unmarshal(p.JSON, &got); err != nil {
		t.Fatal(err)
	}
	if got.Findings[0].Row != "r2" || got.Position.Rows[1].BoundToWork != "r1" {
		t.Fatalf("псевдонимы строк: %+v", got)
	}
	if p.Facts["r3.conversion_coefficient"] != "0.1" || p.Facts["p1.customer_name"] == "" {
		t.Fatalf("факты: %v", p.Facts)
	}
	if strings.Contains(string(p.JSON), "pos-1") || strings.Contains(string(p.JSON), "find-1") {
		t.Fatal("внутренние id не должны уходить модели")
	}
	if p.FindingRefs["f2"] != "find-2" {
		t.Fatalf("ссылки находок: %v", p.FindingRefs)
	}
}

func TestPrepareKeepsReferencedRowsWhenTruncating(t *testing.T) {
	b := insulation()
	var rows []Row
	for i := 0; i < 100; i++ {
		rows = append(rows, Row{ID: fmt.Sprintf("x%d", i), Type: "мат", Name: "Прочее"})
	}
	rows = append(rows, Row{ID: "w1", Type: "раб", Name: "Монтаж"}, Row{ID: "m1", Type: "мат", Name: "Плита", ParentWorkID: "w1"})
	b.Position.Rows = rows
	p, err := Prepare(b)
	if err != nil {
		t.Fatal(err)
	}
	var got payload
	_ = json.Unmarshal(p.JSON, &got)
	if len(got.Position.Rows) != MaxRowsPerPosition || got.Position.RowsOmitted != 102-MaxRowsPerPosition {
		t.Fatalf("строк %d, пропущено %d", len(got.Position.Rows), got.Position.RowsOmitted)
	}
	if got.Findings[0].Row == "" {
		t.Fatal("строка находки выпала при усечении")
	}
	var parentKept bool
	for _, r := range got.Position.Rows {
		if r.Name == "Монтаж" {
			parentKept = true
		}
	}
	if !parentKept {
		t.Fatal("работа, к которой привязана строка находки, выпала")
	}
}

func TestValidate(t *testing.T) {
	p, _ := Prepare(insulation())
	answer := `{"assessments":[
	  {"finding":"f1","label":"likely_ok","reason":"Два слоя 50 + 100 мм = 150 мм",
	   "evidence":[{"ref":"r2.conversion_coefficient","value":"0.050"},{"ref":"r3.conversion_coefficient","value":"0.1"},
	               {"ref":"p1.customer_name","value":"Утепление стен минплитой, толщина 150 мм"},
	               {"ref":"r9.quantity","value":"1"},{"ref":"r2.unit_rate","value":"1"}]},
	  {"finding":"f1","label":"likely_error","reason":"дубль","evidence":[]},
	  {"finding":"f7","label":"likely_error","reason":"чужая","evidence":[]}
	]}`
	got, missing, err := Validate(answer, p)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || missing != 1 {
		t.Fatalf("оценок %d, пропущено %d", len(got), missing)
	}
	a := got[0]
	if a.FindingID != "find-1" || a.Label != LabelLikelyOK || len(a.Evidence) != 3 || a.Downgraded {
		t.Fatalf("оценка f1: %+v", a)
	}
	if a.Evidence[0].Value != "0.05" {
		t.Fatal("сохраняется отправленное значение, а не записанное моделью")
	}
	if got[1].FindingID != "find-2" || got[1].Label != LabelUnsure {
		t.Fatalf("пропущенная находка: %+v", got[1])
	}
}

func TestValidateDowngradesUnsupportedVerdict(t *testing.T) {
	p, _ := Prepare(insulation())
	answer := `{"assessments":[
	  {"finding":"f1","label":"likely_ok","reason":"норма","evidence":[{"ref":"r2.conversion_coefficient","value":"0.07"}]},
	  {"finding":"f2","label":"garbage","reason":"x","evidence":[]}]}`
	got, _, err := Validate(answer, p)
	if err != nil {
		t.Fatal(err)
	}
	if got[0].Label != LabelUnsure || !got[0].Downgraded {
		t.Fatalf("вывод с неверным значением должен стать «не уверен»: %+v", got[0])
	}
	if got[1].Label != LabelUnsure {
		t.Fatalf("неизвестная метка: %+v", got[1])
	}
}

func TestValidateRejectsNonJSON(t *testing.T) {
	p, _ := Prepare(insulation())
	if _, _, err := Validate("Вот ответ: норма", p); err != ErrInvalidResponse {
		t.Fatalf("ожидалась ошибка разбора, получено %v", err)
	}
}

func TestSchemaIsValidJSON(t *testing.T) {
	var v map[string]any
	if err := json.Unmarshal(ResponseSchema, &v); err != nil {
		t.Fatal(err)
	}
}
