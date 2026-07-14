package quality

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sort"
	"strings"

	"github.com/su10/hubtender/backend/internal/calc"
)

// moneyTolerance — допуск сравнения persisted float-значений с пересчётом
// ядра: одна копейка (шум последнего денежного знака, как в 0-F1 import
// mismatch). Только для диагностики — ничего не переписывается.
const moneyTolerance = 0.01

// Evaluate — ЕДИНСТВЕННАЯ точка входа чистого движка: Snapshot → Report.
// Детерминирован, без I/O, без мутаций входа.
func Evaluate(s *Snapshot) *Report {
	e := &evaluator{s: s}
	e.positionIndex()

	e.checkCalculationState()
	e.checkCurrency()
	e.checkRelations()
	e.checkRedistribution()
	e.checkApproval()
	e.checkDerivedConsistency()
	e.checkBoqInputs()
	e.checkDuplicates()
	calcPct, reviewPct := e.completeness()

	e.sortIssues()

	itemsWithIssues := map[string]struct{}{}
	catAgg := map[string]*CategorySummary{}
	sum := Summary{
		CalculationCompletenessPercent: calcPct,
		ReviewCompletenessPercent:      reviewPct,
		PositionsTotal:                 len(s.Positions),
		BoqItemsTotal:                  len(s.Items),
	}
	for i := range e.issues {
		is := &e.issues[i]
		c := catAgg[is.Category]
		if c == nil {
			c = &CategorySummary{Code: is.Category}
			catAgg[is.Category] = c
		}
		switch is.Severity {
		case SeverityBlocker:
			sum.Blockers++
			c.Blockers++
		case SeverityWarning:
			sum.Warnings++
			c.Warnings++
		default:
			sum.Information++
			c.Information++
		}
		if is.EntityType == "boq_item" {
			itemsWithIssues[is.EntityID] = struct{}{}
		}
		for _, id := range is.AffectedItemIDs {
			itemsWithIssues[id] = struct{}{}
		}
	}
	sum.BoqItemsWithIssues = len(itemsWithIssues)

	cats := make([]CategorySummary, 0, len(catAgg))
	for _, c := range catAgg {
		cats = append(cats, *c)
	}
	sort.Slice(cats, func(a, b int) bool { return cats[a].Code < cats[b].Code })

	return &Report{
		TenderID:                     s.Tender.ID,
		FinancialInputRevision:       s.Tender.FinancialInputRevision,
		FinancialCalculationRevision: s.Tender.FinancialCalculationRevision,
		FinancialCalculationStatus:   s.Tender.FinancialCalculationStatus,
		GeneratedAt:                  s.GeneratedAt,
		Summary:                      sum,
		Categories:                   cats,
		Issues:                       e.issues,
	}
}

type evaluator struct {
	s        *Snapshot
	issues   []Issue
	posOrder map[string]int // client_position_id → детерминированный порядок
}

func (e *evaluator) positionIndex() {
	e.posOrder = make(map[string]int, len(e.s.Positions))
	for _, p := range e.s.Positions {
		e.posOrder[p.ID] = p.SortIndex
	}
}

// issueID — стабильный детерминированный ID (никаких случайных UUID).
func issueID(code, entityType, entityID, field string) string {
	h := sha256.Sum256([]byte(code + "|" + entityType + "|" + entityID + "|" + field))
	return hex.EncodeToString(h[:8])
}

func (e *evaluator) add(is Issue) {
	is.ID = issueID(is.Code, is.EntityType, is.EntityID, is.Field)
	e.issues = append(e.issues, is)
}

func sptrOf(v string) *string { return &v }

// ─── A. Financial calculation state (агрегированно, tender-level) ────────────

func (e *evaluator) checkCalculationState() {
	t := e.s.Tender
	base := Issue{
		Severity:   SeverityBlocker,
		Category:   CategoryCalculationState,
		EntityType: "tender",
		EntityID:   t.ID,
		Field:      "financial_calculation_status",
	}
	switch t.FinancialCalculationStatus {
	case "stale":
		base.Code = "CALCULATION_STALE"
		base.Title = "Расчёт устарел"
		base.Message = "Финансовые данные изменены после последнего расчёта — показанные итоги не окончательны."
		base.FixHint = "Дождитесь автоматического пересчёта; итог обновится сам."
		base.CurrentValue = sptrOf("stale")
		e.add(base)
	case "calculating":
		base.Code = "CALCULATION_RUNNING"
		base.Title = "Выполняется пересчёт"
		base.Message = "Идёт фоновый пересчёт коммерческих стоимостей — итоги обновляются."
		base.FixHint = "Дождитесь завершения расчёта."
		base.CurrentValue = sptrOf("calculating")
		e.add(base)
	case "failed":
		base.Code = "CALCULATION_FAILED"
		msg := "Последний пересчёт завершился ошибкой."
		if t.FinancialCalculationError != nil {
			msg = "Последний пересчёт завершился ошибкой (" + *t.FinancialCalculationError + ")."
		}
		base.Title = "Ошибка расчёта"
		base.Message = msg
		base.FixHint = "Исправьте входные данные тендера (например, валютные курсы) и повторите изменение."
		base.CurrentValue = t.FinancialCalculationError
		e.add(base)
	case "calculated":
		if t.FinancialCalculationRevision != t.FinancialInputRevision {
			base.Code = "CALCULATION_REVISION_MISMATCH"
			base.Field = "financial_calculation_revision"
			base.Title = "Расчёт не соответствует текущим данным"
			base.Message = fmt.Sprintf("Статус «рассчитано», но расчёт выполнен для ревизии %d, а текущая ревизия входов — %d.",
				t.FinancialCalculationRevision, t.FinancialInputRevision)
			base.FixHint = "Внесите любое финансовое изменение или дождитесь пересчёта — статус синхронизируется."
			base.CurrentValue = sptrOf(fmt.Sprintf("%d != %d", t.FinancialCalculationRevision, t.FinancialInputRevision))
			e.add(base)
		}
	default:
		base.Code = "CALCULATION_STATE_UNKNOWN"
		base.Title = "Неизвестный статус расчёта"
		base.Message = "Статус финансового расчёта имеет непредусмотренное значение."
		base.FixHint = "Обратитесь к администратору."
		base.CurrentValue = sptrOf(t.FinancialCalculationStatus)
		e.add(base)
	}
}

// calculationIsCurrent — derived-проверки имеют смысл ТОЛЬКО в этом состоянии
// (при stale/calculating расхождение ожидаемо и уже покрыто state-issue).
func (e *evaluator) calculationIsCurrent() bool {
	t := e.s.Tender
	return t.FinancialCalculationStatus == "calculated" &&
		t.FinancialCalculationRevision == t.FinancialInputRevision
}

// ─── B. Currency: одна агрегированная issue на валюту ────────────────────────

func (e *evaluator) checkCurrency() {
	type cur struct {
		code  string
		rate  *float64
		field string
		name  string
	}
	currencies := []cur{
		{"USD", e.s.Tender.USDRate, "usd_rate", "USD"},
		{"EUR", e.s.Tender.EURRate, "eur_rate", "EUR"},
		{"CNY", e.s.Tender.CNYRate, "cny_rate", "CNY"},
	}
	for _, c := range currencies {
		if c.rate != nil && *c.rate > 0 {
			continue
		}
		var affected []string
		for _, it := range e.s.Items {
			if it.CurrencyType == c.code {
				affected = append(affected, it.ID)
			}
		}
		if len(affected) == 0 {
			continue // RUB-only тендер может не иметь иностранных курсов
		}
		sort.Strings(affected)
		firstPos := ""
		for _, it := range e.s.Items {
			if it.ID == affected[0] {
				firstPos = it.ClientPositionID
				break
			}
		}
		cv := "не задан"
		if c.rate != nil {
			cv = fmt.Sprintf("%v", *c.rate)
		}
		e.add(Issue{
			Code:             "FX_RATE_MISSING",
			Severity:         SeverityBlocker,
			Category:         CategoryCurrency,
			EntityType:       "tender",
			EntityID:         e.s.Tender.ID,
			ClientPositionID: firstPos,
			Field:            c.field,
			Title:            "Не задан курс " + c.name,
			Message: fmt.Sprintf("В смете %d строк(и) в валюте %s, но курс не задан или не положителен — строки не могут быть рассчитаны в рублях.",
				len(affected), c.name),
			FixHint:         "Укажите курс " + c.name + " в параметрах тендера.",
			CurrentValue:    sptrOf(cv),
			AffectedItemIDs: capIDs(affected),
			AffectedCount:   len(affected),
		})
	}
}

// capIDs ограничивает список навигационных ID (не раздуваем ответ).
func capIDs(ids []string) []string {
	if len(ids) > 20 {
		return ids[:20]
	}
	return ids
}

// ─── C. Parent integrity — канонические предикаты этапа 0 ────────────────────

func (e *evaluator) checkRelations() {
	byID := make(map[string]*SnapshotItem, len(e.s.Items))
	for i := range e.s.Items {
		byID[e.s.Items[i].ID] = &e.s.Items[i]
	}
	for i := range e.s.Items {
		it := &e.s.Items[i]
		if it.ParentWorkItemID == nil || *it.ParentWorkItemID == "" {
			continue
		}
		pid := *it.ParentWorkItemID
		base := Issue{
			Severity:         SeverityBlocker,
			Category:         CategoryRelations,
			EntityType:       "boq_item",
			EntityID:         it.ID,
			ClientPositionID: it.ClientPositionID,
			Field:            "parent_work_item_id",
			CurrentValue:     sptrOf(pid),
		}
		if pid == it.ID {
			base.Code = "PARENT_SELF_REFERENCE"
			base.Title = "Строка ссылается сама на себя"
			base.Message = "Материал указан родителем самого себя — связь некорректна."
			base.FixHint = "Уберите связь или укажите реальную работу-родителя."
			e.add(base)
			continue
		}
		parent, ok := byID[pid]
		if !ok {
			// в снапшоте только строки ЭТОГО тендера → отсутствие =
			// либо parent удалён, либо принадлежит другому тендеру.
			base.Code = "PARENT_NOT_FOUND"
			base.Title = "Родительская работа не найдена"
			base.Message = "Ссылка на родительскую работу указывает на строку, которой нет в этом тендере (удалена или чужой тендер)."
			base.FixHint = "Свяжите материал с существующей работой этой позиции или уберите связь."
			e.add(base)
			continue
		}
		if parent.ClientPositionID != it.ClientPositionID {
			base.Code = "PARENT_CROSS_POSITION"
			base.Title = "Родитель из другой позиции"
			base.Message = "Материал привязан к работе из другой позиции заказчика — рабочий процесс связывает строки внутри одной позиции."
			base.FixHint = "Перепривяжите материал к работе своей позиции."
			e.add(base)
			continue
		}
		if !calc.IsWorkBoqType(parent.BoqItemType) {
			base.Code = "PARENT_NOT_WORK_ITEM"
			base.Title = "Родитель — не работа"
			base.Message = fmt.Sprintf("Родительская строка имеет тип «%s», а родителем может быть только работа.", parent.BoqItemType)
			base.FixHint = "Укажите работу (раб / суб-раб / раб-комп.) в качестве родителя."
			e.add(base)
		}
	}
}

// ─── D. Redistribution (облегчённые признаки из metadata снапшота) ───────────

func (e *evaluator) checkRedistribution() {
	r := e.s.Redistribution
	if !r.Configured {
		return
	}
	base := Issue{
		Severity:   SeverityBlocker,
		Category:   CategoryRedistribution,
		EntityType: "tender",
		EntityID:   e.s.Tender.ID,
		Field:      "redistribution",
	}
	if r.SchemaVersion < calc.RedistributionSchemaVersion || r.CalculationSource != calc.RedistributionCalculationServer {
		base.Code = "REDISTRIBUTION_LEGACY_SNAPSHOT"
		base.Title = "Перераспределение требует пересчёта"
		base.Message = "Сохранённый расчёт перераспределения создан старой версией и не является серверным."
		base.FixHint = "Откройте «Перераспределение» и выполните пересчёт."
		e.add(base)
		return
	}
	snapRev := int64(0)
	if r.FinancialInputRevision != nil {
		snapRev = *r.FinancialInputRevision
	}
	if snapRev != e.s.Tender.FinancialInputRevision {
		base.Code = "REDISTRIBUTION_INPUT_REVISION_CHANGED"
		base.Title = "Перераспределение устарело"
		base.Message = fmt.Sprintf("Финансовые данные изменились после сохранения перераспределения (снапшот: ревизия %d, текущая: %d).",
			snapRev, e.s.Tender.FinancialInputRevision)
		base.FixHint = "Откройте «Перераспределение» и выполните пересчёт."
		base.CurrentValue = sptrOf(fmt.Sprintf("%d != %d", snapRev, e.s.Tender.FinancialInputRevision))
		e.add(base)
	}
}

// ─── E. Approval: повреждённое legacy-состояние ──────────────────────────────

func (e *evaluator) checkApproval() {
	if !e.s.Tender.FinancialApproved {
		return
	}
	if e.calculationIsCurrent() {
		return
	}
	e.add(Issue{
		Code:       "APPROVAL_ON_STALE_CALCULATION",
		Severity:   SeverityBlocker,
		Category:   CategoryApproval,
		EntityType: "tender",
		EntityID:   e.s.Tender.ID,
		Field:      "financial_approved",
		Title:      "Согласование при неактуальном расчёте",
		Message:    "Тендер помечен согласованным, хотя финансовый расчёт не является актуальным. После этапа 0 такое состояние возможно только у повреждённых/исторических данных.",
		FixHint:    "Дождитесь пересчёта и выполните согласование заново.",
	})
}

// ─── F. Derived consistency — только при актуальном расчёте ──────────────────

func (e *evaluator) checkDerivedConsistency() {
	if !e.calculationIsCurrent() {
		return // расхождения ожидаемы и уже покрыты CALCULATION_STATE
	}
	t := e.s.Tender
	rates := calc.CurrencyRates{USDRate: t.USDRate, EURRate: t.EURRate, CNYRate: t.CNYRate}

	type posAgg struct{ mat, work float64 }
	perPos := map[string]*posAgg{}

	for i := range e.s.Items {
		it := &e.s.Items[i]
		agg := perPos[it.ClientPositionID]
		if agg == nil {
			agg = &posAgg{}
			perPos[it.ClientPositionID] = agg
		}
		stored := 0.0
		if it.StoredTotalAmount != nil {
			stored = *it.StoredTotalAmount
		}
		if calc.IsWorkBoqType(it.BoqItemType) {
			agg.work += stored
		} else {
			agg.mat += stored
		}

		// 18. total_amount vs существующее ядро (никакой своей формулы).
		expected, err := calc.CalculateBoqItemTotalAmount(calc.BoqItemAmountInput{
			BoqItemType:            it.BoqItemType,
			Quantity:               it.Quantity,
			UnitRate:               it.UnitRate,
			CurrencyType:           it.CurrencyType,
			DeliveryPriceType:      derefS(it.DeliveryPriceType),
			DeliveryAmount:         it.DeliveryAmount,
			ConsumptionCoefficient: it.ConsumptionCoefficient,
			ParentWorkItemID:       it.ParentWorkItemID,
			TotalAmount:            it.StoredTotalAmount,
		}, rates)
		if err != nil {
			continue // курс отсутствует → уже blocker в CURRENCY
		}
		if math.Abs(expected-stored) > moneyTolerance {
			e.add(Issue{
				Code:             "BOQ_TOTAL_AMOUNT_MISMATCH",
				Severity:         SeverityBlocker,
				Category:         CategoryDerivedConsistency,
				EntityType:       "boq_item",
				EntityID:         it.ID,
				ClientPositionID: it.ClientPositionID,
				Field:            "total_amount",
				Title:            "Сохранённая сумма строки не совпадает с расчётом",
				Message: fmt.Sprintf("В БД сохранено %.2f, авторитетный расчёт даёт %.2f. Значение могло быть записано в обход серверного пересчёта.",
					stored, expected),
				FixHint:      "Отредактируйте строку (любое изменение входов пересчитает сумму сервером).",
				CurrentValue: sptrOf(fmt.Sprintf("%.2f", stored)),
			})
		}
	}

	// 19. position stored totals vs сумма её BOQ (действующая серверная
	// семантика RecomputePositionTotals*: SUM по типам).
	for _, p := range e.s.Positions {
		agg := perPos[p.ID]
		mat, work := 0.0, 0.0
		if agg != nil {
			mat, work = agg.mat, agg.work
		}
		if math.Abs(p.TotalMaterial-mat) > moneyTolerance || math.Abs(p.TotalWorks-work) > moneyTolerance {
			e.add(Issue{
				Code:             "POSITION_TOTALS_MISMATCH",
				Severity:         SeverityBlocker,
				Category:         CategoryDerivedConsistency,
				EntityType:       "client_position",
				EntityID:         p.ID,
				ClientPositionID: p.ID,
				Field:            "total_material,total_works",
				Title:            "Итоги позиции не совпадают с её строками",
				Message: fmt.Sprintf("Сохранено материалы %.2f / работы %.2f, сумма строк даёт %.2f / %.2f.",
					p.TotalMaterial, p.TotalWorks, mat, work),
				FixHint:      "Итоги позиции обновятся при любом изменении её строк (пересчёт выполняет сервер).",
				CurrentValue: sptrOf(fmt.Sprintf("%.2f/%.2f", p.TotalMaterial, p.TotalWorks)),
			})
		}
	}

	// 20. cached_grand_total vs decimal-ядро (materialized commercial + insurance).
	e.checkCachedGrandTotal()
}

func (e *evaluator) checkCachedGrandTotal() {
	ins := e.s.Insurance
	var insurancePtr *calc.InsuranceDecimalInput
	if ins.Present {
		insurancePtr = &calc.InsuranceDecimalInput{
			JudicialPct: ins.JudicialPct, TotalPct: ins.TotalPct,
			AptPriceM2: ins.AptPriceM2, AptArea: ins.AptArea,
			ParkingPriceM2: ins.ParkingPriceM2, ParkingArea: ins.ParkingArea,
			StoragePriceM2: ins.StoragePriceM2, StorageArea: ins.StorageArea,
		}
	}
	insTotal, err := calc.CalculateInsuranceTotalDecimal(insurancePtr)
	if err != nil {
		return // невалидная конфигурация страхования всплывает своими путями
	}
	insText, err := calc.ExactDecimalString("insurance_total", insTotal)
	if err != nil {
		return
	}
	res, err := calc.CalculateCachedTenderGrandTotal(calc.CachedTenderGrandTotalInput{
		CommercialMaterialTotal: ins.CommercialMaterialTotalText,
		CommercialWorkTotal:     ins.CommercialWorkTotalText,
		InsuranceTotalDecimal:   insText,
	})
	if err != nil {
		return
	}
	// Байтовое сравнение канонических decimal-строк (::text vs ядро) — с
	// нормализацией хвостовых нулей через повторную каноникализацию.
	stored := canonicalMoneyText(e.s.Tender.CachedGrandTotal)
	if stored != res.RoundedTotalDecimal {
		e.add(Issue{
			Code:       "CACHED_GRAND_TOTAL_MISMATCH",
			Severity:   SeverityBlocker,
			Category:   CategoryDerivedConsistency,
			EntityType: "tender",
			EntityID:   e.s.Tender.ID,
			Field:      "cached_grand_total",
			Title:      "Итог тендера не совпадает с расчётом",
			Message: fmt.Sprintf("Сохранённый итог %s, авторитетный расчёт даёт %s.",
				stored, res.RoundedTotalDecimal),
			FixHint:      "Любое финансовое изменение пересчитает итог; при повторении — сообщите администратору.",
			CurrentValue: sptrOf(stored),
		})
	}
}

// canonicalMoneyText нормализует numeric::text к канону ядра "1234.56"
// (numeric без scale может отдавать "1000" или "1000.4600").
func canonicalMoneyText(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "0.00"
	}
	neg := strings.HasPrefix(s, "-")
	s = strings.TrimPrefix(s, "-")
	whole, frac, _ := strings.Cut(s, ".")
	frac = frac + "00"
	frac = frac[:2] + strings.TrimRight(frac[2:], "0")
	if strings.Trim(frac[2:], "0") != "" {
		// больше 2 значащих знаков — оставляем как есть (несовпадение честно всплывёт)
		frac = frac[:2] + strings.TrimRight(frac[2:], "0")
	} else {
		frac = frac[:2]
	}
	if whole == "" {
		whole = "0"
	}
	whole = strings.TrimLeft(whole, "0")
	if whole == "" {
		whole = "0"
	}
	out := whole + "." + frac
	if neg && out != "0.00" {
		out = "-" + out
	}
	return out
}

func derefS(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
