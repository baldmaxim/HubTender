package nomenclature

// Экспортируемые обёртки над внутренними примитивами текстового сопоставления.
//
// Нужны, чтобы другие пакеты (например analytics/estimatearchive — поиск по
// архиву смет) считали близость названий ТЕМ ЖЕ кодом, а не заводили третью
// реализацию нормализации/токенизации. Пакет остаётся pure: ни сети, ни БД.

// NormalizeMatchText — Unicode-safe нормализация названия (см. normalizeMatchText).
func NormalizeMatchText(s string) string { return normalizeMatchText(s) }

// Tokenize — токены нормализованного текста (см. tokenize).
func Tokenize(s string) []string { return tokenize(s) }

// IsSignificantToken — токен с цифрой: марка/размер/класс (М150, Ø20, 3x2.5).
// Конфликт таких токенов критичен для сопоставления.
func IsSignificantToken(t string) bool { return isSignificantToken(t) }

// UnitCompatibility — exact | unknown | conflict; конверсии единиц не предполагаются.
func UnitCompatibility(rowUnit, catalogUnit string) string {
	return unitCompatibility(rowUnit, catalogUnit)
}
