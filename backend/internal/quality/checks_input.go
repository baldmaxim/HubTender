package quality

import (
	"fmt"
	"sort"
	"strings"
)

// ─── Warning-checks по входам BOQ (подтверждены аудитом модели) ──────────────
//
// Обязательность взята НЕ из названий полей, а из фактической модели:
//   - quantity/unit_rate: ядро calc трактует nil/0 как нулевую сумму — строка
//     легальна (черновик), но требует проверки → warning;
//   - unit_code: DB nullable, но смета без единицы измерения непроверяема →
//     review-warning;
//   - имя номенклатуры (material/work_name_id): NOT NULL по DB-констрейнту —
//     отсутствовать не может; человекочитаемое description — опционально →
//     information при пустом (полезно для проверки);
//   - detail_cost_category_id: nullable, но обязательна для перераспределения
//     и структуры затрат текущего workflow → review-warning;
//   - quote_link: модель НЕ считает его обязательным (nullable, UI не требует)
//     → в MVP не проверяется (backlog: quote freshness).

func (e *evaluator) checkBoqInputs() {
	for i := range e.s.Items {
		it := &e.s.Items[i]
		base := Issue{
			Category:         CategoryBoqInput,
			EntityType:       "boq_item",
			EntityID:         it.ID,
			ClientPositionID: it.ClientPositionID,
		}

		if it.Quantity == nil || *it.Quantity == 0 {
			is := base
			is.Code = "QUANTITY_ZERO"
			is.Severity = SeverityWarn
			is.Field = "quantity"
			is.Title = "Не заполнено количество"
			is.Message = "Количество не задано или равно нулю — сумма строки равна нулю."
			is.FixHint = "Укажите количество."
			if it.Quantity != nil {
				is.CurrentValue = sptrOf(fmt.Sprintf("%v", *it.Quantity))
			}
			e.add(is)
		}
		if it.UnitRate == nil || *it.UnitRate == 0 {
			is := base
			is.Code = "UNIT_RATE_ZERO"
			is.Severity = SeverityWarn
			is.Field = "unit_rate"
			is.Title = "Не заполнена цена за единицу"
			is.Message = "Цена за единицу не задана или равна нулю — сумма строки равна нулю."
			is.FixHint = "Укажите цену за единицу."
			if it.UnitRate != nil {
				is.CurrentValue = sptrOf(fmt.Sprintf("%v", *it.UnitRate))
			}
			e.add(is)
		}
		if it.UnitCode == nil || strings.TrimSpace(*it.UnitCode) == "" {
			is := base
			is.Code = "UNIT_CODE_MISSING"
			is.Severity = SeverityWarn
			is.Field = "unit_code"
			is.Title = "Не указана единица измерения"
			is.Message = "Без единицы измерения строку невозможно проверить по смете."
			is.FixHint = "Выберите единицу измерения."
			e.add(is)
		}
		if it.DetailCostCategoryID == nil || *it.DetailCostCategoryID == "" {
			is := base
			is.Code = "DETAIL_COST_CATEGORY_MISSING"
			is.Severity = SeverityWarn
			is.Field = "detail_cost_category_id"
			is.Title = "Не указана затрата на строительство"
			is.Message = "Строка не привязана к детальной категории затрат — перераспределение и структура затрат её не учтут."
			is.FixHint = "Выберите затрату на строительство."
			e.add(is)
		}
		if it.Description == nil || strings.TrimSpace(*it.Description) == "" {
			is := base
			is.Code = "DESCRIPTION_EMPTY"
			is.Severity = SeverityInformation
			is.Field = "description"
			is.Title = "Нет описания строки"
			is.Message = "Человекочитаемое описание не заполнено — проверяющему видно только номенклатурное имя."
			is.FixHint = "При необходимости добавьте описание."
			e.add(is)
		}
	}
}

// ─── Completeness: две раздельные детерминированные метрики ──────────────────
//
// Формула (без «магических весов»):
//
//	filled applicable required fields / all applicable required fields × 100
//
// Calculation completeness — поля, без которых сумма строки не считается
// корректно: quantity (>0), unit_rate (>0) и, ТОЛЬКО для валютных строк,
// положительный курс их валюты (поле применимо не ко всем строкам — RUB-строка
// не ухудшает знаменатель).
//
// Review completeness — calculation-поля + unit_code + detail_cost_category_id
// (данные, необходимые для качественной проверки и согласования).
//
// Пустой тендер (0 применимых полей) → 100% (нет незаполненного), не NaN.
func (e *evaluator) completeness() (calcPct, reviewPct float64) {
	rateOK := func(code string) bool {
		switch code {
		case "USD":
			return e.s.Tender.USDRate != nil && *e.s.Tender.USDRate > 0
		case "EUR":
			return e.s.Tender.EURRate != nil && *e.s.Tender.EURRate > 0
		case "CNY":
			return e.s.Tender.CNYRate != nil && *e.s.Tender.CNYRate > 0
		default:
			return true // RUB/пусто — курс неприменим
		}
	}
	var calcFilled, calcTotal, revFilled, revTotal int
	for i := range e.s.Items {
		it := &e.s.Items[i]
		// calculation-required
		calcTotal += 2
		if it.Quantity != nil && *it.Quantity > 0 {
			calcFilled++
		}
		if it.UnitRate != nil && *it.UnitRate > 0 {
			calcFilled++
		}
		if it.CurrencyType != "" && it.CurrencyType != "RUB" {
			calcTotal++
			if rateOK(it.CurrencyType) {
				calcFilled++
			}
		}
		// review-required = calculation + unit_code + detail category
		revTotal += 2
		if it.UnitCode != nil && strings.TrimSpace(*it.UnitCode) != "" {
			revFilled++
		}
		if it.DetailCostCategoryID != nil && *it.DetailCostCategoryID != "" {
			revFilled++
		}
	}
	revFilled += calcFilled
	revTotal += calcTotal

	pct := func(filled, total int) float64 {
		if total == 0 {
			return 100
		}
		return round1(float64(filled) / float64(total) * 100)
	}
	return pct(calcFilled, calcTotal), pct(revFilled, revTotal)
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

// ─── Точные дубли внутри позиции ─────────────────────────────────────────────
//
// Нормализованный ключ (только подтверждённые поля): canonical boq_item_type +
// name_id + normalized(description) + unit_code + currency + unit_rate +
// parent_work_item_id + detail_cost_category_id. Одинаковая цена сама по себе
// дублем НЕ является (в ключе участвуют тип/имя/описание/связи).
func (e *evaluator) checkDuplicates() {
	type group struct {
		ids   []string
		total float64
		pos   string
	}
	groups := map[string]*group{}
	for i := range e.s.Items {
		it := &e.s.Items[i]
		key := strings.Join([]string{
			it.ClientPositionID,
			it.BoqItemType,
			derefS(it.NameID),
			normalizeText(derefS(it.Description)),
			normalizeText(derefS(it.UnitCode)),
			it.CurrencyType,
			fmt.Sprintf("%v", derefF(it.UnitRate)),
			derefS(it.ParentWorkItemID),
			derefS(it.DetailCostCategoryID),
		}, "\x1f")
		g := groups[key]
		if g == nil {
			g = &group{pos: it.ClientPositionID}
			groups[key] = g
		}
		g.ids = append(g.ids, it.ID)
		if it.StoredTotalAmount != nil {
			g.total += *it.StoredTotalAmount
		}
	}
	keys := make([]string, 0, len(groups))
	for k, g := range groups {
		if len(g.ids) > 1 {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys) // детерминированный порядок групп
	for _, k := range keys {
		g := groups[k]
		sort.Strings(g.ids)
		total := g.total
		e.add(Issue{
			Code:             "EXACT_DUPLICATE_GROUP",
			Severity:         SeverityWarn,
			Category:         CategoryDuplicates,
			EntityType:       "boq_item",
			EntityID:         g.ids[0], // первая строка — navigation target
			ClientPositionID: g.pos,
			Field:            "duplicate_group",
			Title:            fmt.Sprintf("Точные дубли: %d одинаковые строки", len(g.ids)),
			Message: fmt.Sprintf("В позиции %d строк(и) полностью совпадают (тип, номенклатура, описание, единица, цена, связи) на общую сумму %.2f.",
				len(g.ids), total),
			FixHint:          "Проверьте и объедините или удалите лишние строки вручную.",
			AffectedItemIDs:  capIDs(g.ids),
			AffectedCount:    len(g.ids),
			GroupTotalAmount: &total,
		})
	}
}

// normalizeText — trim + lowercase + схлопывание пробелов; Unicode-safe;
// цифры, размеры, марки и артикулы НЕ удаляются.
func normalizeText(s string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(s))), " ")
}

func derefF(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// ─── Детерминированная сортировка issues ─────────────────────────────────────

var severityRank = map[string]int{
	SeverityBlocker:     0,
	SeverityWarn:        1,
	SeverityInformation: 2,
}

func (e *evaluator) sortIssues() {
	posOf := func(is *Issue) int {
		if is.ClientPositionID == "" {
			return -1 // tender-level issues раньше позиций
		}
		if idx, ok := e.posOrder[is.ClientPositionID]; ok {
			return idx
		}
		return 1 << 30
	}
	sort.SliceStable(e.issues, func(a, b int) bool {
		x, y := &e.issues[a], &e.issues[b]
		if severityRank[x.Severity] != severityRank[y.Severity] {
			return severityRank[x.Severity] < severityRank[y.Severity]
		}
		if x.Category != y.Category {
			return x.Category < y.Category
		}
		if posOf(x) != posOf(y) {
			return posOf(x) < posOf(y)
		}
		if x.EntityID != y.EntityID {
			return x.EntityID < y.EntityID
		}
		return x.Code < y.Code
	})
}
