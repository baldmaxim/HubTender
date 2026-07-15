package reviewpack

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/xuri/excelize/v2"

	ap "github.com/su10/hubtender/backend/internal/analytics/actionplan"
	ci "github.com/su10/hubtender/backend/internal/analytics/changeimpact"
	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
)

// appNavPath — внутренний typed-путь HUBTender (текст, не формула): читаемая
// «Ссылка в HUBTender» для перехода из отчёта.
func appNavPath(tenderID string, posID, itemID *string, field string) string {
	if posID == nil || *posID == "" {
		return "/financial-indicators?tenderId=" + tenderID
	}
	q := url.Values{"tenderId": {tenderID}, "positionId": {*posID}}
	if itemID != nil && *itemID != "" {
		q.Set("itemId", *itemID)
	}
	if field != "" {
		q.Set("field", field)
	}
	return "/positions/" + *posID + "/items?" + q.Encode()
}

func actionNavPath(a *ap.Action, tenderID string) string {
	switch a.Navigation.Type {
	case ap.NavTenderCurrency:
		return "/admin/tenders?tenderId=" + tenderID + "&focus=rates"
	case ap.NavRedistribution:
		return "/commerce/redistribution?tenderId=" + tenderID
	case ap.NavFinancialIndicators:
		return "/financial-indicators?tenderId=" + tenderID
	case ap.NavBoqItem, ap.NavDuplicateGroup:
		return appNavPath(tenderID, a.Navigation.PositionID, a.Navigation.ItemID, a.Navigation.Field)
	default:
		return "/analytics/action-plan?tenderId=" + tenderID
	}
}

// ─── Лист «Сводка» (§9) ──────────────────────────────────────────────────────

func (c *renderCtx) renderSummary(m *Model) error {
	sh := SheetOrder[0]
	md := &m.Metadata
	_ = c.f.SetColWidth(sh, "A", "A", 38)
	_ = c.f.SetColWidth(sh, "B", "B", 80)

	c.setText(sh, 1, 1, "Отчёт для проверки тендера", c.title)
	row := 3
	row = c.kv(sh, row, "Тендер", md.TenderLabel)
	row = c.kv(sh, row, "Номер / версия", md.TenderNumber+" · v"+fmtInt(md.TenderVersion))
	row = c.kv(sh, row, "Финансовая ревизия входов", fmt.Sprintf("%d (расчёт: %d, статус: %s)",
		md.FinancialInputRevision, md.FinancialCalcRevision, md.FinancialCalcStatus))
	row = c.kv(sh, row, "Отпечаток отчёта (fingerprint)", md.ReportFingerprint)
	row = c.kv(sh, row, "Параметры", fmt.Sprintf("история цен: %d мес.; допустимый возраст источника: %d дн.",
		md.BenchmarkPeriodMonths, md.SourceMaxAgeDays))
	approval := "не согласован"
	if md.FinancialApproved {
		approval = "согласован"
		if md.ApprovedByLabel != "" {
			approval += " — " + md.ApprovedByLabel
		}
		if md.ApprovedAt != "" {
			approval += " (" + md.ApprovedAt + ")"
		}
	}
	row = c.kv(sh, row, "Согласование финансовых показателей", approval)
	c.setText(sh, 1, row, "Финансовый итог (cached grand total), ₽", c.bold)
	c.setMoney(sh, 2, row, &md.CachedGrandTotal)
	row++
	c.setText(sh, 1, row, "Сформирован", c.bold)
	c.setDate(sh, 2, row, md.GeneratedAt)
	row += 2

	c.setText(sh, 1, row, "Итог проверки", c.title)
	row++
	row = c.kv(sh, row, "Заголовок", m.Executive.Headline)
	row++

	e := &m.Executive
	c.setText(sh, 1, row, "Компоненты отчёта", c.title)
	row++
	comp := func(label string, st SectionStatus, summary string) {
		v := st.Status
		if st.Note != "" {
			v += " — " + st.Note
		}
		if summary != "" {
			v += " · " + summary
		}
		row = c.kv(sh, row, label, v)
	}
	comp("Качество расчёта", m.Sections.Quality,
		fmt.Sprintf("блокирующих: %d; предупреждений: %d; строк с проблемами: %d; полнота расчёта: %.1f%%",
			e.Quality.Blockers, e.Quality.Warnings, e.Quality.BoqItemsWithIssues, e.Quality.CalculationCompleteness))
	planSummary := fmt.Sprintf("блокирующих: %d; высоких: %d; затронуто строк: %d; сумма к проверке: %s",
		e.ActionPlan.Blocking, e.ActionPlan.High, e.ActionPlan.AffectedItems, fmtMoneyPtr(e.ActionPlan.AmountRequiringReview))
	if m.ActionPlan != nil && m.ActionPlan.Summary.ActionsTotal == 0 {
		planSummary = "Обязательных действий не обнаружено"
	}
	comp("План действий", m.Sections.ActionPlan, planSummary)
	comp("Ценовые отклонения", m.Sections.Benchmark,
		fmt.Sprintf("выше диапазона: %d; ниже: %d; в диапазоне: %d; покрытие: %.1f%%",
			e.Benchmark.HighOutliers, e.Benchmark.LowOutliers, e.Benchmark.WithinRange, e.Benchmark.CoveragePercent))
	comp("Источники цен", m.Sections.Source,
		fmt.Sprintf("покрытие: %.1f%%; актуальное: %.1f%%; устарели: %d; истекли: %d; без источника: %d",
			e.Source.CoveragePercent, e.Source.CurrentCoveragePercent, e.Source.Stale, e.Source.Expired, e.Source.MissingSource))
	ciSummary := fmt.Sprintf("Δ итога: %.2f; добавлено: %d; удалено: %d; изменено: %d; сверка: %s",
		e.ChangeImpact.GrandTotalDelta, e.ChangeImpact.Added, e.ChangeImpact.Removed, e.ChangeImpact.Modified, e.ChangeImpact.Reconciliation)
	if m.Sections.ChangeImpact.Status == SectionBaselineNA {
		ciSummary = "Предыдущая согласованная версия отсутствует"
	}
	comp("Изменения расчёта", m.Sections.ChangeImpact, ciSummary)
	row++
	c.setText(sh, 1, row, ReviewDisclaimer, c.warnText)
	_ = c.f.MergeCell(sh, cell(1, row), cell(2, row))
	return nil
}

// ─── Лист «План действий» (§10) ──────────────────────────────────────────────

func (c *renderCtx) renderActionPlan(m *Model) error {
	sh := SheetOrder[1]
	headers := []string{"Ранг", "Приоритет", "Источник аналитики", "Категория", "Действие",
		"Причина", "Рекомендация", "Позиция", "BOQ-строка", "Поле",
		"Затронуто строк", "Сумма воздействия, ₽", "Статус суммы", "Ссылка в HUBTender"}
	widths := []float64{7, 12, 18, 18, 32, 44, 44, 38, 38, 16, 12, 16, 14, 46}
	if err := c.tableHeader(sh, 1, headers, widths); err != nil {
		return err
	}
	if m.ActionPlan == nil || len(m.ActionPlan.Actions) == 0 {
		c.setText(sh, 1, 2, "Обязательных действий не обнаружено.", c.wrap)
		return nil
	}
	acts := m.ActionPlan.Actions
	if err := guardRows(sh, len(acts)); err != nil {
		return err
	}
	for i := range acts {
		a := &acts[i]
		r := i + 2
		c.setNumber(sh, 1, r, float64(a.Rank)) // server rank, не client score
		c.setText(sh, 2, r, a.Priority, c.text)
		c.setText(sh, 3, r, strings.Join(a.Sources, ", "), c.text)
		c.setText(sh, 4, r, a.Category, c.text)
		c.setText(sh, 5, r, a.Title, c.wrap)
		c.setText(sh, 6, r, a.Reason, c.wrap)
		c.setText(sh, 7, r, a.RecommendedAction, c.wrap)
		c.setText(sh, 8, r, derefStr(a.ClientPositionID), c.text)
		c.setText(sh, 9, r, firstOf(a.BoqItemIDs), c.text)
		c.setText(sh, 10, r, a.Field, c.text)
		c.setNumber(sh, 11, r, float64(a.AffectedItemsCount))
		c.setMoney(sh, 12, r, a.ImpactAmount) // из Action Plan, без пересчёта
		c.setText(sh, 13, r, a.ImpactAmountStatus, c.text)
		c.setText(sh, 14, r, actionNavPath(a, m.Metadata.TenderID), c.text)
	}
	c.autoFilter(sh, 1, len(acts)+1, len(headers))
	return nil
}

// ─── Лист «Качество расчёта» (§11) ───────────────────────────────────────────

func (c *renderCtx) renderQuality(m *Model) error {
	sh := SheetOrder[2]
	headers := []string{"Severity", "Категория", "Код", "Заголовок", "Пояснение",
		"Рекомендация", "Позиция", "BOQ-строка", "Поле", "Текущее значение",
		"Затронуто строк", "Ссылка в HUBTender"}
	widths := []float64{13, 20, 26, 32, 52, 44, 38, 38, 20, 18, 12, 46}
	if err := c.tableHeader(sh, 1, headers, widths); err != nil {
		return err
	}
	if m.Quality == nil || len(m.Quality.Issues) == 0 {
		c.setText(sh, 1, 2, "Проблемы качества расчёта не обнаружены этим набором проверок.", c.wrap)
		return nil
	}
	issues := m.Quality.Issues
	if err := guardRows(sh, len(issues)); err != nil {
		return err
	}
	for i := range issues {
		is := &issues[i]
		r := i + 2
		c.setText(sh, 1, r, is.Severity, c.text) // текстом, не только цветом
		c.setText(sh, 2, r, is.Category, c.text)
		c.setText(sh, 3, r, is.Code, c.text)
		c.setText(sh, 4, r, is.Title, c.wrap)
		c.setText(sh, 5, r, is.Message, c.wrap)
		c.setText(sh, 6, r, is.FixHint, c.wrap)
		c.setText(sh, 7, r, is.ClientPositionID, c.text)
		itemID := ""
		if is.EntityType == "boq_item" {
			itemID = is.EntityID
		} else if len(is.AffectedItemIDs) > 0 {
			itemID = is.AffectedItemIDs[0]
		}
		c.setText(sh, 8, r, itemID, c.text)
		c.setText(sh, 9, r, is.Field, c.text)
		cur := ""
		if is.CurrentValue != nil {
			cur = *is.CurrentValue
		}
		c.setText(sh, 10, r, cur, c.text)
		c.setNumber(sh, 11, r, float64(maxInt(is.AffectedCount, boolToInt(is.EntityType == "boq_item"))))
		pos := is.ClientPositionID
		var posPtr, itemPtr *string
		if pos != "" {
			posPtr = &pos
		}
		if itemID != "" {
			itemPtr = &itemID
		}
		c.setText(sh, 12, r, appNavPath(m.Metadata.TenderID, posPtr, itemPtr, is.Field), c.text)
	}
	c.autoFilter(sh, 1, len(issues)+1, len(headers))
	return nil
}

// ─── Лист «Ценовые отклонения» (§12) ─────────────────────────────────────────

func (c *renderCtx) renderBenchmark(m *Model) error {
	sh := SheetOrder[3]
	if m.Benchmark == nil {
		c.setText(sh, 1, 1, "Ценовые отклонения не рассчитаны: "+m.Sections.Benchmark.Note, c.wrap)
		return nil
	}
	sm := m.Benchmark.Summary
	c.setText(sh, 1, 1, fmt.Sprintf(
		"В историческом диапазоне (WITHIN_RANGE): %d строк — в детальный список не включены. Период: %d мес.",
		sm.WithinRange, m.Metadata.BenchmarkPeriodMonths), c.wrap)
	headers := []string{"Статус", "Позиция", "Наименование", "Тип", "Единица",
		"Текущая цена за ед., ₽", "Медиана", "P25", "P75", "Нижняя граница", "Верхняя граница",
		"Отклонение от медианы, %", "Историч. тендеров", "Историч. строк", "Период, мес.",
		"Рекомендация", "Ссылка в HUBTender"}
	widths := []float64{22, 38, 40, 10, 10, 16, 14, 14, 14, 14, 14, 14, 12, 12, 10, 46, 46}
	if err := c.tableHeader(sh, 2, headers, widths); err != nil {
		return err
	}
	rows := 0
	r := 2
	for i := range m.Benchmark.Items {
		ib := &m.Benchmark.Items[i]
		switch ib.Status {
		case pb.StatusHighOutlier, pb.StatusLowOutlier, pb.StatusNotEligible, pb.StatusInsufficientHistory:
		default:
			continue // WITHIN_RANGE — только счётчик в summary (§12)
		}
		rows++
		if err := guardRows(sh, rows); err != nil {
			return err
		}
		r++
		c.setText(sh, 1, r, ib.Status, c.text)
		c.setText(sh, 2, r, ib.ClientPositionID, c.text)
		c.setText(sh, 3, r, ib.Name, c.wrap)
		c.setText(sh, 4, r, ib.BoqItemType, c.text)
		c.setText(sh, 5, r, ib.UnitCode, c.text)
		cur := ib.CurrentUnitCost
		c.setMoney(sh, 6, r, &cur)
		c.setMoney(sh, 7, r, ib.Median)
		c.setMoney(sh, 8, r, ib.P25)
		c.setMoney(sh, 9, r, ib.P75)
		c.setMoney(sh, 10, r, ib.LowerFence)
		c.setMoney(sh, 11, r, ib.UpperFence)
		if ib.DeviationFromMedianPercent != nil {
			c.setPercent(sh, 12, r, *ib.DeviationFromMedianPercent) // готовое серверное значение
		} else {
			c.setText(sh, 12, r, "—", c.text)
		}
		c.setNumber(sh, 13, r, float64(ib.HistoricalTendersCount))
		c.setNumber(sh, 14, r, float64(ib.HistoricalRowsCount))
		c.setNumber(sh, 15, r, float64(m.Metadata.BenchmarkPeriodMonths))
		c.setText(sh, 16, r, ib.ReviewHint, c.wrap)
		pos := ib.ClientPositionID
		id := ib.BoqItemID
		c.setText(sh, 17, r, appNavPath(m.Metadata.TenderID, &pos, &id, "unit_rate"), c.text)
	}
	c.autoFilter(sh, 2, r, len(headers))
	return nil
}

// ─── Лист «Источники цен» (§13) ──────────────────────────────────────────────

func (c *renderCtx) renderSource(m *Model) error {
	sh := SheetOrder[4]
	if m.Source == nil {
		c.setText(sh, 1, 1, "Данные об источниках цен недоступны.", c.wrap)
		return nil
	}
	sm := m.Source.Summary
	freshNA := 0
	for i := range m.Source.Items {
		if m.Source.Items[i].Status == ps.StatusNotApplicable {
			freshNA++
		}
	}
	c.setText(sh, 1, 1, fmt.Sprintf(
		"Актуальных источников (FRESH): %d; вне покрытия (NOT_APPLICABLE): %d — в список проверки не включены. Допустимый возраст: %d дн.",
		sm.FreshItems, freshNA, m.Metadata.SourceMaxAgeDays), c.wrap)
	headers := []string{"Статус", "Severity", "Позиция", "Наименование", "Тип",
		"Ставка, ₽", "Сумма строки, ₽", "Источник", "Дата цены", "Действительно до",
		"Возраст, дн.", "Дней до окончания", "Пояснение", "Рекомендация",
		"Ссылка на BOQ", "Ссылка на источник"}
	widths := []float64{22, 12, 38, 40, 10, 13, 15, 34, 12, 14, 10, 12, 46, 40, 46, 40}
	if err := c.tableHeader(sh, 2, headers, widths); err != nil {
		return err
	}
	rows := 0
	r := 2
	for i := range m.Source.Items {
		row := &m.Source.Items[i]
		switch row.Status {
		case ps.StatusSourceMissing, ps.StatusPriceDateMissing, ps.StatusStale,
			ps.StatusExpired, ps.StatusInvalidSourceDates, ps.StatusExpiringSoon:
		default:
			continue // FRESH/NOT_APPLICABLE — только counts (§13)
		}
		rows++
		if err := guardRows(sh, rows); err != nil {
			return err
		}
		r++
		c.setText(sh, 1, r, row.Status, c.text)
		c.setText(sh, 2, r, row.Severity, c.text)
		c.setText(sh, 3, r, row.ClientPositionID, c.text)
		c.setText(sh, 4, r, row.Name, c.wrap)
		c.setText(sh, 5, r, row.BoqItemType, c.text)
		c.setMoney(sh, 6, r, row.UnitRate)
		c.setMoney(sh, 7, r, row.TotalAmount)
		c.setText(sh, 8, r, row.SourceLabel, c.wrap)
		c.setDate(sh, 9, r, derefStr(row.PriceDate))
		c.setDate(sh, 10, r, derefStr(row.ValidUntil))
		if row.AgeDays != nil {
			c.setNumber(sh, 11, r, float64(*row.AgeDays))
		} else {
			c.setText(sh, 11, r, "—", c.text)
		}
		if row.DaysUntilExpiry != nil {
			c.setNumber(sh, 12, r, float64(*row.DaysUntilExpiry))
		} else {
			c.setText(sh, 12, r, "—", c.text)
		}
		c.setText(sh, 13, r, row.Message, c.wrap)
		c.setText(sh, 14, r, row.ReviewHint, c.wrap)
		pos := row.ClientPositionID
		id := row.BoqItemID
		c.setText(sh, 15, r, appNavPath(m.Metadata.TenderID, &pos, &id, "quote_link"), c.text)
		// Безопасная ссылка на источник: hyperlink ТОЛЬКО для https/http (§13/§17);
		// небезопасный URL остаётся обычным текстом.
		if safe := ps.SafeSourceURL(row.SourceURL); safe != nil {
			c.setText(sh, 16, r, *safe, c.text)
			_ = c.f.SetCellHyperLink(sh, cell(16, r), *safe, "External")
		} else {
			c.setText(sh, 16, r, derefStr(row.SourceURL), c.text)
		}
	}
	c.autoFilter(sh, 2, r, len(headers))
	return nil
}

// ─── Лист «Изменения расчёта» (§14) ──────────────────────────────────────────

func (c *renderCtx) renderChangeImpact(m *Model) error {
	sh := SheetOrder[5]
	_ = c.f.SetColWidth(sh, "A", "A", 30)
	if m.ChangeImpact == nil || m.ChangeImpact.Status == ci.ReportBaselineNotAvailable {
		c.setText(sh, 1, 1, "Предыдущая согласованная версия отсутствует — сравнение недоступно.", c.warnText)
		return nil
	}
	rep := m.ChangeImpact
	row := 1
	c.setText(sh, 1, row, "A. Версии сравнения", c.title)
	row++
	row = c.kv(sh, row, "Текущая версия", fmt.Sprintf("v%d (ревизия %d)", rep.Current.Version, rep.Current.InputRevision))
	if rep.Baseline != nil {
		row = c.kv(sh, row, "Базовая версия", fmt.Sprintf("v%d (согласована %s)", rep.Baseline.Version, rep.Baseline.ApprovedAt))
	}
	row++

	c.setText(sh, 1, row, "B. Мост изменения итога (reconciliation bridge)", c.title)
	row++
	for _, b := range rep.Bridge {
		c.setText(sh, 1, row, b.Label, c.bold)
		amt := b.Amount
		c.setMoney(sh, 2, row, &amt)
		row++
	}
	if !rep.Summary.IsReconciled {
		c.setText(sh, 1, row,
			fmt.Sprintf("ВНИМАНИЕ: изменение итоговой суммы не удалось полностью согласовать (расхождение %.2f ₽).",
				rep.Summary.ReconciliationResidual), c.warnText)
		_ = c.f.MergeCell(sh, cell(1, row), cell(6, row))
		row++
	}
	row++

	c.setText(sh, 1, row, "C. Изменения конфигурации (контекст, не денежная причина)", c.title)
	row++
	if len(rep.ConfigChanges) == 0 {
		row = c.kv(sh, row, "Изменений конфигурации", "нет")
	}
	for _, cc := range rep.ConfigChanges {
		row = c.kv(sh, row, cc.Label, cc.OldValue+" → "+cc.NewValue)
	}
	row++

	c.setText(sh, 1, row, "D. Крупнейшие изменения", c.title)
	row++
	for i, tc := range rep.TopContributors {
		if i >= 10 {
			break
		}
		c.setText(sh, 1, row, tc.Label, c.wrap)
		d := tc.Delta
		c.setMoney(sh, 2, row, &d)
		c.setText(sh, 3, row, tc.Direction, c.text)
		row++
	}
	row++

	c.setText(sh, 1, row, fmt.Sprintf("E. Изменённые строки (без изменений: %d — не включены)", rep.Summary.ItemsUnchanged), c.title)
	row++
	headers := []string{"Статус", "Позиция", "Строка/группа", "Изменённые поля",
		"Прямые: было, ₽", "Прямые: стало, ₽", "Прямая Δ, ₽",
		"Коммерч.: было, ₽", "Коммерч.: стало, ₽", "Коммерч. Δ, ₽", "Направление", "Ссылка в HUBTender"}
	hdrRow := row
	for i, h := range headers {
		c.setText(sh, i+1, hdrRow, h, c.header)
	}
	widths := []float64{18, 34, 40, 40, 15, 15, 15, 15, 15, 15, 13, 46}
	for i, w := range widths {
		col, _ := colName(i + 1)
		_ = c.f.SetColWidth(sh, col, col, w)
	}
	rows := 0
	r := hdrRow
	for i := range rep.Items {
		d := &rep.Items[i]
		if d.Status == ci.StatusUnchanged {
			continue
		}
		rows++
		if err := guardRows(sh, rows); err != nil {
			return err
		}
		r++
		c.setText(sh, 1, r, d.Status, c.text)
		c.setText(sh, 2, r, d.PositionLabel, c.wrap)
		c.setText(sh, 3, r, d.Label, c.wrap)
		var fields []string
		for _, fc := range d.ChangedFields {
			fields = append(fields, fc.Label)
		}
		c.setText(sh, 4, r, strings.Join(fields, ", "), c.wrap)
		bp, cp2, dp := d.Direct.Baseline, d.Direct.Current, d.Direct.Delta
		c.setMoney(sh, 5, r, &bp)
		c.setMoney(sh, 6, r, &cp2)
		c.setMoney(sh, 7, r, &dp)
		cb, ccur, cd := d.Commercial.Baseline, d.Commercial.Current, d.Commercial.Delta
		c.setMoney(sh, 8, r, &cb)
		c.setMoney(sh, 9, r, &ccur)
		c.setMoney(sh, 10, r, &cd)
		c.setText(sh, 11, r, d.Direction, c.text)
		// REMOVED/группа — без ложной ссылки на текущую строку (§14).
		link := ""
		if d.Status != ci.StatusRemoved && d.Status != ci.StatusAmbiguousGroup &&
			d.ClientPositionID != nil && d.CurrentItemID != nil {
			link = appNavPath(m.Metadata.TenderID, d.ClientPositionID, d.CurrentItemID, "")
		}
		c.setText(sh, 12, r, link, c.text)
	}
	c.autoFilter(sh, hdrRow, r, len(headers))
	return nil
}

// ─── Лист «Методика» (§15) ───────────────────────────────────────────────────

func (c *renderCtx) renderMethodology(m *Model) error {
	sh := SheetOrder[6]
	_ = c.f.SetColWidth(sh, "A", "A", 34)
	_ = c.f.SetColWidth(sh, "B", "B", 110)
	c.setText(sh, 1, 1, "Методика формирования отчёта", c.title)
	row := 3
	kv := func(k, v string) { row = c.kv(sh, row, k, v) }
	kv("Версия схемы отчёта", fmtInt(m.Metadata.ReportSchemaVersion))
	kv("Fingerprint", m.Metadata.ReportFingerprint+" — отчёт сформирован для финансовой ревизии "+
		fmt.Sprintf("%d", m.Metadata.FinancialInputRevision)+" и указанных параметров; не зависит от времени генерации.")
	kv("Финансовая ревизия", "Все суммы — server-authoritative значения расчёта HUBTender; при любом изменении входов ревизия растёт, отчёт формируется только для актуального расчёта. Excel не пересчитывает деньги; формулы не используются.")
	kv("Качество расчёта", "Детерминированные проверки этапа 1.1: статус расчёта, валютные курсы, связи строк, согласованность сумм, перераспределение, полнота, точные дубли. См. docs/TENDER_QUALITY_ANALYTICS.md.")
	kv("План действий", "Приоритеты blocking/high/normal/low по правилам этапа 1.4; blocking — только из блокирующих проблем качества. Server rank; без клиентского score. См. docs/TENDER_REVIEW_ACTION_PLAN.md.")
	kv("Ценовые отклонения", "Историческая метрика: authoritative total_amount / quantity по согласованным актуальным версиям (мин. 5 тендеров); медиана, P25/P75, границы Тьюки ±1.5·IQR. Отклонение — «требует проверки», не доказанная ошибка. См. docs/PRICE_BENCHMARK_ANALYTICS.md.")
	kv("Источники цен", fmt.Sprintf("Свежесть: max_age_days=%d, окно «скоро истечёт» 14 дн.; классификация по серверной дате. См. docs/PRICE_SOURCE_FRESHNESS_ANALYTICS.md.", m.Metadata.SourceMaxAgeDays))
	kv("Изменения расчёта", "Exact-сопоставление позиций/строк по устойчивым ключам (без fuzzy/AI); дубли ключа — сравнение группой (AMBIGUOUS_GROUP); мост сверки: Σ коммерческих дельт строк + страхование = Δ итога (допуск 0.01 ₽). См. docs/TENDER_CHANGE_IMPACT_ANALYTICS.md.")
	kv("Ограничения", "Аналитика указывает, что проверить, и не является юридическим заключением о корректности цен; изменения конфигурации — контекст без причинной суммы; сравнение только сохранённых версий.")
	return nil
}

// ─── маленькие helpers ───────────────────────────────────────────────────────

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func firstOf(list []string) string {
	if len(list) == 0 {
		return ""
	}
	return list[0]
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func colName(n int) (string, error) {
	return excelize.ColumnNumberToName(n)
}
