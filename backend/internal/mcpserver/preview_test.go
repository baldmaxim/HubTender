package mcpserver

import (
	"strings"
	"testing"

	"github.com/su10/hubtender/backend/internal/pricing"
)

func f(v float64) *float64 { return &v }
func s(v string) *string   { return &v }

func TestPriceMessageShowsBeforeAfterAuthorAndLinkedMaterials(t *testing.T) {
	msg := priceMessage(&pricing.DirectPricingResult{
		Action: "update_item", Name: "Монтаж мембраны", ItemType: "суб-раб", UnitCode: "м2",
		Quantity: 120, UnitRate: 450, Currency: "RUB", TotalAmount: 54000, PositionTotal: 117000,
		PreviousPositionQuantity: f(100), PositionQuantity: f(120),
		LinkedMaterials: []pricing.LinkedMaterialResult{{ItemID: "m1", Quantity: 126, TotalAmount: 63000}},
		Context: &pricing.ChangeContext{
			Tender: "№340 «Перовская, 71», версия 1", Position: "№12 «Кровля»", Category: "Кровля / Мембрана",
			RowAuthor: "Иванов И.И.", PositionTotalBefore: 92500,
			Before: &pricing.RowValues{Quantity: f(100), UnitRate: f(400), Currency: "RUB", TotalAmount: f(40000)},
			Rows:   []pricing.RowChange{{ItemID: "m1", Name: "Мембрана", ItemType: "суб-мат", Quantity: f(105), TotalAmount: f(52500)}},
		},
	})
	for _, want := range []string{
		"Изменить строку ВОР", "Тендер: №340 «Перовская, 71», версия 1", "Позиция: №12 «Кровля»",
		"Раздел: Кровля / Мембрана", "Иванов И.И. (вы)", "было:   количество 100; цена 400 RUB; сумма 40000.00",
		"станет: количество 120; цена 450 RUB; сумма 54000.00", "«Мембрана» (суб-мат): количество 105 → 126",
		"Количество ГП: 100 → 120", "Итог позиции: 92500.00 → 117000.00 RUB",
	} {
		if !strings.Contains(msg, want) {
			t.Errorf("window text lacks %q:\n%s", want, msg)
		}
	}
}

func TestDeleteAndGPMessagesListEveryChange(t *testing.T) {
	del := deleteMessage(&pricing.DirectDeleteResult{
		PositionTotal: 0,
		Deleted: []pricing.RowChange{
			{Name: "Монтаж мембраны", ItemType: "суб-раб", UnitCode: "м2", Quantity: f(120), TotalAmount: f(54000)},
			{Name: "Мембрана", ItemType: "суб-мат", UnitCode: "м2", Quantity: f(126), TotalAmount: f(63000)},
		},
		Context: &pricing.ChangeContext{Tender: "№340", Position: "№12", RowAuthor: "Иванов И.И.", PositionTotalBefore: 117000},
	})
	for _, want := range []string{"Удалить из ВОР", "Будут удалены строки (2)", "2. «Мембрана» (суб-мат, привязанный материал)", "Итог позиции: 117000.00 → 0.00 RUB"} {
		if !strings.Contains(del, want) {
			t.Errorf("delete window lacks %q:\n%s", want, del)
		}
	}
	gp := gpMessage(&pricing.PositionGPResult{
		PreviousQuantity: f(10), Quantity: f(11), PreviousNote: nil, Note: s("по чертежу"),
		Context: &pricing.ChangeContext{Tender: "№340", Position: "№12"},
	})
	for _, want := range []string{"Количество ГП: 10 → 11", "Примечание ГП: — → «по чертежу»"} {
		if !strings.Contains(gp, want) {
			t.Errorf("GP window lacks %q:\n%s", want, gp)
		}
	}
}
