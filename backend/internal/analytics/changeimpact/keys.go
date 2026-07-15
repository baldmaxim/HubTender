package changeimpact

import (
	"math/big"
	"strings"
)

// NormalizeComparisonText — trim + lowercase + схлопывание пробелов;
// Unicode-safe; цифры, размеры, марки и артикулы НЕ удаляются (§4).
func NormalizeComparisonText(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

// BuildPositionComparisonKey — детерминированный exact-ключ позиции из
// устойчивых полей аудита §1: item_no + work_name + unit_code. position_number
// НЕ в ключе (сдвигается при вставке строк клиентского файла); UUID не в ключе
// (пере-генерируется при transfer). Дубли ключа → позиционная ambiguous-группа.
func BuildPositionComparisonKey(p *Position) string {
	return strings.Join([]string{
		NormalizeComparisonText(p.ItemNo),
		NormalizeComparisonText(p.WorkName),
		NormalizeComparisonText(p.UnitCode),
	}, "\x1f")
}

// shallowItemIdentity — идентичность строки БЕЗ parent-контекста (для
// построения parent-контекста без рекурсии).
func shallowItemIdentity(it *Item) string {
	return strings.Join([]string{
		it.BoqItemType,
		derefS(it.NameID),
		NormalizeComparisonText(derefS(it.UnitCode)),
	}, "\x1e")
}

// BuildBoqComparisonKey — exact-ключ BOQ-строки внутри matched-позиции (§4):
// canonical type + номенклатурный ID + unit + detail category + parent-контекст
// (идентичность родительской работы, не UUID) + normalized description как
// ДОПОЛНИТЕЛЬНЫЙ exact-компонент. Финансовые поля (quantity/rate/totals) в
// identity НЕ входят. parentIdentity: shallowItemIdentity родителя или "".
func BuildBoqComparisonKey(it *Item, parentIdentity string) string {
	return strings.Join([]string{
		it.BoqItemType,
		derefS(it.NameID),
		NormalizeComparisonText(derefS(it.UnitCode)),
		derefS(it.DetailCategoryID),
		parentIdentity,
		NormalizeComparisonText(derefS(it.Description)),
	}, "\x1f")
}

// buildParentIdentities — map itemID → parentIdentity для одной версии
// (один проход, без N²).
func buildParentIdentities(items []Item) map[string]string {
	shallow := make(map[string]string, len(items))
	for i := range items {
		shallow[items[i].ID] = shallowItemIdentity(&items[i])
	}
	out := make(map[string]string, len(items))
	for i := range items {
		it := &items[i]
		if it.ParentWorkItemID != nil {
			out[it.ID] = shallow[*it.ParentWorkItemID]
		} else {
			out[it.ID] = ""
		}
	}
	return out
}

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ─── Exact money (big.Rat поверх numeric::text — decimal-контракт этапа 0) ───

var ratTolerance = big.NewRat(1, 100) // 0.01

// parseMoneyRat — numeric::text → big.Rat; ”/'0' → 0. Никакого float-парсинга.
func parseMoneyRat(s string) *big.Rat {
	s = strings.TrimSpace(s)
	if s == "" {
		return new(big.Rat)
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return new(big.Rat)
	}
	return r
}

func ratSub(a, b *big.Rat) *big.Rat { return new(big.Rat).Sub(a, b) }
func ratAdd(a, b *big.Rat) *big.Rat { return new(big.Rat).Add(a, b) }

func ratWithinTolerance(r *big.Rat) bool {
	abs := new(big.Rat).Abs(r)
	return abs.Cmp(ratTolerance) <= 0
}

// ratToFloat2 — представление для JSON/UI (сверка остаётся на exact rat).
func ratToFloat2(r *big.Rat) float64 {
	f, _ := new(big.Rat).Set(r).Float64()
	// денежное представление 2dp
	if f >= 0 {
		return float64(int64(f*100+0.5)) / 100
	}
	return -float64(int64(-f*100+0.5)) / 100
}
