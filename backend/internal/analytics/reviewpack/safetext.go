package reviewpack

import (
	"strings"
	"unicode"
)

// MaxDetailRowsPerSheet — safety-лимит табличного листа (§18): Excel допускает
// 1 048 576 строк, но in-memory генерация 6 листов держит разумный предел.
// Типичный максимальный BOQ проекта — тысячи строк; 50 000 на лист даёт
// многократный запас без риска гигантского файла.
const MaxDetailRowsPerSheet = 50000

// ErrReportTooLarge — превышен safety-лимит (§18) → HTTP 413.
type ErrReportTooLarge struct {
	Sheet string
	Rows  int
}

func (e *ErrReportTooLarge) Error() string {
	return "REVIEW_REPORT_TOO_LARGE: sheet " + e.Sheet
}

// SafeExcelText — единый helper защиты от formula injection (§17).
// Строка, начинающаяся (после trim-left) с '=', '+', '-', '@', получает
// префикс-апостроф семантически: excelize пишет строки как sharedStrings (не
// формулы), но клетку с ведущим '=' Excel может интерпретировать при
// копировании/CSV-конверсии — поэтому опасный префикс нейтрализуется
// видимым безопасным способом: перед ним ставится одинарная кавычка-символ.
// Control-символы (кроме \n и \t) удаляются. HTML-escaping НЕ используется.
func SafeExcelText(s string) string {
	// нормализуем control chars
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\n' || r == '\t' {
			b.WriteRune(r)
			continue
		}
		if r < 0x20 || r == 0x7f || unicode.Is(unicode.Cf, r) {
			continue // управляющие и format-символы удаляются
		}
		b.WriteRune(r)
	}
	out := b.String()
	trimmed := strings.TrimLeft(out, " \t")
	if trimmed != "" {
		switch trimmed[0] {
		case '=', '+', '-', '@':
			return "'" + out
		}
	}
	return out
}

// SafeFilename — безопасное имя файла (§6): исключает / \ : * ? " < > |,
// control chars и path traversal; ограничивает длину; сохраняет читаемый
// номер/label тендера.
func SafeFilename(parts ...string) string {
	joined := strings.Join(parts, "_")
	var b strings.Builder
	for _, r := range joined {
		switch {
		case r < 0x20 || r == 0x7f:
			continue
		case strings.ContainsRune(`/\:*?"<>|`, r):
			b.WriteRune('-')
		default:
			b.WriteRune(r)
		}
	}
	name := b.String()
	name = strings.ReplaceAll(name, "..", "-") // никакого traversal
	name = strings.Trim(name, " .-_")
	if name == "" {
		name = "review-report"
	}
	// ограничение длины по рунам (UTF-8 safe)
	runes := []rune(name)
	if len(runes) > 120 {
		name = string(runes[:120])
	}
	return name + ".xlsx"
}
