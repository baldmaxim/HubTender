package importanalysis

import (
	"fmt"
	"strings"
	"time"

	importmemory "github.com/su10/hubtender/backend/internal/importmemory"
)

// extractRow — нормализация одной data-строки (§8-§11). Каждая трансформация
// видима пользователю; blockers не позволяют строке попасть в execute.
func (a *analyzer) extractRow(
	row []Cell, pr *PreviewRow, it *NormalizedItem, excelRow int,
	tempSeen map[string]int, workTemp map[string]bool,
	block, warn func(),
) {
	issue := func(is Issue) {
		is.ExcelRow = excelRow
		id := a.addIssue(is)
		pr.IssueIDs = append(pr.IssueIDs, id)
		switch is.Severity {
		case SeverityBlocker:
			block()
		case SeverityWarning:
			warn()
		}
	}
	transform := func(field, raw, normalized, code, msg string) {
		pr.Transformations = append(pr.Transformations,
			Transformation{Field: field, Raw: raw, Normalized: normalized, Code: code, Message: msg})
	}

	// Формульная policy (§9) для authoritative numeric полей.
	checkFormula := func(field string, c Cell, srcCol string) bool {
		if !c.IsFormula {
			return true
		}
		if strings.TrimSpace(c.Raw) == "" {
			issue(Issue{Code: "FORMULA_NO_CACHED_VALUE", Severity: SeverityBlocker,
				SourceColumn: srcCol, TargetField: field, RawValue: c.Formula,
				Message: "Ячейка содержит формулу без сохранённого результата — значение недоступно",
				FixHint: "Пересохраните файл в Excel либо замените формулу значением"})
			return false
		}
		if !a.opts.AcceptFormulaCached {
			a.summary.FormulaConfirmations++
			issue(Issue{Code: "FORMULA_CACHED_VALUE", Severity: SeverityBlocker,
				SourceColumn: srcCol, TargetField: field, RawValue: "=" + c.Formula, Normalized: c.Raw,
				Message: "Значение получено из формулы (сохранённый результат). Требуется подтверждение",
				FixHint: "Подтвердите использование сохранённых значений формул на шаге проверки"})
			return false
		}
		issue(Issue{Code: "FORMULA_CACHED_VALUE", Severity: SeverityWarning,
			SourceColumn: srcCol, TargetField: field, RawValue: "=" + c.Formula, Normalized: c.Raw,
			Message: "Использован сохранённый результат формулы (подтверждено)"})
		return true
	}

	num := func(field, label string, required bool) *float64 {
		c, src, ok := a.cellFor(row, field)
		raw := strings.TrimSpace(c.Raw)
		pr.Raw[field] = raw
		if ok && c.IsFormula && !checkFormula(field, c, src) {
			return nil
		}
		if !ok || raw == "" {
			if required {
				issue(Issue{Code: "VALUE_MISSING", Severity: SeverityBlocker, TargetField: field,
					SourceColumn: src, Message: label + ": значение отсутствует",
					FixHint: "Заполните ячейку либо исключите строку"})
			}
			return nil
		}
		v, code, okNum := ParseNumber(raw, a.decimalComma)
		if !okNum {
			sev := SeverityWarning
			if required {
				sev = SeverityBlocker
			}
			msg := label + ": не удалось распознать число"
			if code == "NUMBER_AMBIGUOUS" {
				msg = label + ": неоднозначный числовой формат «" + raw + "»"
			}
			issue(Issue{Code: "NUMBER_UNPARSED", Severity: sev, TargetField: field,
				SourceColumn: src, RawValue: raw, Message: msg,
				FixHint: "Приведите значение к формату 1 234,56"})
			return nil
		}
		if code != "" && code != "NUMBER_PARSED" {
			transform(field, raw, trimFloat(v), code, "Число нормализовано")
		}
		return &v
	}

	// ── позиция заказчика (§5): существующая позиция тендера ────────────────
	posCell, posSrc, _ := a.cellFor(row, FieldPositionRef)
	posRef := normText(posCell.Raw)
	pr.Raw[FieldPositionRef] = strings.TrimSpace(posCell.Raw)
	pr.PositionRef = strings.TrimSpace(posCell.Raw)
	if posRef == "" {
		issue(Issue{Code: "POSITION_MISSING", Severity: SeverityBlocker,
			TargetField: FieldPositionRef, SourceColumn: posSrc,
			Message: "Не указана позиция заказчика", FixHint: "Заполните номер позиции"})
	} else if id, ok := a.refs.Positions[posRef]; ok {
		it.PositionID = id
		pr.PositionRef = a.refs.PositionLabels[id]
	} else {
		issue(Issue{Code: "POSITION_NOT_FOUND", Severity: SeverityBlocker,
			TargetField: FieldPositionRef, SourceColumn: posSrc, RawValue: posCell.Raw,
			Message: "Позиция «" + strings.TrimSpace(posCell.Raw) + "» не найдена в тендере",
			FixHint: "Создайте позицию заранее либо исправьте номер"})
	}

	// ── тип строки (§8): explicit-only + fixed/default ──────────────────────
	typeCell, typeSrc, hasType := a.cellFor(row, FieldBoqType)
	typeRaw := strings.TrimSpace(typeCell.Raw)
	pr.Raw[FieldBoqType] = typeRaw
	switch {
	case hasType && typeRaw != "":
		if t, ok := NormalizeBoqType(typeRaw); ok {
			it.BoqItemType = t
			if normText(typeRaw) != t {
				transform(FieldBoqType, typeRaw, t, "TYPE_ALIAS", "Тип приведён к каноническому")
			}
		} else {
			issue(Issue{Code: "BOQ_TYPE_UNKNOWN", Severity: SeverityBlocker,
				TargetField: FieldBoqType, SourceColumn: typeSrc, RawValue: typeRaw,
				Message: "Неизвестный тип строки «" + typeRaw + "»",
				FixHint: "Допустимо: раб/суб-раб/раб-комп./мат/суб-мат/мат-комп."})
		}
	case a.opts.DefaultBoqType != "":
		if t, ok := NormalizeBoqType(a.opts.DefaultBoqType); ok {
			it.BoqItemType = t
			transform(FieldBoqType, "", t, "TYPE_DEFAULT", "Тип задан пользователем для всего диапазона")
		} else {
			issue(Issue{Code: "BOQ_TYPE_UNKNOWN", Severity: SeverityBlocker, TargetField: FieldBoqType,
				Message: "Заданный по умолчанию тип не распознан"})
		}
	default:
		issue(Issue{Code: "BOQ_TYPE_MISSING", Severity: SeverityBlocker, TargetField: FieldBoqType,
			Message: "Тип строки не задан (колонка отсутствует и default не выбран)",
			FixHint: "Выберите колонку типа либо фиксированный тип для диапазона"})
	}
	pr.BoqType = it.BoqItemType

	// ── описание ─────────────────────────────────────────────────────────────
	descCell, _, _ := a.cellFor(row, FieldDescription)
	desc := strings.TrimSpace(descCell.Raw)
	pr.Raw[FieldDescription] = desc
	pr.Description = desc
	if desc != "" {
		it.Description = &desc
	}

	// ── единица (§8) ─────────────────────────────────────────────────────────
	unitCell, unitSrc, _ := a.cellFor(row, FieldUnit)
	unitRaw := strings.TrimSpace(unitCell.Raw)
	pr.Raw[FieldUnit] = unitRaw
	if unitRaw != "" {
		if u, code, ok := NormalizeUnit(unitRaw, a.refs.Units); ok {
			it.UnitCode = &u
			pr.Unit = u
			if code == "UNIT_NORMALIZED" {
				transform(FieldUnit, unitRaw, u, code, "Единица нормализована")
				issue(Issue{Code: "UNIT_NORMALIZED", Severity: SeverityInformation,
					TargetField: FieldUnit, SourceColumn: unitSrc, RawValue: unitRaw, Normalized: u,
					Message: "Единица «" + unitRaw + "» приведена к «" + u + "»"})
			}
		} else {
			issue(Issue{Code: "UNIT_UNKNOWN", Severity: SeverityBlocker,
				TargetField: FieldUnit, SourceColumn: unitSrc, RawValue: unitRaw,
				Message: "Единица «" + unitRaw + "» не найдена в справочнике",
				FixHint: "Используйте единицы из справочника проекта"})
		}
	} else {
		issue(Issue{Code: "VALUE_MISSING", Severity: SeverityBlocker, TargetField: FieldUnit,
			SourceColumn: unitSrc, Message: "Единица измерения: значение отсутствует"})
	}

	// ── числа ────────────────────────────────────────────────────────────────
	it.Quantity = num(FieldQuantity, "Количество", true)
	pr.Quantity = it.Quantity
	it.UnitRate = num(FieldUnitRate, "Цена за единицу", true)
	pr.UnitRate = it.UnitRate
	it.BaseQuantity = num(FieldBaseQuantity, "Базовое количество", false)
	it.ConversionCoeff = num(FieldConversionCoeff, "Коэффициент перевода", false)
	it.ConsumptionCoeff = num(FieldConsumption, "Коэффициент расхода", false)
	it.DeliveryAmount = num(FieldDeliveryAmount, "Сумма доставки", false)
	it.ClientTotalDiagnostic = num(FieldClientTotal, "Сумма (диагностика)", false)

	// ── валюта (§8) ──────────────────────────────────────────────────────────
	curCell, curSrc, hasCur := a.cellFor(row, FieldCurrency)
	curRaw := strings.TrimSpace(curCell.Raw)
	pr.Raw[FieldCurrency] = curRaw
	switch {
	case hasCur && curRaw != "":
		if cur, ok := NormalizeCurrency(curRaw); ok {
			it.CurrencyType = &cur
			pr.Currency = cur
			if !strings.EqualFold(curRaw, cur) {
				transform(FieldCurrency, curRaw, cur, "CURRENCY_ALIAS", "Валюта нормализована")
			}
		} else {
			issue(Issue{Code: "CURRENCY_UNKNOWN", Severity: SeverityBlocker,
				TargetField: FieldCurrency, SourceColumn: curSrc, RawValue: curRaw,
				Message: "Неизвестная валюта «" + curRaw + "»",
				FixHint: "Допустимо: RUB/₽/руб., USD/$, EUR/€, CNY"})
		}
	case a.opts.DefaultCurrency != "":
		if cur, ok := NormalizeCurrency(a.opts.DefaultCurrency); ok {
			it.CurrencyType = &cur
			pr.Currency = cur
			issue(Issue{Code: "CURRENCY_DEFAULT", Severity: SeverityWarning,
				TargetField: FieldCurrency, Normalized: cur,
				Message: "Валюта по умолчанию «" + cur + "» подтверждена пользователем"})
		}
	}

	// ── тип доставки ─────────────────────────────────────────────────────────
	dtCell, _, hasDT := a.cellFor(row, FieldDeliveryType)
	if hasDT && strings.TrimSpace(dtCell.Raw) != "" {
		dt := strings.TrimSpace(dtCell.Raw)
		it.DeliveryType = &dt
	}

	// ── номенклатура (§8): exact unique only ─────────────────────────────────
	nomCell, nomSrc, hasNom := a.cellFor(row, FieldNomenclature)
	nomRaw := strings.TrimSpace(nomCell.Raw)
	if !hasNom || nomRaw == "" {
		nomRaw = desc // колонка номенклатуры может совпадать с описанием
		nomSrc = ""
	}
	pr.Nomenclature = ""
	// Этап 2.3: контекст категории для alias-совпадения — вычисляем заранее
	// (сама категория назначается ниже, в существующем блоке).
	dcCell, dcSrc, hasDC := a.cellFor(row, FieldDetailCategory)
	dcRaw := strings.TrimSpace(dcCell.Raw)
	dcCtxID := ""
	if hasDC && dcRaw != "" {
		if ids := a.refs.DetailCats[normText(dcRaw)]; len(ids) == 1 {
			dcCtxID = ids[0]
		}
	}
	// Этап 2.2: подтверждённый выбор номенклатуры для этой строки.
	rowRef := a.sheet.Name + "|" + itoa(excelRow)
	if sel, hasSel := a.opts.NomenclatureSelections[rowRef]; hasSel && it.BoqItemType != "" {
		isWork := strings.HasPrefix(it.BoqItemType, "раб") || strings.HasPrefix(it.BoqItemType, "суб-раб")
		unitByID := a.refs.MatNameUnits
		if isWork {
			unitByID = a.refs.WorkNameUnits
		}
		catUnit, exists := unitByID[sel]
		if !exists {
			issue(Issue{Code: "NOMENCLATURE_SELECTION_INVALID", Severity: SeverityBlocker,
				TargetField: FieldNomenclature, RawValue: sel,
				Message: "Выбранная номенклатура не найдена в справочнике или не совпадает по типу",
				FixHint: "Обновите анализ и выберите вариант заново"})
		} else {
			if isWork {
				it.WorkNameID = &sel
			} else {
				it.MaterialNameID = &sel
			}
			source := a.opts.SelectionSources[rowRef]
			if it.UnitCode != nil && catUnit != "" && normText(*it.UnitCode) != normText(catUnit) {
				issue(Issue{Code: "NOMENCLATURE_SELECTION_UNIT_WARNING", Severity: SeverityWarning,
					TargetField: FieldNomenclature, RawValue: catUnit, Normalized: *it.UnitCode,
					Message: "Единица выбранной номенклатуры отличается от единицы строки — проверьте выбор"})
			}
			issue(Issue{Code: "NOMENCLATURE_SELECTED", Severity: SeverityInformation,
				TargetField: FieldNomenclature, Normalized: sel,
				Message: "Номенклатура подтверждена пользователем (" + source + ")"})
			pr.Nomenclature = nomRaw
		}
	} else if it.BoqItemType != "" && nomRaw != "" {
		byName := a.refs.MaterialNames
		if strings.HasPrefix(it.BoqItemType, "раб") || strings.HasPrefix(it.BoqItemType, "суб-раб") {
			byName = a.refs.WorkNames
		}
		ids := MatchNomenclature(nomRaw, byName)
		isWork := strings.HasPrefix(it.BoqItemType, "раб") || strings.HasPrefix(it.BoqItemType, "суб-раб")
		if len(ids) == 1 {
			// §6: exact canonical match всегда выше alias.
			if isWork {
				it.WorkNameID = &ids[0]
			} else {
				it.MaterialNameID = &ids[0]
			}
			pr.Nomenclature = nomRaw
			issue(Issue{Code: "NOMENCLATURE_EXACT_MATCH", Severity: SeverityInformation,
				TargetField: FieldNomenclature, RawValue: nomRaw,
				Message: "Точное совпадение с номенклатурой"})
		} else if a.tryAliasMatch(it, pr, issue, nomRaw, nomSrc, dcCtxID, isWork) {
			// Этап 2.3: разрешено ранее подтверждённым alias пользователя.
		} else if len(ids) > 1 {
			issue(Issue{Code: "NOMENCLATURE_AMBIGUOUS", Severity: SeverityBlocker,
				TargetField: FieldNomenclature, SourceColumn: nomSrc, RawValue: nomRaw,
				Message: "Несколько записей номенклатуры точно совпадают — выбор неоднозначен",
				FixHint: "Уточните наименование либо выберите номенклатуру вручную после импорта"})
		} else {
			issue(Issue{Code: "NOMENCLATURE_NOT_FOUND", Severity: SeverityBlocker,
				TargetField: FieldNomenclature, SourceColumn: nomSrc, RawValue: nomRaw,
				Message: "Точное совпадение с номенклатурой не найдено (приблизительный подбор отключён)",
				FixHint: "Добавьте запись в номенклатуру заранее либо исправьте наименование"})
		}
	}

	// ── затрата на строительство ─────────────────────────────────────────────
	if hasDC && dcRaw != "" {
		ids := a.refs.DetailCats[normText(dcRaw)]
		switch {
		case len(ids) == 1:
			it.DetailCategoryID = &ids[0]
		case len(ids) > 1:
			issue(Issue{Code: "DETAIL_CATEGORY_AMBIGUOUS", Severity: SeverityBlocker,
				TargetField: FieldDetailCategory, SourceColumn: dcSrc, RawValue: dcRaw,
				Message: "Категория затрат неоднозначна", FixHint: "Уточните название с локацией"})
		default:
			issue(Issue{Code: "DETAIL_CATEGORY_NOT_FOUND", Severity: SeverityWarning,
				TargetField: FieldDetailCategory, SourceColumn: dcSrc, RawValue: dcRaw,
				Message: "Категория затрат не найдена — поле останется пустым"})
		}
	}

	// ── temp id / parent (§10): только явные ссылки ─────────────────────────
	tempCell, tempSrc, hasTemp := a.cellFor(row, FieldTempID)
	if hasTemp && strings.TrimSpace(tempCell.Raw) != "" {
		tid := strings.TrimSpace(tempCell.Raw)
		if prev, dup := tempSeen[tid]; dup {
			issue(Issue{Code: "TEMP_ID_DUPLICATE", Severity: SeverityBlocker,
				TargetField: FieldTempID, SourceColumn: tempSrc, RawValue: tid,
				Message: "Повторяющийся идентификатор строки (уже в строке " + itoa(prev) + ")"})
		} else {
			tempSeen[tid] = excelRow
			it.TempID = &tid
			isWork := strings.HasPrefix(it.BoqItemType, "раб") || strings.HasPrefix(it.BoqItemType, "суб-раб")
			workTemp[tid] = isWork
		}
	}
	parentCell, parentSrc, hasParent := a.cellFor(row, FieldParentRef)
	if hasParent && strings.TrimSpace(parentCell.Raw) != "" {
		pref := strings.TrimSpace(parentCell.Raw)
		switch {
		case it.TempID != nil && *it.TempID == pref:
			issue(Issue{Code: "PARENT_SELF", Severity: SeverityBlocker,
				TargetField: FieldParentRef, SourceColumn: parentSrc, RawValue: pref,
				Message: "Строка ссылается сама на себя как на родителя"})
		default:
			if _, seen := tempSeen[pref]; !seen {
				issue(Issue{Code: "PARENT_NOT_FOUND", Severity: SeverityBlocker,
					TargetField: FieldParentRef, SourceColumn: parentSrc, RawValue: pref,
					Message: "Родительская работа «" + pref + "» не найдена выше в файле",
					FixHint: "Родитель должен идти в файле раньше дочерних строк"})
			} else if !workTemp[pref] {
				issue(Issue{Code: "PARENT_NOT_WORK", Severity: SeverityBlocker,
					TargetField: FieldParentRef, SourceColumn: parentSrc, RawValue: pref,
					Message: "Родитель не является работой"})
			} else {
				it.ParentTempID = &pref
			}
		}
	}

	// ── quote-метаданные (§8: даты) ──────────────────────────────────────────
	qlCell, _, hasQL := a.cellFor(row, FieldQuoteLink)
	if hasQL && strings.TrimSpace(qlCell.Raw) != "" {
		ql := strings.TrimSpace(qlCell.Raw)
		it.QuoteLink = &ql
	}
	dateField := func(field, label string, out **string, future bool) {
		c, src, has := a.cellFor(row, field)
		raw := strings.TrimSpace(c.Raw)
		if !has || raw == "" {
			return
		}
		iso, code, ok := NormalizeDate(raw)
		if !ok {
			issue(Issue{Code: "DATE_INVALID", Severity: SeverityBlocker,
				TargetField: field, SourceColumn: src, RawValue: raw,
				Message: label + ": не удалось распознать дату «" + raw + "»",
				FixHint: "Формат: ДД.ММ.ГГГГ либо ГГГГ-ММ-ДД"})
			return
		}
		if code != "" {
			transform(field, raw, iso, code, "Дата нормализована")
		}
		if future && iso > time.Now().UTC().Format("2006-01-02") {
			issue(Issue{Code: "QUOTE_DATE_FUTURE", Severity: SeverityBlocker,
				TargetField: field, SourceColumn: src, RawValue: raw, Normalized: iso,
				Message: label + " не может быть в будущем"})
			return
		}
		*out = &iso
	}
	dateField(FieldQuotePriceDate, "Дата цены", &it.QuotePriceDate, true)
	dateField(FieldQuoteValidUntil, "Срок действия цены", &it.QuoteValidUntil, false)

	// ── diagnostic total (§5): только предупреждение о наличии ──────────────
	if it.ClientTotalDiagnostic != nil {
		issue(Issue{Code: "CLIENT_TOTAL_DIAGNOSTIC", Severity: SeverityInformation,
			TargetField: FieldClientTotal,
			Message:     "Сумма из Excel используется только для диагностической сверки; итог считает сервер"})
	}
}

func trimFloat(v float64) string {
	s := strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.6f", v), "0"), ".")
	if s == "" || s == "-" {
		return "0"
	}
	return s
}

func itoa(v int) string { return fmt.Sprintf("%d", v) }

// tryAliasMatch — этап 2.3 (§6): exact-применение ранее ПОДТВЕРЖДЁННОГО
// пользователем соответствия. Вызывается только когда exact canonical match
// не дал уникального результата; несколько целей → blocker-конфликт (система
// никогда не выбирает сама); устаревшая нормализация → requires_review
// warning, строка остаётся неразрешённой.
func (a *analyzer) tryAliasMatch(
	it *NormalizedItem, pr *PreviewRow, issue func(Issue),
	nomRaw, nomSrc, dcCtxID string, isWork bool,
) bool {
	if a.refs.Aliases == nil {
		return false
	}
	unit := ""
	if it.UnitCode != nil {
		unit = *it.UnitCode
	}
	res := a.refs.Aliases.Resolve(nomRaw, it.BoqItemType, unit, dcCtxID)
	switch res.Status {
	case importmemory.AliasMatched:
		al := res.Alias
		// Защита от недоступной цели: каталожная запись обязана существовать
		// в текущих справочниках (§13; FK CASCADE делает это редким).
		unitByID := a.refs.MatNameUnits
		if isWork {
			unitByID = a.refs.WorkNameUnits
		}
		if _, exists := unitByID[al.CatalogID]; !exists {
			issue(Issue{Code: "NOMENCLATURE_ALIAS_TARGET_UNAVAILABLE", Severity: SeverityWarning,
				TargetField: FieldNomenclature, SourceColumn: nomSrc, RawValue: nomRaw,
				Message: "Сохранённое соответствие указывает на недоступную номенклатуру — выберите вариант заново",
				FixHint: "Цель могла быть удалена или изменена; соответствие можно забыть в «Сохранённых настройках импорта»"})
			return false
		}
		id := al.CatalogID
		if isWork {
			it.WorkNameID = &id
		} else {
			it.MaterialNameID = &id
		}
		it.AliasID = al.ID
		pr.Nomenclature = nomRaw
		pr.AliasProvenance = &AliasProvenance{
			MatchMethod: "user_approved_alias", AliasID: al.ID, CatalogID: al.CatalogID,
			SavedAt: al.SavedAt, UseCount: al.UseCount,
			SourceLabel: "Подтверждено вами ранее",
		}
		issue(Issue{Code: "NOMENCLATURE_ALIAS_MATCH", Severity: SeverityInformation,
			TargetField: FieldNomenclature, RawValue: nomRaw, Normalized: al.CatalogID,
			Message: "Номенклатура подобрана по ранее подтверждённому соответствию («Подтверждено вами ранее»)"})
		return true
	case importmemory.AliasConflict:
		issue(Issue{Code: "NOMENCLATURE_ALIAS_CONFLICT", Severity: SeverityBlocker,
			TargetField: FieldNomenclature, SourceColumn: nomSrc, RawValue: nomRaw,
			Message: "Несколько сохранённых соответствий указывают на разные номенклатуры — выберите вручную",
			FixHint: "Деактивируйте неверное соответствие в «Сохранённых настройках импорта»"})
		return true // строка обработана: конфликт требует решения пользователя
	case importmemory.AliasRequiresReview:
		issue(Issue{Code: "NOMENCLATURE_ALIAS_REQUIRES_REVIEW", Severity: SeverityWarning,
			TargetField: FieldNomenclature, SourceColumn: nomSrc, RawValue: nomRaw,
			Message: "Сохранённое соответствие создано в другой версии нормализации — подтвердите выбор заново"})
		return false
	default:
		return false
	}
}
