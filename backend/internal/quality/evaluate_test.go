package quality

import (
	"fmt"
	"math"
	"reflect"
	"testing"
	"time"
)

// Этап 1.1 §11: чистые тесты движка качества. Все фикстуры детерминированы
// (никаких случайных текстов/seed'ов).

func f(v float64) *float64 { return &v }
func sp(v string) *string  { return &v }

// cleanSnapshot — полностью корректный тендер: 1 позиция, 2 согласованные
// строки (раб + мат-ребёнок), рассчитан, ревизии совпадают, derived сходится.
func cleanSnapshot() *Snapshot {
	// раб: qty10 × rate100 = 1000; мат-ребёнок qty2 × rate50 × cons1 = 100.
	items := []SnapshotItem{
		{
			ID: "item-w", ClientPositionID: "pos-1", BoqItemType: "раб",
			NameID: sp("wn-1"), Description: sp("Кладка стен"), UnitCode: sp("м2"),
			Quantity: f(10), UnitRate: f(100), CurrencyType: "RUB",
			DetailCostCategoryID: sp("dcc-1"),
			StoredTotalAmount:    f(1000),
		},
		{
			ID: "item-m", ClientPositionID: "pos-1", BoqItemType: "мат",
			NameID: sp("mn-1"), Description: sp("Кирпич М150"), UnitCode: sp("шт"),
			Quantity: f(2), UnitRate: f(50), CurrencyType: "RUB",
			ConsumptionCoefficient: f(1), ParentWorkItemID: sp("item-w"),
			DetailCostCategoryID: sp("dcc-1"),
			StoredTotalAmount:    f(100),
		},
	}
	return &Snapshot{
		Tender: SnapshotTender{
			ID:                           "tender-1",
			USDRate:                      f(90),
			CachedGrandTotal:             "0.00",
			FinancialApproved:            false,
			FinancialInputRevision:       5,
			FinancialCalculationRevision: 5,
			FinancialCalculationStatus:   "calculated",
		},
		Positions: []SnapshotPosition{{
			ID: "pos-1", PositionNumber: 1, WorkName: "Секция 1",
			TotalMaterial: 100, TotalWorks: 1000, SortIndex: 0,
		}},
		Items: items,
		Insurance: SnapshotInsurance{
			CommercialMaterialTotalText: "0", CommercialWorkTotalText: "0",
			JudicialPct: "0", TotalPct: "0",
			AptPriceM2: "0", AptArea: "0", ParkingPriceM2: "0", ParkingArea: "0",
			StoragePriceM2: "0", StorageArea: "0",
		},
		GeneratedAt: "2026-07-14T00:00:00Z",
	}
}

func countBySeverity(r *Report) (b, w, i int) {
	return r.Summary.Blockers, r.Summary.Warnings, r.Summary.Information
}

func findIssue(r *Report, code string) *Issue {
	for i := range r.Issues {
		if r.Issues[i].Code == code {
			return &r.Issues[i]
		}
	}
	return nil
}

// §11.1 — полностью корректный тендер.
func TestQuality_CleanTender(t *testing.T) {
	r := Evaluate(cleanSnapshot())
	b, w, _ := countBySeverity(r)
	if b != 0 || w != 0 {
		t.Fatalf("clean tender: blockers=%d warnings=%d, issues=%+v", b, w, r.Issues)
	}
	if r.Summary.CalculationCompletenessPercent != 100 || r.Summary.ReviewCompletenessPercent != 100 {
		t.Fatalf("completeness: %v/%v, want 100/100",
			r.Summary.CalculationCompletenessPercent, r.Summary.ReviewCompletenessPercent)
	}
}

// §11.2 — stale → ОДНА tender-level blocker issue (не по строкам).
func TestQuality_StaleCalculation(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.FinancialCalculationStatus = "stale"
	s.Tender.FinancialCalculationRevision = 4
	r := Evaluate(s)
	is := findIssue(r, "CALCULATION_STALE")
	if is == nil || is.Severity != SeverityBlocker || is.EntityType != "tender" {
		t.Fatalf("want tender-level CALCULATION_STALE blocker, got %+v", r.Issues)
	}
	n := 0
	for _, i := range r.Issues {
		if i.Category == CategoryCalculationState {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("calculation-state issues = %d, want exactly 1 aggregated", n)
	}
}

// §11.3 — failed: blocker с безопасным сообщением (код, не stack).
func TestQuality_FailedCalculation(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.FinancialCalculationStatus = "failed"
	s.Tender.FinancialCalculationRevision = 4
	s.Tender.FinancialCalculationError = sp("MISSING_FX_RATE")
	r := Evaluate(s)
	is := findIssue(r, "CALCULATION_FAILED")
	if is == nil || is.Severity != SeverityBlocker {
		t.Fatal("want CALCULATION_FAILED blocker")
	}
	if is.Message == "" || len(is.Message) > 300 {
		t.Fatalf("unsafe/empty message: %q", is.Message)
	}
}

// §11.4 — calculated + revision mismatch → blocker.
func TestQuality_RevisionMismatch(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.FinancialCalculationRevision = 3
	r := Evaluate(s)
	if findIssue(r, "CALCULATION_REVISION_MISMATCH") == nil {
		t.Fatalf("want CALCULATION_REVISION_MISMATCH, got %+v", r.Issues)
	}
}

// §11.5/6 — FX: одна агрегированная issue; с курсом — отсутствует.
func TestQuality_FxAggregated(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.USDRate = nil
	s.Items[0].CurrencyType = "USD"
	s.Items[1].CurrencyType = "USD"
	// при отсутствии курса derived сравнение строк невозможно — строки
	// остаются с прежними stored (state остаётся calculated: сценарий
	// повреждённых данных).
	r := Evaluate(s)
	var fx []Issue
	for _, i := range r.Issues {
		if i.Code == "FX_RATE_MISSING" {
			fx = append(fx, i)
		}
	}
	if len(fx) != 1 {
		t.Fatalf("FX issues = %d, want exactly 1 aggregated", len(fx))
	}
	if fx[0].AffectedCount != 2 || len(fx[0].AffectedItemIDs) != 2 {
		t.Fatalf("affected = %+v", fx[0])
	}

	// с курсом issue нет
	s2 := cleanSnapshot()
	s2.Items[0].CurrencyType = "USD"
	s2.Items[0].StoredTotalAmount = f(10 * 100 * 90)
	s2.Positions[0].TotalWorks = 90000
	r2 := Evaluate(s2)
	if findIssue(r2, "FX_RATE_MISSING") != nil {
		t.Fatal("USD with rate must not raise FX_RATE_MISSING")
	}
}

// §11.7-10 — parent integrity.
func TestQuality_ParentChecks(t *testing.T) {
	// 7. valid parent → нет issue (cleanSnapshot уже с ребёнком)
	if is := findIssue(Evaluate(cleanSnapshot()), "PARENT_NOT_FOUND"); is != nil {
		t.Fatal("clean parent flagged")
	}
	// 8. non-work parent
	s := cleanSnapshot()
	s.Items[0].BoqItemType = "мат" // родитель стал материалом
	s.Items[0].StoredTotalAmount = f(1000)
	s.Positions[0].TotalMaterial = 1100
	s.Positions[0].TotalWorks = 0
	r := Evaluate(s)
	if findIssue(r, "PARENT_NOT_WORK_ITEM") == nil {
		t.Fatalf("want PARENT_NOT_WORK_ITEM, got %+v", r.Issues)
	}
	// 9a. missing (чужой тендер/удалён)
	s = cleanSnapshot()
	s.Items[1].ParentWorkItemID = sp("alien-id")
	if findIssue(Evaluate(s), "PARENT_NOT_FOUND") == nil {
		t.Fatal("want PARENT_NOT_FOUND")
	}
	// 9b. cross-position
	s = cleanSnapshot()
	s.Positions = append(s.Positions, SnapshotPosition{ID: "pos-2", PositionNumber: 2, SortIndex: 1})
	s.Items[0].ClientPositionID = "pos-2"
	s.Positions[0].TotalWorks = 0
	s.Positions = []SnapshotPosition{
		{ID: "pos-1", PositionNumber: 1, SortIndex: 0, TotalMaterial: 100},
		{ID: "pos-2", PositionNumber: 2, SortIndex: 1, TotalWorks: 1000},
	}
	if findIssue(Evaluate(s), "PARENT_CROSS_POSITION") == nil {
		t.Fatal("want PARENT_CROSS_POSITION")
	}
	// 10. self-parent
	s = cleanSnapshot()
	s.Items[1].ParentWorkItemID = sp("item-m")
	if findIssue(Evaluate(s), "PARENT_SELF_REFERENCE") == nil {
		t.Fatal("want PARENT_SELF_REFERENCE")
	}
}

// §11.11 — redistribution requires recalculation (revision marker).
func TestQuality_RedistributionStale(t *testing.T) {
	s := cleanSnapshot()
	rev := int64(3)
	s.Redistribution = SnapshotRedistribution{
		Configured: true, SchemaVersion: 2, CalculationSource: "server",
		FinancialInputRevision: &rev, RowCount: 5,
	}
	r := Evaluate(s)
	if findIssue(r, "REDISTRIBUTION_INPUT_REVISION_CHANGED") == nil {
		t.Fatalf("want REDISTRIBUTION_INPUT_REVISION_CHANGED, got %+v", r.Issues)
	}
	// актуальный снапшот → нет issue
	rev2 := int64(5)
	s.Redistribution.FinancialInputRevision = &rev2
	if findIssue(Evaluate(s), "REDISTRIBUTION_INPUT_REVISION_CHANGED") != nil {
		t.Fatal("current snapshot flagged")
	}
	// legacy
	s.Redistribution.SchemaVersion = 1
	if findIssue(Evaluate(s), "REDISTRIBUTION_LEGACY_SNAPSHOT") == nil {
		t.Fatal("want REDISTRIBUTION_LEGACY_SNAPSHOT")
	}
}

// §11.12 — approved + stale → blocker.
func TestQuality_ApprovedOnStale(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.FinancialApproved = true
	s.Tender.FinancialCalculationStatus = "stale"
	s.Tender.FinancialCalculationRevision = 4
	r := Evaluate(s)
	if findIssue(r, "APPROVAL_ON_STALE_CALCULATION") == nil {
		t.Fatalf("want APPROVAL_ON_STALE_CALCULATION, got %+v", r.Issues)
	}
	// approved + current → нет issue
	s2 := cleanSnapshot()
	s2.Tender.FinancialApproved = true
	if findIssue(Evaluate(s2), "APPROVAL_ON_STALE_CALCULATION") != nil {
		t.Fatal("current approved flagged")
	}
}

// §11.13 — stored total mismatch (только при current calculated).
func TestQuality_BoqTotalMismatch(t *testing.T) {
	s := cleanSnapshot()
	s.Items[0].StoredTotalAmount = f(999) // расчёт даёт 1000
	s.Positions[0].TotalWorks = 999
	r := Evaluate(s)
	is := findIssue(r, "BOQ_TOTAL_AMOUNT_MISMATCH")
	if is == nil || is.EntityID != "item-w" {
		t.Fatalf("want BOQ_TOTAL_AMOUNT_MISMATCH on item-w, got %+v", r.Issues)
	}
}

// §11.14 — position totals mismatch.
func TestQuality_PositionTotalsMismatch(t *testing.T) {
	s := cleanSnapshot()
	s.Positions[0].TotalWorks = 500 // строки дают 1000
	r := Evaluate(s)
	if findIssue(r, "POSITION_TOTALS_MISMATCH") == nil {
		t.Fatalf("want POSITION_TOTALS_MISMATCH, got %+v", r.Issues)
	}
}

// §11.15 — cached grand total mismatch (decimal-ядро).
func TestQuality_CachedGrandTotalMismatch(t *testing.T) {
	s := cleanSnapshot()
	s.Insurance.CommercialMaterialTotalText = "100.00"
	s.Insurance.CommercialWorkTotalText = "200.00"
	s.Tender.CachedGrandTotal = "299.99" // ядро даёт 300.00
	r := Evaluate(s)
	if findIssue(r, "CACHED_GRAND_TOTAL_MISMATCH") == nil {
		t.Fatalf("want CACHED_GRAND_TOTAL_MISMATCH, got %+v", r.Issues)
	}
	s.Tender.CachedGrandTotal = "300.00"
	if findIssue(Evaluate(s), "CACHED_GRAND_TOTAL_MISMATCH") != nil {
		t.Fatal("matching grand total flagged")
	}
}

// §11.16/17 — zero quantity/rate warnings.
func TestQuality_ZeroInputs(t *testing.T) {
	s := cleanSnapshot()
	s.Items[1].Quantity = f(0)
	s.Items[1].UnitRate = nil
	s.Items[1].StoredTotalAmount = f(0)
	s.Positions[0].TotalMaterial = 0
	r := Evaluate(s)
	q := findIssue(r, "QUANTITY_ZERO")
	u := findIssue(r, "UNIT_RATE_ZERO")
	if q == nil || u == nil || q.Severity != SeverityWarning || u.Severity != SeverityWarning {
		t.Fatalf("want zero-input warnings, got %+v", r.Issues)
	}
}

// §11.18/19 — completeness: применимые поля влияют, неприменимые — нет.
func TestQuality_Completeness(t *testing.T) {
	s := cleanSnapshot()
	// пустое quantity одной из двух строк: calc-поля 2×2=4, заполнено 3 → 75%
	s.Items[1].Quantity = nil
	s.Items[1].StoredTotalAmount = f(0)
	s.Positions[0].TotalMaterial = 0
	r := Evaluate(s)
	if r.Summary.CalculationCompletenessPercent != 75 {
		t.Fatalf("calc completeness = %v, want 75", r.Summary.CalculationCompletenessPercent)
	}
	// §19: RUB-строки не добавляют «курс» в знаменатель: добавление RUB-строки
	// с заполненными полями возвращает пропорцию 5/6.
	s.Items = append(s.Items, SnapshotItem{
		ID: "item-x", ClientPositionID: "pos-1", BoqItemType: "раб",
		NameID: sp("wn-2"), Description: sp("x"), UnitCode: sp("м"),
		Quantity: f(1), UnitRate: f(1), CurrencyType: "RUB",
		DetailCostCategoryID: sp("dcc-1"), StoredTotalAmount: f(1),
	})
	s.Positions[0].TotalWorks = 1001
	r = Evaluate(s)
	want := round1(5.0 / 6.0 * 100)
	if r.Summary.CalculationCompletenessPercent != want {
		t.Fatalf("calc completeness = %v, want %v", r.Summary.CalculationCompletenessPercent, want)
	}
}

// §11.20 — exact duplicate group → одна warning.
func TestQuality_ExactDuplicates(t *testing.T) {
	s := cleanSnapshot()
	dup := s.Items[1]
	dup.ID = "item-m2"
	dup.Description = sp("  кирпич   М150 ") // нормализация: тот же текст
	s.Items = append(s.Items, dup)
	s.Positions[0].TotalMaterial = 200
	r := Evaluate(s)
	is := findIssue(r, "EXACT_DUPLICATE_GROUP")
	if is == nil || is.Severity != SeverityWarning {
		t.Fatalf("want one duplicate warning, got %+v", r.Issues)
	}
	if is.AffectedCount != 2 || is.EntityID != "item-m" {
		t.Fatalf("group meta wrong: %+v", is)
	}
	if is.GroupTotalAmount == nil || *is.GroupTotalAmount != 200 {
		t.Fatalf("group total = %v, want 200", is.GroupTotalAmount)
	}
}

// §11.21 — похожие, но разные марки/размеры дублями НЕ считаются.
func TestQuality_SimilarNotDuplicates(t *testing.T) {
	s := cleanSnapshot()
	other := s.Items[1]
	other.ID = "item-m2"
	other.Description = sp("Кирпич М200") // другая марка — цифры не удаляются
	s.Items = append(s.Items, other)
	s.Positions[0].TotalMaterial = 200
	if findIssue(Evaluate(s), "EXACT_DUPLICATE_GROUP") != nil {
		t.Fatal("different brand flagged as duplicate")
	}
}

// §11.22 — стабильный ID.
func TestQuality_StableIssueID(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.FinancialCalculationStatus = "stale"
	id1 := findIssue(Evaluate(s), "CALCULATION_STALE").ID
	id2 := findIssue(Evaluate(cloneSnapshot(s)), "CALCULATION_STALE").ID
	if id1 == "" || id1 != id2 {
		t.Fatalf("issue id not stable: %q vs %q", id1, id2)
	}
}

// §11.23/24 — стабильный порядок; перестановка входа не меняет результат.
func TestQuality_DeterministicOrdering(t *testing.T) {
	s := messySnapshot()
	r1 := Evaluate(s)

	s2 := cloneSnapshot(s)
	// переставляем строки и позиции
	s2.Items[0], s2.Items[len(s2.Items)-1] = s2.Items[len(s2.Items)-1], s2.Items[0]
	s2.Positions[0], s2.Positions[len(s2.Positions)-1] = s2.Positions[len(s2.Positions)-1], s2.Positions[0]
	// SortIndex остаётся прежним у тех же позиций — порядок определяет он.
	r2 := Evaluate(s2)

	if !reflect.DeepEqual(r1.Issues, r2.Issues) {
		t.Fatalf("issue list depends on input order:\n%v\nvs\n%v", ids(r1), ids(r2))
	}
	// порядок severity невозрастающий
	rank := map[string]int{SeverityBlocker: 0, SeverityWarning: 1, SeverityInformation: 2}
	for i := 1; i < len(r1.Issues); i++ {
		if rank[r1.Issues[i-1].Severity] > rank[r1.Issues[i].Severity] {
			t.Fatalf("severity ordering broken at %d", i)
		}
	}
}

func ids(r *Report) []string {
	out := make([]string, len(r.Issues))
	for i, is := range r.Issues {
		out[i] = is.Code + ":" + is.EntityID
	}
	return out
}

// messySnapshot — смесь проблем всех уровней для ordering-тестов.
func messySnapshot() *Snapshot {
	s := cleanSnapshot()
	s.Tender.FinancialCalculationStatus = "stale"
	s.Tender.FinancialCalculationRevision = 4
	s.Items[1].UnitCode = nil
	s.Items[1].Description = nil
	s.Items = append(s.Items, SnapshotItem{
		ID: "item-z", ClientPositionID: "pos-1", BoqItemType: "мат",
		NameID: sp("mn-9"), Quantity: f(0), CurrencyType: "RUB",
	})
	return s
}

func cloneSnapshot(s *Snapshot) *Snapshot {
	c := *s
	c.Positions = append([]SnapshotPosition(nil), s.Positions...)
	c.Items = append([]SnapshotItem(nil), s.Items...)
	return &c
}

// §11.25 — тысячи строк без квадратичного поведения.
func TestQuality_ThousandsOfRowsLinear(t *testing.T) {
	build := func(n int) *Snapshot {
		s := cleanSnapshot()
		s.Items = make([]SnapshotItem, 0, n)
		for i := 0; i < n; i++ {
			s.Items = append(s.Items, SnapshotItem{
				ID:               fmt.Sprintf("item-%06d", i),
				ClientPositionID: "pos-1", BoqItemType: "раб",
				NameID: sp("wn-1"), Description: sp(fmt.Sprintf("Работа %d", i)),
				UnitCode: sp("м2"), Quantity: f(1), UnitRate: f(float64(i + 1)),
				CurrencyType: "RUB", DetailCostCategoryID: sp("dcc-1"),
				StoredTotalAmount: f(float64(i + 1)),
			})
		}
		s.Positions[0].TotalWorks = float64(n*(n+1)) / 2
		s.Positions[0].TotalMaterial = 0
		return s
	}
	run := func(n int) time.Duration {
		s := build(n)
		start := time.Now()
		Evaluate(s)
		return time.Since(start)
	}
	d5k := run(5000)
	if d5k > 2*time.Second {
		t.Fatalf("5k rows took %v (budget 2s)", d5k)
	}
	// грубая линейность: 10k не более ~6× времени 5k (квадрат дал бы ~4× на
	// чистой математике + константы; порог с запасом ловит O(n²) по issues)
	d10k := run(10000)
	if d10k > 6*d5k+50*time.Millisecond {
		t.Fatalf("quadratic smell: 5k=%v 10k=%v", d5k, d10k)
	}
}

// §11.26 — нет NaN/Inf в completeness и summary.
func TestQuality_NoNaN(t *testing.T) {
	empty := &Snapshot{
		Tender: SnapshotTender{ID: "t", FinancialCalculationStatus: "calculated",
			CachedGrandTotal: "0.00"},
		Insurance: SnapshotInsurance{
			CommercialMaterialTotalText: "0", CommercialWorkTotalText: "0",
			JudicialPct: "0", TotalPct: "0", AptPriceM2: "0", AptArea: "0",
			ParkingPriceM2: "0", ParkingArea: "0", StoragePriceM2: "0", StorageArea: "0",
		},
		GeneratedAt: "2026-07-14T00:00:00Z",
	}
	r := Evaluate(empty)
	for _, v := range []float64{r.Summary.CalculationCompletenessPercent, r.Summary.ReviewCompletenessPercent} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			t.Fatalf("NaN/Inf in completeness: %v", v)
		}
	}
	if r.Summary.CalculationCompletenessPercent != 100 {
		t.Fatalf("empty tender completeness = %v, want 100", r.Summary.CalculationCompletenessPercent)
	}
}

// §11.27 — stale не порождает тысячи derived-mismatch issues.
func TestQuality_StaleSkipsDerivedChecks(t *testing.T) {
	s := cleanSnapshot()
	s.Tender.FinancialCalculationStatus = "stale"
	s.Tender.FinancialCalculationRevision = 4
	s.Items[0].StoredTotalAmount = f(1) // расхождение ожидаемо при stale
	s.Positions[0].TotalWorks = 777
	s.Tender.CachedGrandTotal = "123.45"
	r := Evaluate(s)
	for _, code := range []string{"BOQ_TOTAL_AMOUNT_MISMATCH", "POSITION_TOTALS_MISMATCH", "CACHED_GRAND_TOTAL_MISMATCH"} {
		if findIssue(r, code) != nil {
			t.Fatalf("derived check %s fired during stale", code)
		}
	}
	if findIssue(r, "CALCULATION_STALE") == nil {
		t.Fatal("stale state issue missing")
	}
}
