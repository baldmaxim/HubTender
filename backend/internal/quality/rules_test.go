package quality

import (
	"strings"
	"testing"
)

// Каталог встроен в бинарь и разбирается в init(), поэтому битый файл роняет
// сервис при старте. Тест ловит это на сборке, а не в проде.

func TestCatalogParses(t *testing.T) {
	all := All()
	if len(all) == 0 {
		t.Fatal("каталог правил пуст")
	}
	if len(Active()) == 0 {
		t.Fatal("нет ни одного активного правила")
	}
}

func TestRulesHaveUniqueCodes(t *testing.T) {
	seen := make(map[string]bool)
	for _, r := range All() {
		if seen[r.Code] {
			t.Errorf("код %q встречается дважды", r.Code)
		}
		seen[r.Code] = true
	}
}

func TestActiveRulesSatisfyContract(t *testing.T) {
	for _, r := range Active() {
		t.Run(r.Code, func(t *testing.T) {
			if !strings.Contains(r.SQL, "$1") {
				t.Error("в SQL нет параметра $1 — правило гонялось бы по всей базе")
			}
			for _, col := range requiredColumns {
				if !strings.Contains(r.SQL, col) {
					t.Errorf("в SQL нет обязательной колонки %q", col)
				}
			}
			if strings.TrimSpace(r.Summary) == "" {
				t.Error("пустая секция «Суть» — инженеру нечего показать на странице")
			}
			if strings.TrimSpace(r.Title) == "" {
				t.Error("пустой title")
			}
		})
	}
}

func TestSeverityIsKnown(t *testing.T) {
	for _, r := range All() {
		switch r.Severity {
		case SeverityError, SeverityWarning, SeverityInfo:
		default:
			t.Errorf("%s: неизвестный severity %q", r.Code, r.Severity)
		}
	}
}

// Регресс на реальные дефекты, которые уже ловились при разработке каталога.
func TestParseRuleRejectsBrokenInput(t *testing.T) {
	cases := map[string]string{
		"без фронтматтера": "## Суть\nтекст\n",
		"нет SQL":          "---\ncode: X\ntitle: T\nseverity: error\nstatus: active\nentity_type: boq_item\n---\n## Суть\nтекст\n",
		"SQL без $1": "---\ncode: X\ntitle: T\nseverity: error\nstatus: active\nentity_type: boq_item\n---\n" +
			"## SQL\n```sql\nSELECT tender_id, position_number, item_no, entity_id," +
			" fingerprint, detail, money_delta FROM t\n```\n",
		"нет колонки money_delta": "---\ncode: X\ntitle: T\nseverity: error\nstatus: active\nentity_type: boq_item\n---\n" +
			"## SQL\n```sql\nSELECT tender_id, position_number, item_no, entity_id," +
			" fingerprint, detail FROM t WHERE tender_id = $1\n```\n",
		"нет entity_type":    "---\ncode: X\ntitle: T\nseverity: error\nstatus: draft\n---\n",
		"плохой entity_type": "---\ncode: X\ntitle: T\nseverity: error\nstatus: draft\nentity_type: row\n---\n",
		"плохой severity":    "---\ncode: X\ntitle: T\nseverity: critical\nstatus: active\nentity_type: boq_item\n---\n",
	}
	for name, src := range cases {
		if _, err := parseRule(src); err == nil {
			t.Errorf("%s: ожидалась ошибка разбора, её нет", name)
		}
	}
}

// Черновик не выполняется, поэтому SQL для него не обязателен.
func TestDraftRuleNeedsNoSQL(t *testing.T) {
	src := "---\ncode: Z\ntitle: Черновик\nseverity: warning\nstatus: draft\nentity_type: boq_item\n---\n## Суть\nидея\n"
	r, err := parseRule(src)
	if err != nil {
		t.Fatalf("черновик без SQL должен разбираться: %v", err)
	}
	if r.Status != "draft" {
		t.Errorf("status = %q, ожидался draft", r.Status)
	}
}

// Тип сущности задаёт, куда ведёт находка и кому она адресуется. Позиционные
// правила обязаны указывать на client_positions — на этом построены переход к
// строке и группировка по разделам.
func TestEntityTypeMatchesEntitySource(t *testing.T) {
	for _, r := range All() {
		if r.SQL == "" {
			continue
		}
		pos := strings.Contains(r.SQL, "cp.id AS entity_id")
		if pos && r.EntityType != EntityClientPosition {
			t.Errorf("%s: entity_id берётся из client_positions, а entity_type = %q", r.Code, r.EntityType)
		}
		if !pos && r.EntityType == EntityClientPosition && !strings.Contains(r.SQL, "l.id AS entity_id") {
			t.Errorf("%s: entity_type = client_position, но entity_id не из позиции", r.Code)
		}
	}
}
