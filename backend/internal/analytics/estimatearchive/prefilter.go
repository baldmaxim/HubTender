package estimatearchive

import (
	"sort"
	"strings"
	"unicode"
)

// PrefilterTokens — токены для грубого SQL-префильтра по названию
// (`work_name ILIKE '%токен%'`).
//
// ВАЖНО: здесь НЕЛЬЗЯ использовать nomenclature.Tokenize. Та нормализация
// сворачивает кириллические гомоглифы в латиницу (м→m, а→a), что правильно для
// сравнения строк в памяти, но сделало бы ILIKE-паттерн непохожим на сырой
// текст в БД («m150» не найдёт «М150»). Поэтому префильтр работает по сырому
// тексту: только lowercase и разбиение по не-буквенно-цифровым символам.
//
// Токены короче 3 символов отбрасываются — по ним префильтр вырождается в
// полный скан. Значащие (с цифрой: марки, размеры, классы) идут первыми, далее
// самые длинные обычные.
func PrefilterTokens(workName string, max int) []string {
	if max <= 0 {
		max = 4
	}
	fields := strings.FieldsFunc(strings.ToLower(workName), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})

	sig := make([]string, 0, len(fields))
	plain := make([]string, 0, len(fields))
	seen := map[string]bool{}
	for _, t := range fields {
		if len([]rune(t)) < 3 || seen[t] {
			continue
		}
		seen[t] = true
		if hasDigit(t) {
			sig = append(sig, t)
		} else {
			plain = append(plain, t)
		}
	}
	sort.SliceStable(plain, func(a, b int) bool {
		return len([]rune(plain[a])) > len([]rune(plain[b]))
	})

	out := make([]string, 0, len(sig)+len(plain))
	out = append(out, sig...)
	out = append(out, plain...)
	if len(out) > max {
		out = out[:max]
	}
	return out
}

func hasDigit(s string) bool {
	for _, r := range s {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	return false
}
