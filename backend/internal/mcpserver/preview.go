package mcpserver

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/su10/hubtender/backend/internal/pricing"
)

// Texts of the confirmation window: where the write happens, whose data it
// touches and every value before → after. The human confirms exactly this text.

func priceMessage(p *pricing.DirectPricingResult) string {
	var b strings.Builder
	if p.Action == "update_item" {
		b.WriteString("Изменить строку ВОР в TenderHUB?\n")
	} else {
		b.WriteString("Добавить строку в ВОР TenderHUB?\n")
	}
	writeContextHeader(&b, p.Context)
	fmt.Fprintf(&b, "Строка: «%s» (%s), ед. %s\n", p.Name, p.ItemType, p.UnitCode)
	if c := p.Context; c != nil && c.Before != nil {
		if c.RowAuthor != "" {
			fmt.Fprintf(&b, "Последнее изменение строки: %s (вы)\n", c.RowAuthor)
		}
		fmt.Fprintf(&b, "  было:   количество %s; цена %s %s; сумма %s RUB\n",
			numPtr(c.Before.Quantity), numPtr(c.Before.UnitRate), c.Before.Currency, moneyPtr(c.Before.TotalAmount))
		fmt.Fprintf(&b, "  станет: количество %s; цена %s %s; сумма %s RUB\n",
			num(p.Quantity), num(p.UnitRate), p.Currency, money(p.TotalAmount))
	} else {
		fmt.Fprintf(&b, "  количество %s; цена %s %s; сумма %s RUB\n",
			num(p.Quantity), num(p.UnitRate), p.Currency, money(p.TotalAmount))
	}
	if p.ConversionCoefficient != nil || p.ConsumptionCoefficient != nil {
		fmt.Fprintf(&b, "  коэффициенты: перевод %s, расход %s\n", numPtr(p.ConversionCoefficient), numPtr(p.ConsumptionCoefficient))
	}
	if p.Context != nil && len(p.Context.Rows) > 0 {
		after := map[string]pricing.LinkedMaterialResult{}
		for _, m := range p.LinkedMaterials {
			after[m.ItemID] = m
		}
		b.WriteString("Пересчитаются привязанные материалы:\n")
		for _, row := range p.Context.Rows {
			next := after[row.ItemID]
			fmt.Fprintf(&b, "  «%s» (%s): количество %s → %s, сумма %s → %s RUB\n",
				row.Name, row.ItemType, numPtr(row.Quantity), num(next.Quantity), moneyPtr(row.TotalAmount), money(next.TotalAmount))
		}
	}
	if !samePtr(p.PreviousPositionQuantity, p.PositionQuantity) {
		fmt.Fprintf(&b, "Количество ГП: %s → %s\n", numPtr(p.PreviousPositionQuantity), numPtr(p.PositionQuantity))
	}
	writePositionTotal(&b, p.Context, p.PositionTotal)
	if p.Checks != nil {
		for _, f := range p.Checks.Findings {
			fmt.Fprintf(&b, "Проверка %s [%s]: %s\n", f.RuleCode, f.Severity, f.Detail)
		}
	}
	for _, warning := range p.Warnings {
		b.WriteString("Источник: " + warning + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func deleteMessage(p *pricing.DirectDeleteResult) string {
	var b strings.Builder
	b.WriteString("Удалить из ВОР TenderHUB?\n")
	writeContextHeader(&b, p.Context)
	fmt.Fprintf(&b, "Будут удалены строки (%d):\n", len(p.Deleted))
	for i, row := range p.Deleted {
		kind := ""
		if i > 0 {
			kind = ", привязанный материал"
		}
		fmt.Fprintf(&b, "  %d. «%s» (%s%s): %s %s, сумма %s RUB\n",
			i+1, row.Name, row.ItemType, kind, numPtr(row.Quantity), row.UnitCode, moneyPtr(row.TotalAmount))
	}
	if p.Context != nil && p.Context.RowAuthor != "" {
		fmt.Fprintf(&b, "Последнее изменение строк: %s (вы)\n", p.Context.RowAuthor)
	}
	writePositionTotal(&b, p.Context, p.PositionTotal)
	return strings.TrimRight(b.String(), "\n")
}

func gpMessage(p *pricing.PositionGPResult) string {
	var b strings.Builder
	b.WriteString("Изменить ГП позиции в TenderHUB?\n")
	writeContextHeader(&b, p.Context)
	if !samePtr(p.PreviousQuantity, p.Quantity) {
		fmt.Fprintf(&b, "Количество ГП: %s → %s\n", numPtr(p.PreviousQuantity), numPtr(p.Quantity))
	}
	if !samePtr(p.PreviousNote, p.Note) {
		fmt.Fprintf(&b, "Примечание ГП: %s → %s\n", quoted(p.PreviousNote), quoted(p.Note))
	}
	return strings.TrimRight(b.String(), "\n")
}

func writeContextHeader(b *strings.Builder, c *pricing.ChangeContext) {
	if c == nil {
		return
	}
	fmt.Fprintf(b, "Тендер: %s\nПозиция: %s\n", c.Tender, c.Position)
	if c.Category != "" {
		fmt.Fprintf(b, "Раздел: %s\n", c.Category)
	}
}

func writePositionTotal(b *strings.Builder, c *pricing.ChangeContext, after float64) {
	if c == nil {
		fmt.Fprintf(b, "Итог позиции: %s RUB\n", money(after))
		return
	}
	fmt.Fprintf(b, "Итог позиции: %s → %s RUB\n", money(c.PositionTotalBefore), money(after))
}

func num(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }

func numPtr(v *float64) string {
	if v == nil {
		return "—"
	}
	return num(*v)
}

func money(v float64) string { return strconv.FormatFloat(v, 'f', 2, 64) }

func moneyPtr(v *float64) string {
	if v == nil {
		return "—"
	}
	return money(*v)
}

func quoted(s *string) string {
	if s == nil || *s == "" {
		return "—"
	}
	return "«" + *s + "»"
}

func samePtr[T comparable](a, b *T) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}
