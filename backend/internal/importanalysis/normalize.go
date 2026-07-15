package importanalysis

import (
	"strconv"
	"strings"
	"time"
	"unicode"
)

// normText — единая нормализация текста: trim + lowercase + collapse
// whitespace (включая NBSP) + Unicode-safe; цифры/марки сохраняются.
func normText(s string) string {
	s = strings.Map(func(r rune) rune {
		if r == ' ' || r == ' ' { // NBSP / narrow NBSP → пробел
			return ' '
		}
		return r
	}, s)
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

// ─── Numbers (§8) ────────────────────────────────────────────────────────────

// ParseNumber — детерминированный разбор числа. Возвращает значение,
// transformation-код и ok. Неоднозначное `1,234` без профиля НЕ угадывается.
func ParseNumber(raw string, decimalComma bool) (float64, string, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return 0, "", false
	}
	// проценты: "12%" → 12 (проценты как число, семантика поля решает).
	percent := false
	if strings.HasSuffix(s, "%") {
		percent = true
		s = strings.TrimSpace(strings.TrimSuffix(s, "%"))
	}
	neg := false
	if strings.HasPrefix(s, "-") || strings.HasPrefix(s, "−") {
		neg = true
		s = strings.TrimLeft(s, "-−")
	}
	// убрать пробелы/NBSP-разделители тысяч
	cleaned := strings.Map(func(r rune) rune {
		if r == ' ' || r == ' ' || r == ' ' || r == '\'' {
			return -1
		}
		return r
	}, s)

	hasComma := strings.Contains(cleaned, ",")
	hasDot := strings.Contains(cleaned, ".")
	code := "NUMBER_PARSED"
	switch {
	case hasComma && hasDot:
		// `1,234.56` — запятая тысячи, точка десятичная (однозначно по порядку)
		if strings.LastIndex(cleaned, ".") > strings.LastIndex(cleaned, ",") {
			cleaned = strings.ReplaceAll(cleaned, ",", "")
			code = "NUMBER_US_FORMAT"
		} else { // `1.234,56`
			cleaned = strings.ReplaceAll(cleaned, ".", "")
			cleaned = strings.Replace(cleaned, ",", ".", 1)
			code = "NUMBER_EU_FORMAT"
		}
	case hasComma:
		parts := strings.Split(cleaned, ",")
		if len(parts) == 2 && len(parts[1]) == 3 && !decimalComma {
			// `1,234` без ru-профиля — неоднозначно: НЕ угадываем.
			return 0, "NUMBER_AMBIGUOUS", false
		}
		cleaned = strings.Replace(cleaned, ",", ".", 1)
		if len(parts) > 2 { // `1,234,567`
			cleaned = strings.ReplaceAll(parts[0]+"."+strings.Join(parts[1:], ""), ".", "")
			return 0, "NUMBER_AMBIGUOUS", false
		}
		code = "NUMBER_DECIMAL_COMMA"
	}
	for _, r := range cleaned {
		if !unicode.IsDigit(r) && r != '.' {
			return 0, "", false
		}
	}
	v, err := strconv.ParseFloat(cleaned, 64)
	if err != nil {
		return 0, "", false
	}
	if neg {
		v = -v
	}
	if percent {
		code = "NUMBER_PERCENT"
	}
	return v, code, true
}

// ─── Currency (§8) ───────────────────────────────────────────────────────────

// builtinCurrencyAliases — canonical enum проекта: RUB/USD/EUR/CNY.
var builtinCurrencyAliases = map[string]string{
	"rub": "RUB", "rur": "RUB", "₽": "RUB", "руб": "RUB", "руб.": "RUB", "рубль": "RUB", "р.": "RUB",
	"usd": "USD", "$": "USD", "долл": "USD", "долл.": "USD", "доллар": "USD",
	"eur": "EUR", "€": "EUR", "евро": "EUR",
	"cny": "CNY", "юань": "CNY", "¥": "CNY", "元": "CNY",
}

// NormalizeCurrency — только canonical enum; неизвестное → !ok.
func NormalizeCurrency(raw string) (string, bool) {
	n := normText(raw)
	if n == "" {
		return "", false
	}
	if v, ok := builtinCurrencyAliases[n]; ok {
		return v, true
	}
	up := strings.ToUpper(n)
	if up == "RUB" || up == "USD" || up == "EUR" || up == "CNY" {
		return up, true
	}
	return "", false
}

// ─── Units (§8) ──────────────────────────────────────────────────────────────

// normalizeUnitKey — м2/м²/м^2 → "м2"; м3/м³/м^3 → "м3"; прочее — normText.
func normalizeUnitKey(raw string) string {
	n := normText(raw)
	n = strings.ReplaceAll(n, "²", "2")
	n = strings.ReplaceAll(n, "³", "3")
	n = strings.ReplaceAll(n, "^2", "2")
	n = strings.ReplaceAll(n, "^3", "3")
	n = strings.TrimSuffix(n, ".")
	return n
}

// NormalizeUnit — exact alias registry поверх канонических units проекта;
// предметно разные единицы НЕ объединяются.
func NormalizeUnit(raw string, units map[string]string) (canonical, code string, ok bool) {
	key := normalizeUnitKey(raw)
	if key == "" {
		return "", "", false
	}
	if v, exists := units[key]; exists {
		if key != normText(raw) {
			return v, "UNIT_NORMALIZED", true
		}
		return v, "", true
	}
	return "", "UNIT_UNKNOWN", false
}

// ─── BOQ type (§8) ───────────────────────────────────────────────────────────

// builtinBoqTypeAliases — только явные значения; классификация по описанию
// строки запрещена.
var builtinBoqTypeAliases = map[string]string{
	"раб": "раб", "работа": "раб", "работы": "раб", "work": "раб",
	"суб-раб": "суб-раб", "суб раб": "суб-раб", "субработа": "суб-раб",
	"раб-комп.": "раб-комп.", "раб-комп": "раб-комп.",
	"мат": "мат", "материал": "мат", "материалы": "мат", "material": "мат",
	"суб-мат": "суб-мат", "суб мат": "суб-мат", "субматериал": "суб-мат",
	"мат-комп.": "мат-комп.", "мат-комп": "мат-комп.",
}

// NormalizeBoqType — explicit-only.
func NormalizeBoqType(raw string) (string, bool) {
	n := normText(raw)
	if v, ok := builtinBoqTypeAliases[n]; ok {
		return v, true
	}
	return "", false
}

// ─── Dates (§8) ──────────────────────────────────────────────────────────────

// dateLayouts — поддерживаемые форматы (Excel-serial приходит уже текстом от
// excelize при типе date; строки — dd.mm.yyyy и ISO).
var dateLayouts = []string{"02.01.2006", "2006-01-02", "02.01.06", "01-02-06", "2/1/2006"}

// NormalizeDate — → YYYY-MM-DD.
func NormalizeDate(raw string) (string, string, bool) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", "", false
	}
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			iso := t.Format("2006-01-02")
			code := ""
			if layout != "2006-01-02" {
				code = "DATE_NORMALIZED"
			}
			return iso, code, true
		}
	}
	return "", "DATE_INVALID", false
}

// ─── Nomenclature (§8): только exact normalized unique match ─────────────────

// MatchNomenclature — exact match; ambiguous → множественный список;
// missing → пусто. Fuzzy/description fallback ЗАПРЕЩЁН.
func MatchNomenclature(raw string, byName map[string][]string) (ids []string) {
	return byName[normText(raw)]
}
