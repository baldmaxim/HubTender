package importanalysis

import "testing"

// §17.12-16: числа.
func TestNumberParsing(t *testing.T) {
	cases := []struct {
		raw   string
		comma bool
		want  float64
		ok    bool
	}{
		{"1 234,56", true, 1234.56, true},  // 12: ru decimal comma
		{"1 234,56", true, 1234.56, true},  // 13: NBSP thousands (обычный пробел уже покрыт)
		{"1 234,56", true, 1234.56, true},  // 13: NBSP
		{"1234.56", true, 1234.56, true},   // 14: dot decimal
		{"1,234.56", false, 1234.56, true}, // US format однозначен
		{"1.234,56", true, 1234.56, true},  // EU format однозначен
		{"1,234", false, 0, false},         // 15: ambiguous без ru-профиля
		{"1,5", true, 1.5, true},           // ru-десятичная
		{"-12,5", true, -12.5, true},       // отрицательное
		{"12%", true, 12, true},            // 16: проценты
		{"мусор", true, 0, false},
	}
	for _, c := range cases {
		v, _, ok := ParseNumber(c.raw, c.comma)
		if ok != c.ok || (ok && v != c.want) {
			t.Fatalf("ParseNumber(%q, comma=%v) = %v,%v; want %v,%v", c.raw, c.comma, v, ok, c.want, c.ok)
		}
	}
	// 15: ambiguous помечается кодом
	if _, code, ok := ParseNumber("1,234", false); ok || code != "NUMBER_AMBIGUOUS" {
		t.Fatalf("ambiguous must not be guessed: code=%s ok=%v", code, ok)
	}
}

// §17.17-21: валюты.
func TestCurrencyAliases(t *testing.T) {
	for raw, want := range map[string]string{
		"руб.": "RUB", "₽": "RUB", "RUR": "RUB", "rub": "RUB", // 17
		"$": "USD", "USD": "USD", "долл.": "USD", // 18
		"€": "EUR", "евро": "EUR", // 19
		"CNY": "CNY", "юань": "CNY", "¥": "CNY", // 20
	} {
		got, ok := NormalizeCurrency(raw)
		if !ok || got != want {
			t.Fatalf("NormalizeCurrency(%q)=%q,%v; want %q", raw, got, ok, want)
		}
	}
	if _, ok := NormalizeCurrency("тугрик"); ok { // 21
		t.Fatal("unknown currency must not normalize")
	}
}

// §17.22-24: единицы.
func TestUnitNormalization(t *testing.T) {
	units := map[string]string{"м2": "м2", "м3": "м3", "шт": "шт"}
	for raw, want := range map[string]string{
		"м²": "м2", "м^2": "м2", "М2": "м2", // 22
		"м³": "м3", "м^3": "м3", // 23
		"шт.": "шт",
	} {
		got, _, ok := NormalizeUnit(raw, units)
		if !ok || got != want {
			t.Fatalf("NormalizeUnit(%q)=%q,%v; want %q", raw, got, ok, want)
		}
	}
	if _, code, ok := NormalizeUnit("попугаи", units); ok || code != "UNIT_UNKNOWN" { // 24
		t.Fatal("unknown unit must not normalize")
	}
	// предметно разные единицы не объединяются: м2 не станет м3.
	if got, _, _ := NormalizeUnit("м²", units); got == "м3" {
		t.Fatal("m² must not merge into m³")
	}
}

// §17.25-27: типы BOQ.
func TestBoqTypeAliases(t *testing.T) {
	if v, ok := NormalizeBoqType("Работа"); !ok || v != "раб" { // 25
		t.Fatalf("work alias: %q %v", v, ok)
	}
	if v, ok := NormalizeBoqType("материал"); !ok || v != "мат" { // 26
		t.Fatalf("material alias: %q %v", v, ok)
	}
	if _, ok := NormalizeBoqType("бетонные работы М300"); ok { // 31: не по описанию
		t.Fatal("must not classify by description text")
	}
}

// §17.28-31: номенклатура exact-only.
func TestNomenclatureExactMatching(t *testing.T) {
	byName := map[string][]string{
		"кладка кирпичная": {"id-1"},
		"бетон":            {"id-2", "id-3"}, // ambiguous
	}
	if ids := MatchNomenclature("  Кладка   кирпичная ", byName); len(ids) != 1 || ids[0] != "id-1" { // 28
		t.Fatalf("exact unique match failed: %v", ids)
	}
	if ids := MatchNomenclature("Бетон", byName); len(ids) != 2 { // 29
		t.Fatalf("ambiguous must return all: %v", ids)
	}
	if ids := MatchNomenclature("штукатурка", byName); len(ids) != 0 { // 30
		t.Fatalf("missing must be empty: %v", ids)
	}
	// 31: похожая строка НЕ матчится (никакого fuzzy).
	if ids := MatchNomenclature("кладка кирпичная стен", byName); len(ids) != 0 {
		t.Fatal("fuzzy/substring fallback is forbidden")
	}
}

// §17.32-34: даты.
func TestDateNormalization(t *testing.T) {
	if iso, _, ok := NormalizeDate("2026-07-01"); !ok || iso != "2026-07-01" { // 32 (ISO как Excel-выдача)
		t.Fatalf("iso date: %q %v", iso, ok)
	}
	if iso, code, ok := NormalizeDate("01.07.2026"); !ok || iso != "2026-07-01" || code != "DATE_NORMALIZED" { // 33
		t.Fatalf("ru date: %q %s %v", iso, code, ok)
	}
	if _, code, ok := NormalizeDate("31.02.2026"); ok || code != "DATE_INVALID" { // 34
		t.Fatal("invalid date must fail")
	}
}
