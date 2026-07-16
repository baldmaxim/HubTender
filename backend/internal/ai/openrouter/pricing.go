package openrouter

import (
	"math/big"
	"strings"
)

// Цены OpenRouter приходят СТРОКОВЫМИ decimal-значениями (USD за токен).
// Authoritative pricing metadata не проводится через binary float (§5):
// вся арифметика — точная, на math/big.Rat, результат — display-строка.
// Эти цены НЕ участвуют в финансовых расчётах тендера.

// parseDecimal — безопасный парс строкового decimal в big.Rat.
// Отклоняет NaN/Inf/экспоненты/пустые строки — только простой десятичный
// формат с необязательным знаком.
func parseDecimal(s string) (*big.Rat, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, false
	}
	// big.Rat.SetString принимает "a/b" и экспоненты — ограничиваем алфавит
	// до простого десятичного числа, чтобы не принять неожиданный формат.
	seenDigit := false
	seenDot := false
	for i, r := range s {
		switch {
		case r >= '0' && r <= '9':
			seenDigit = true
		case r == '.' && !seenDot:
			seenDot = true
		case (r == '-' || r == '+') && i == 0:
		default:
			return nil, false
		}
	}
	if !seenDigit {
		return nil, false
	}
	rat, ok := new(big.Rat).SetString(s)
	if !ok {
		return nil, false
	}
	return rat, true
}

var million = new(big.Rat).SetInt64(1_000_000)

// PricePer1M — display-строка «USD за 1M токенов» из цены за токен.
// Пустой вход/не-decimal → пустая строка (UI показывает «—»).
func PricePer1M(perToken string) string {
	rat, ok := parseDecimal(perToken)
	if !ok {
		return ""
	}
	return formatRat(new(big.Rat).Mul(rat, million), 4)
}

// EstimateCostUSD — точная оценка стоимости запроса:
// promptPrice×inputTokens + completionPrice×outputTokens (+requestPrice).
// Возвращает decimal-строку USD (8 знаков) и ok=false при невалидных ценах.
func EstimateCostUSD(promptPrice, completionPrice, requestPrice string, inputTokens, outputTokens int) (string, bool) {
	pp, ok := parseDecimal(promptPrice)
	if !ok {
		return "", false
	}
	cp, ok := parseDecimal(completionPrice)
	if !ok {
		return "", false
	}
	total := new(big.Rat).Mul(pp, new(big.Rat).SetInt64(int64(inputTokens)))
	total.Add(total, new(big.Rat).Mul(cp, new(big.Rat).SetInt64(int64(outputTokens))))
	if strings.TrimSpace(requestPrice) != "" {
		if rp, rok := parseDecimal(requestPrice); rok {
			total.Add(total, rp)
		}
	}
	return formatRat(total, 8), true
}

// formatRat — десятичная строка с maxScale знаков после точки, хвостовые
// нули обрезаются (но минимум один знак «0» остаётся у целых).
func formatRat(r *big.Rat, maxScale int) string {
	s := r.FloatString(maxScale) // экзактно для десятичной печати с округлением
	if !strings.Contains(s, ".") {
		return s
	}
	s = strings.TrimRight(s, "0")
	s = strings.TrimSuffix(s, ".")
	if s == "" || s == "-" {
		return "0"
	}
	return s
}

// isNegativePrice — metadata-признак router-псевдомодели (§6): официальный
// каталог помечает динамические router-цены отрицательными значениями.
func isNegativePrice(s string) bool {
	rat, ok := parseDecimal(s)
	if !ok {
		return false
	}
	return rat.Sign() < 0
}

// isZeroPrice — free-вариант (prompt и completion = 0).
func isZeroPrice(s string) bool {
	rat, ok := parseDecimal(s)
	if !ok {
		return false
	}
	return rat.Sign() == 0
}
