// Package quality — каталог правил проверки данных тендеров.
//
// Правила описаны в rules/*.md: фронтматтер (код, severity, статус), человеческий
// текст «Суть» и один SQL-блок. Файлы встроены в бинарь через go:embed, поэтому
// правила версионируются вместе с кодом и выкатываются атомарно с образом.
//
// Формат и дисциплина порогов — docs/data-quality/README.md.
package quality

import (
	"embed"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

//go:embed rules/*.md
var rulesFS embed.FS

// Severity — уровень находки. error — инвариант нарушен; warning — требует глаза
// инженера; info — не влияет на деньги.
const (
	SeverityError   = "error"
	SeverityWarning = "warning"
	SeverityInfo    = "info"
)

// Rule — одно правило каталога.
type Rule struct {
	Code     string // короткий код: I, J, A, T, ...
	Title    string // заголовок для страницы
	Severity string // error | warning | info
	Money    bool   // считает ли правило денежный эффект
	Status   string // active | draft (draft не выполняется)
	Summary  string // текст «Суть» — показывается инженеру вместо LLM-объяснения
	SQL      string // тело запроса; ровно один параметр $1 = tender_id
}

var (
	frontmatterRe = regexp.MustCompile(`(?s)\A---\r?\n(.*?)\r?\n---\r?\n`)
	sqlBlockRe    = regexp.MustCompile("(?s)```sql\\r?\\n(.*?)```")
	summaryRe     = regexp.MustCompile(`(?s)##\s*Суть\s*\r?\n(.*?)(?:\r?\n##\s|\z)`)
)

// rules — разобранный каталог; заполняется один раз в init.
var rules []Rule

func init() {
	parsed, err := parseAll()
	if err != nil {
		// Каталог встроен в бинарь: битый файл — это ошибка сборки, а не среды.
		// Падаем сразу, чтобы дефект не доехал до прода молча.
		panic(fmt.Sprintf("quality: не удалось разобрать каталог правил: %v", err))
	}
	rules = parsed
}

// All возвращает все правила каталога, включая черновики.
func All() []Rule {
	out := make([]Rule, len(rules))
	copy(out, rules)
	return out
}

// Active возвращает правила со статусом active — только они выполняются.
func Active() []Rule {
	out := make([]Rule, 0, len(rules))
	for _, r := range rules {
		if r.Status == "active" {
			out = append(out, r)
		}
	}
	return out
}

// ByCode находит правило по коду.
func ByCode(code string) (Rule, bool) {
	for _, r := range rules {
		if r.Code == code {
			return r, true
		}
	}
	return Rule{}, false
}

func parseAll() ([]Rule, error) {
	entries, err := rulesFS.ReadDir("rules")
	if err != nil {
		return nil, fmt.Errorf("чтение каталога: %w", err)
	}

	seen := make(map[string]string, len(entries))
	out := make([]Rule, 0, len(entries))

	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".md") {
			continue
		}
		raw, readErr := rulesFS.ReadFile("rules/" + e.Name())
		if readErr != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), readErr)
		}
		r, parseErr := parseRule(string(raw))
		if parseErr != nil {
			return nil, fmt.Errorf("%s: %w", e.Name(), parseErr)
		}
		if prev, dup := seen[r.Code]; dup {
			return nil, fmt.Errorf("%s: код %q уже занят файлом %s", e.Name(), r.Code, prev)
		}
		seen[r.Code] = e.Name()
		out = append(out, r)
	}

	if len(out) == 0 {
		return nil, fmt.Errorf("каталог пуст")
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Code < out[j].Code })
	return out, nil
}

func parseRule(src string) (Rule, error) {
	fm := frontmatterRe.FindStringSubmatch(src)
	if fm == nil {
		return Rule{}, fmt.Errorf("нет фронтматтера")
	}

	r := Rule{Status: "active"}
	for _, line := range strings.Split(fm[1], "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		switch key {
		case "code":
			r.Code = val
		case "title":
			r.Title = val
		case "severity":
			r.Severity = val
		case "status":
			r.Status = val
		case "money":
			r.Money = val == "yes" || val == "true"
		}
	}

	if sql := sqlBlockRe.FindStringSubmatch(src); sql != nil {
		r.SQL = strings.TrimSpace(sql[1])
	}
	if sum := summaryRe.FindStringSubmatch(src); sum != nil {
		r.Summary = strings.TrimSpace(sum[1])
	}

	return r, r.validate()
}

func (r Rule) validate() error {
	switch {
	case r.Code == "":
		return fmt.Errorf("не задан code")
	case r.Title == "":
		return fmt.Errorf("не задан title")
	case r.Severity != SeverityError && r.Severity != SeverityWarning && r.Severity != SeverityInfo:
		return fmt.Errorf("severity %q: допустимы error, warning, info", r.Severity)
	case r.Status != "active" && r.Status != "draft":
		return fmt.Errorf("status %q: допустимы active, draft", r.Status)
	}

	// Черновик не выполняется, поэтому SQL для него не обязателен.
	if r.Status != "active" {
		return nil
	}

	if r.SQL == "" {
		return fmt.Errorf("не найден блок ```sql")
	}
	if !strings.Contains(r.SQL, "$1") {
		return fmt.Errorf("в SQL нет параметра $1 (tender_id) — правило гонялось бы по всей базе")
	}
	for _, col := range requiredColumns {
		if !strings.Contains(r.SQL, col) {
			return fmt.Errorf("в SQL не найдена обязательная колонка %q", col)
		}
	}
	return nil
}

// requiredColumns — контракт выдачи правила (см. docs/data-quality/README.md).
// Проверка грубая (вхождение подстроки), но ловит самое частое: забытую колонку
// при копировании соседнего правила. Точную форму проверяет уже сканирование строк.
var requiredColumns = []string{
	"tender_id", "position_number", "item_no",
	"entity_id", "fingerprint", "detail", "money_delta",
}
