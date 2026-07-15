package actionplan

import (
	"fmt"
	"sort"
	"strings"

	pb "github.com/su10/hubtender/backend/internal/analytics/pricebenchmark"
	ps "github.com/su10/hubtender/backend/internal/analytics/pricesource"
	"github.com/su10/hubtender/backend/internal/quality"
)

// Inputs — нормализованные результаты трёх ГОТОВЫХ движков + метаданные строк.
// Benchmark == nil означает «расчёт не актуален» (component
// calculation_not_ready, rule A) — старые outliers НЕ выдаются за текущие.
type Inputs struct {
	TenderID     string
	InputRev     int64
	CalcRev      int64
	CalcStatus   string
	GeneratedAt  string
	AsOfDate     string
	PeriodMonths int
	MaxAgeDays   int
	Quality      *quality.Report
	Benchmark    *pb.Report
	Source       *ps.Report
	Items        []ItemInfo
}

// warning-коды качества с повышенным приоритетом (§5.A).
var qualityHighWarnings = map[string]bool{
	"QUANTITY_ZERO":         true,
	"UNIT_RATE_ZERO":        true,
	"EXACT_DUPLICATE_GROUP": true,
}

// Порядок blocking-категорий (§6.2).
var blockingCategoryOrder = map[string]int{
	quality.CategoryCalculationState:   0,
	quality.CategoryCurrency:           1,
	quality.CategoryRelations:          2,
	quality.CategoryDerivedConsistency: 3,
	quality.CategoryRedistribution:     4,
	quality.CategoryApproval:           5,
}

var priorityRank = map[string]int{
	PriorityBlocking: 0, PriorityHigh: 1, PriorityNormal: 2, PriorityLow: 3,
}

var sourceRank = map[string]int{
	SourceQuality: 0, SourcePriceSource: 1, SourcePriceBenchmark: 2,
}

func priorityReason(priority string) string {
	switch priority {
	case PriorityBlocking:
		return "Проблема блокирует готовность финансового расчёта."
	case PriorityHigh:
		return "Существенно влияет на корректность и проверяемость сумм расчёта."
	case PriorityNormal:
		return "Требует проверки для полноты и сопоставимости расчёта."
	default:
		return "Улучшение качества данных; не влияет на суммы напрямую."
	}
}

func sptr(s string) *string   { return &s }
func fptr(v float64) *float64 { return &v }

// Compose — детерминированная композиция. Одинаковые входы → одинаковый
// результат (кроме generated_at, который приходит из снапшота).
func Compose(in Inputs) *Report {
	amountAvailable := in.CalcStatus == "calculated" && in.CalcRev == in.InputRev

	itemPos := make(map[string]string, len(in.Items))
	itemSort := make(map[string]int, len(in.Items))
	itemAmount := make(map[string]float64, len(in.Items))
	for _, it := range in.Items {
		itemPos[it.ID] = it.ClientPositionID
		itemSort[it.ID] = it.SortIndex
		if amountAvailable && it.TotalAmount != nil {
			itemAmount[it.ID] = *it.TotalAmount
		}
	}

	var actions []*Action
	// merge rule B: quality identity-действия по (itemID, field) для слияния
	// с benchmark NOT_ELIGIBLE той же причины.
	identityByItemField := map[string]*Action{}

	// ── A. Quality → actions ──────────────────────────────────────────────────
	if in.Quality != nil {
		for i := range in.Quality.Issues {
			is := &in.Quality.Issues[i]
			var prio string
			switch is.Severity {
			case quality.SeverityBlocker:
				prio = PriorityBlocking
			case quality.SeverityWarning:
				prio = PriorityNormal
				if qualityHighWarnings[is.Code] {
					prio = PriorityHigh
				}
			default:
				prio = PriorityLow
			}

			a := &Action{
				ID:                "quality:" + is.ID,
				Priority:          prio,
				Source:            SourceQuality,
				Sources:           []string{SourceQuality},
				Code:              is.Code,
				Category:          is.Category,
				EntityType:        is.EntityType,
				EntityID:          is.EntityID,
				Field:             is.Field,
				Title:             is.Title,
				Reason:            is.Message,
				RecommendedAction: is.FixHint,
				PriorityReason:    priorityReason(prio),
				SourceNavigation:  SourceNavigation{AnalyticsPage: SourceQuality},
				Evidence:          map[string]string{},
			}
			if is.ClientPositionID != "" {
				a.ClientPositionID = sptr(is.ClientPositionID)
			}
			switch {
			case len(is.AffectedItemIDs) > 0:
				a.BoqItemIDs = append(a.BoqItemIDs, is.AffectedItemIDs...)
			case is.EntityType == "boq_item":
				a.BoqItemIDs = []string{is.EntityID}
			}
			a.AffectedItemsCount = is.AffectedCount
			if a.AffectedItemsCount == 0 {
				a.AffectedItemsCount = len(a.BoqItemIDs)
			}
			if is.CurrentValue != nil {
				a.Evidence["current_value"] = *is.CurrentValue
			}
			if is.GroupTotalAmount != nil {
				a.Evidence["group_total_amount"] = fmt.Sprintf("%.2f", *is.GroupTotalAmount)
			}
			a.Navigation = qualityNavigation(is)

			if is.EntityType == "boq_item" && (is.Code == "UNIT_CODE_MISSING") {
				identityByItemField[is.EntityID+"|unit_code"] = a
			}
			actions = append(actions, a)
		}
	}

	// ── B. Price benchmark → actions (только при доступном компоненте) ───────
	priceWithinRange, priceInsufficient := 0, 0
	if in.Benchmark != nil {
		priceWithinRange = in.Benchmark.Summary.WithinRange
		priceInsufficient = in.Benchmark.Summary.InsufficientHistory
		for i := range in.Benchmark.Items {
			ib := &in.Benchmark.Items[i]
			switch ib.Status {
			case pb.StatusHighOutlier, pb.StatusLowOutlier:
				a := benchmarkOutlierAction(ib)
				actions = append(actions, a)
			case pb.StatusNotEligible:
				// Identity-причина → action; метрика (qty/total ≤ 0) уже
				// покрыта quality QUANTITY_ZERO/UNIT_RATE_ZERO — не дублируем.
				if !strings.Contains(ib.NotEligibleReason, "INSUFFICIENT_IDENTITY") {
					continue
				}
				field := identityField(ib.NotEligibleReason)
				if ex, ok := identityByItemField[ib.BoqItemID+"|"+field]; ok {
					// merge rule B: одна строка, та же причина → один action.
					ex.Sources = append(ex.Sources, SourcePriceBenchmark)
					ex.ID = "merged:ITEM_IDENTITY_MISSING:" + ib.BoqItemID + ":" + field
					ex.Reason = strings.TrimSuffix(ex.Reason, ".") +
						". Строка также не участвует в историческом ценовом сравнении."
					continue
				}
				actions = append(actions, benchmarkIdentityAction(ib, field))
			}
		}
	}

	// ── C. Price source → actions ─────────────────────────────────────────────
	sourcesFresh, sourcesNotApplicable := 0, 0
	if in.Source != nil {
		sourcesFresh = in.Source.Summary.FreshItems
		for i := range in.Source.Items {
			row := &in.Source.Items[i]
			switch row.Status {
			case ps.StatusFresh:
				continue
			case ps.StatusNotApplicable:
				sourcesNotApplicable++
				continue
			}
			actions = append(actions, sourceAction(row))
		}
	}

	// ── Impact per action (union внутри action, §7) ───────────────────────────
	for _, a := range actions {
		applyImpact(a, itemAmount, amountAvailable)
		applyPosSort(a, itemPos, itemSort)
	}

	sortActions(actions)
	for i, a := range actions {
		a.Rank = i + 1
	}

	out := make([]Action, len(actions))
	for i, a := range actions {
		out[i] = *a
	}

	rep := &Report{
		TenderID:                     in.TenderID,
		FinancialInputRevision:       in.InputRev,
		FinancialCalculationRevision: in.CalcRev,
		FinancialCalculationStatus:   in.CalcStatus,
		GeneratedAt:                  in.GeneratedAt,
		AsOfDate:                     in.AsOfDate,
		BenchmarkPeriodMonths:        in.PeriodMonths,
		SourceMaxAgeDays:             in.MaxAgeDays,
		Actions:                      out,
		ItemAmounts:                  itemAmount,
		AmountAvailable:              amountAvailable,
	}
	rep.Components = composeComponents(in)
	rep.Summary = Summarize(out, itemAmount, amountAvailable)
	rep.Summary.PriceItemsWithinRange = priceWithinRange
	rep.Summary.PriceItemsInsufficientHistory = priceInsufficient
	rep.Summary.PriceSourcesFresh = sourcesFresh
	rep.Summary.PriceSourcesNotApplicable = sourcesNotApplicable
	return rep
}

// qualityNavigation — typed-навигация quality-issue (§13).
func qualityNavigation(is *quality.Issue) Navigation {
	nav := Navigation{Type: NavBoqItem}
	if is.ClientPositionID != "" {
		nav.PositionID = sptr(is.ClientPositionID)
	}
	if is.EntityType == "boq_item" {
		nav.ItemID = sptr(is.EntityID)
	} else if len(is.AffectedItemIDs) > 0 {
		nav.ItemID = sptr(is.AffectedItemIDs[0])
	}
	nav.Field = is.Field

	if is.Code == "EXACT_DUPLICATE_GROUP" {
		nav.Type = NavDuplicateGroup
		return nav
	}
	if nav.ItemID != nil || is.EntityType == "client_position" {
		return nav
	}
	switch is.Category {
	case quality.CategoryCurrency:
		return Navigation{Type: NavTenderCurrency, Field: is.Field}
	case quality.CategoryRedistribution:
		return Navigation{Type: NavRedistribution}
	case quality.CategoryApproval, quality.CategoryCalculationState, quality.CategoryDerivedConsistency:
		return Navigation{Type: NavFinancialIndicators}
	default:
		return Navigation{Type: NavAnalyticsPage}
	}
}

func benchmarkOutlierAction(ib *pb.ItemBenchmark) *Action {
	dir := "выше"
	if ib.Status == pb.StatusLowOutlier {
		dir = "ниже"
	}
	a := &Action{
		ID:                "price_benchmark:" + ib.BoqItemID + ":" + ib.Status,
		Priority:          PriorityHigh,
		Source:            SourcePriceBenchmark,
		Sources:           []string{SourcePriceBenchmark},
		Code:              ib.Status,
		Category:          "PRICE_DEVIATION",
		EntityType:        "boq_item",
		EntityID:          ib.BoqItemID,
		ClientPositionID:  sptr(ib.ClientPositionID),
		BoqItemIDs:        []string{ib.BoqItemID},
		Field:             "unit_rate",
		Title:             "Проверьте цену: " + dir + " исторического диапазона",
		Reason:            ib.Message,
		RecommendedAction: ib.ReviewHint,
		PriorityReason:    priorityReason(PriorityHigh),
		Navigation: Navigation{
			Type: NavBoqItem, PositionID: sptr(ib.ClientPositionID),
			ItemID: sptr(ib.BoqItemID), Field: "unit_rate",
		},
		SourceNavigation:   SourceNavigation{AnalyticsPage: SourcePriceBenchmark, ItemID: sptr(ib.BoqItemID)},
		AffectedItemsCount: 1,
		Evidence: map[string]string{
			"current_unit_cost":        fmt.Sprintf("%.2f", ib.CurrentUnitCost),
			"historical_tenders_count": fmt.Sprintf("%d", ib.HistoricalTendersCount),
		},
	}
	if ib.Median != nil {
		a.Evidence["median"] = fmt.Sprintf("%.2f", *ib.Median)
	}
	if ib.DeviationFromMedianPercent != nil {
		a.Evidence["deviation_percent"] = fmt.Sprintf("%.2f", *ib.DeviationFromMedianPercent)
	}
	return a
}

// identityField — поле идентичности из детерминированной причины движка.
func identityField(reason string) string {
	if strings.Contains(reason, "единица измерения") {
		return "unit_code"
	}
	if strings.Contains(reason, "номенклатурной привязки") {
		return "nomenclature"
	}
	return "identity"
}

func benchmarkIdentityAction(ib *pb.ItemBenchmark, field string) *Action {
	title := "Привяжите строку к номенклатуре"
	hint := "Выберите материал/работу из библиотеки номенклатур — без точной привязки строку нельзя сравнить с историей."
	navField := "description"
	if field == "unit_code" {
		title = "Укажите единицу измерения"
		hint = "Без единицы измерения строка не участвует в ценовом сравнении."
		navField = "unit_code"
	}
	return &Action{
		ID:                "price_benchmark:" + ib.BoqItemID + ":NOT_ELIGIBLE:" + field,
		Priority:          PriorityNormal,
		Source:            SourcePriceBenchmark,
		Sources:           []string{SourcePriceBenchmark},
		Code:              "BENCHMARK_IDENTITY_MISSING",
		Category:          "PRICE_DEVIATION",
		EntityType:        "boq_item",
		EntityID:          ib.BoqItemID,
		ClientPositionID:  sptr(ib.ClientPositionID),
		BoqItemIDs:        []string{ib.BoqItemID},
		Field:             navField,
		Title:             title,
		Reason:            "Строка не участвует в историческом ценовом сравнении: " + strings.TrimPrefix(ib.NotEligibleReason, "INSUFFICIENT_IDENTITY: ") + ".",
		RecommendedAction: hint,
		PriorityReason:    priorityReason(PriorityNormal),
		Navigation: Navigation{
			Type: NavBoqItem, PositionID: sptr(ib.ClientPositionID),
			ItemID: sptr(ib.BoqItemID), Field: navField,
		},
		SourceNavigation:   SourceNavigation{AnalyticsPage: SourcePriceBenchmark, ItemID: sptr(ib.BoqItemID)},
		AffectedItemsCount: 1,
	}
}

// sourceStatusPlan — mapping статусов источников (§5.C).
var sourceStatusPlan = map[string]struct {
	Priority string
	Title    string
	Hint     string
	Field    string
}{
	ps.StatusSourceMissing: {PriorityHigh, "Укажите источник цены",
		"Добавьте ссылку на КП/прайс или пометку об источнике в поле «Источник».", "quote_link"},
	ps.StatusExpired: {PriorityHigh, "Срок действия предложения истёк",
		"Запросите актуальное предложение у поставщика и обновите дату/срок действия.", "quote_valid_until"},
	ps.StatusInvalidSourceDates: {PriorityHigh, "Исправьте даты источника",
		"Проверьте дату цены и срок действия: даты противоречивы или некорректны.", "quote_price_date"},
	ps.StatusStale: {PriorityNormal, "Подтвердите актуальность цены",
		"Цена подтверждена давно — сверьте её с поставщиком и обновите дату цены.", "quote_price_date"},
	ps.StatusPriceDateMissing: {PriorityNormal, "Укажите дату цены",
		"Заполните дату подтверждения цены поставщиком (не дату загрузки файла).", "quote_price_date"},
	ps.StatusExpiringSoon: {PriorityLow, "Срок действия скоро истечёт",
		"Заранее запросите продление предложения у поставщика.", "quote_valid_until"},
}

func sourceAction(row *ps.Row) *Action {
	plan, ok := sourceStatusPlan[row.Status]
	if !ok { // неизвестный статус: не теряем, показываем normal
		plan.Priority, plan.Title, plan.Hint, plan.Field = PriorityNormal, "Проверьте источник цены", row.Message, "quote_link"
	}
	a := &Action{
		ID:                "price_source:" + row.BoqItemID + ":" + row.Status,
		Priority:          plan.Priority,
		Source:            SourcePriceSource,
		Sources:           []string{SourcePriceSource},
		Code:              row.Status,
		Category:          "PRICE_SOURCE",
		EntityType:        "boq_item",
		EntityID:          row.BoqItemID,
		ClientPositionID:  sptr(row.ClientPositionID),
		BoqItemIDs:        []string{row.BoqItemID},
		Field:             plan.Field,
		Title:             plan.Title,
		Reason:            row.Message,
		RecommendedAction: plan.Hint,
		PriorityReason:    priorityReason(plan.Priority),
		Navigation: Navigation{
			Type: NavBoqItem, PositionID: sptr(row.ClientPositionID),
			ItemID: sptr(row.BoqItemID), Field: plan.Field,
		},
		SourceNavigation:   SourceNavigation{AnalyticsPage: SourcePriceSource, ItemID: sptr(row.BoqItemID)},
		AffectedItemsCount: 1,
		Evidence:           map[string]string{},
	}
	if row.PriceDate != nil {
		a.Evidence["price_date"] = *row.PriceDate
	}
	if row.ValidUntil != nil {
		a.Evidence["valid_until"] = *row.ValidUntil
	}
	if row.AgeDays != nil {
		a.Evidence["age_days"] = fmt.Sprintf("%d", *row.AgeDays)
	}
	if row.SourceLabel != "" {
		a.Evidence["source_label"] = row.SourceLabel
	}
	return a
}

// applyImpact — сумма UNIQUE строк действия (§7); одна строка внутри action
// не считается дважды. Tender-level action без BOQ IDs → unavailable.
func applyImpact(a *Action, itemAmount map[string]float64, amountAvailable bool) {
	a.ImpactAmountStatus = "unavailable"
	if !amountAvailable || len(a.BoqItemIDs) == 0 {
		return
	}
	seen := make(map[string]bool, len(a.BoqItemIDs))
	sum := 0.0
	for _, id := range a.BoqItemIDs {
		if seen[id] {
			continue
		}
		seen[id] = true
		sum += itemAmount[id]
	}
	a.ImpactAmount = fptr(sum)
	a.ImpactAmountStatus = "available"
}

func applyPosSort(a *Action, itemPos map[string]string, itemSort map[string]int) {
	a.posSort = 1 << 30 // tender-level после строчных при прочих равных
	if len(a.BoqItemIDs) > 0 {
		if s, ok := itemSort[a.BoqItemIDs[0]]; ok {
			a.posSort = s
		}
		if a.ClientPositionID == nil {
			if p, ok := itemPos[a.BoqItemIDs[0]]; ok {
				a.ClientPositionID = sptr(p)
			}
		}
	}
}

// sortActions — детерминированный recommended-порядок (§6).
func sortActions(actions []*Action) {
	sort.SliceStable(actions, func(i, j int) bool {
		a, b := actions[i], actions[j]
		if priorityRank[a.Priority] != priorityRank[b.Priority] {
			return priorityRank[a.Priority] < priorityRank[b.Priority]
		}
		if a.Priority == PriorityBlocking {
			ca, cb := blockingCat(a.Category), blockingCat(b.Category)
			if ca != cb {
				return ca < cb
			}
			if a.EntityID != b.EntityID {
				return a.EntityID < b.EntityID
			}
			return a.Code < b.Code
		}
		// impact известен → раньше; по убыванию суммы.
		ia, ib := a.ImpactAmount != nil, b.ImpactAmount != nil
		if ia != ib {
			return ia
		}
		if ia && *a.ImpactAmount != *b.ImpactAmount {
			return *a.ImpactAmount > *b.ImpactAmount
		}
		if a.AffectedItemsCount != b.AffectedItemsCount {
			return a.AffectedItemsCount > b.AffectedItemsCount
		}
		if sourceRank[a.Source] != sourceRank[b.Source] {
			return sourceRank[a.Source] < sourceRank[b.Source]
		}
		if a.posSort != b.posSort {
			return a.posSort < b.posSort
		}
		if a.EntityID != b.EntityID {
			return a.EntityID < b.EntityID
		}
		return a.Code < b.Code
	})
}

func blockingCat(c string) int {
	if v, ok := blockingCategoryOrder[c]; ok {
		return v
	}
	return 6
}

// composeComponents — статусы источников (§9): partial result не скрывается.
func composeComponents(in Inputs) Components {
	c := Components{
		Quality:        Component{Status: ComponentUnavailable},
		PriceBenchmark: Component{Status: ComponentCalculationNotReady, PeriodMonths: in.PeriodMonths},
		PriceSource:    Component{Status: ComponentUnavailable, MaxAgeDays: in.MaxAgeDays},
	}
	if in.Quality != nil {
		c.Quality = Component{Status: ComponentAvailable, ItemsConsidered: in.Quality.Summary.BoqItemsTotal}
	}
	if in.Benchmark != nil {
		c.PriceBenchmark = Component{Status: ComponentAvailable, PeriodMonths: in.PeriodMonths}
		if in.Benchmark.Summary.BenchmarkedItems == 0 && in.Benchmark.Summary.EligibleItems > 0 {
			c.PriceBenchmark.Status = ComponentNoHistory
			c.PriceBenchmark.Note = "Недостаточно согласованной истории для сравнения цен."
		}
	} else {
		c.PriceBenchmark.Note = "Ценовые отклонения не рассчитываются: финансовый расчёт не актуален."
	}
	if in.Source != nil {
		c.PriceSource = Component{Status: ComponentAvailable, MaxAgeDays: in.MaxAgeDays}
	}
	return c
}

// Summarize — сводка по набору действий (§10). Вызывается движком по полному
// набору и handler'ом ПОСЛЕ substantive-фильтров (§11). Union-семантика (§7):
// строка, входящая в несколько действий, в amount_requiring_review попадает
// один раз; tender-level действия без BOQ IDs сумму не добавляют.
func Summarize(actions []Action, itemAmount map[string]float64, amountAvailable bool) Summary {
	s := Summary{
		ActionsBySource:     map[string]int{SourceQuality: 0, SourcePriceBenchmark: 0, SourcePriceSource: 0},
		AmountMetricsStatus: "unavailable",
	}
	itemSet := map[string]bool{}
	posSet := map[string]bool{}
	for i := range actions {
		a := &actions[i]
		s.ActionsTotal++
		switch a.Priority {
		case PriorityBlocking:
			s.BlockingActions++
		case PriorityHigh:
			s.HighActions++
		case PriorityNormal:
			s.NormalActions++
		default:
			s.LowActions++
		}
		for _, src := range a.Sources {
			s.ActionsBySource[src]++
		}
		for _, id := range a.BoqItemIDs {
			itemSet[id] = true
		}
		if a.ClientPositionID != nil && *a.ClientPositionID != "" {
			posSet[*a.ClientPositionID] = true
		}
	}
	s.AffectedBoqItems = len(itemSet)
	s.AffectedPositions = len(posSet)
	if amountAvailable {
		sum := 0.0
		for id := range itemSet {
			sum += itemAmount[id]
		}
		s.AmountMetricsStatus = "available"
		s.AmountRequiringReview = fptr(sum)
	}
	return s
}
