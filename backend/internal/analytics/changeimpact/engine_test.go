package changeimpact

import (
	"fmt"
	"math/rand"
	"testing"
)

// ─── Fixtures ────────────────────────────────────────────────────────────────

func tstate(id string, ver int, approved bool, status string, inputRev, calcRev int64, grand string) TenderState {
	return TenderState{
		ID: id, TenderNumber: "TN-1", Version: ver,
		Approved: approved, CalcStatus: status,
		InputRev: inputRev, CalcRev: calcRev,
		ApprovedAt: fmt.Sprintf("2026-0%d-01T00:00:00Z", ver), CachedGrandTotal: grand,
	}
}

func readyState(id string, ver int, grand string) TenderState {
	return tstate(id, ver, true, "calculated", 5, 5, grand)
}

func pos(id, itemNo, name, unit string, num float64, idx int) Position {
	return Position{ID: id, PositionNumber: num, ItemNo: itemNo, WorkName: name, UnitCode: unit, SortIndex: idx}
}

type itOpt func(*Item)

func withQty(q float64) itOpt      { return func(i *Item) { i.Quantity = &q } }
func withRate(r float64) itOpt     { return func(i *Item) { i.UnitRate = &r } }
func withCur(c string) itOpt       { return func(i *Item) { i.CurrencyType = c } }
func withDesc(d string) itOpt      { return func(i *Item) { i.Description = &d } }
func withParent(p string) itOpt    { return func(i *Item) { i.ParentWorkItemID = &p } }
func withDetail(d string) itOpt    { return func(i *Item) { i.DetailCategoryID = &d } }
func withConsump(v float64) itOpt  { return func(i *Item) { i.ConsumptionCoef = &v } }
func withDelivery(v float64) itOpt { return func(i *Item) { i.DeliveryAmount = &v } }
func withQuote(l, d string) itOpt {
	return func(i *Item) { i.QuoteLink = &l; i.QuotePriceDate = &d }
}
func withNameID(n string) itOpt { return func(i *Item) { i.NameID = &n } }

// item: qty=1 rate=100, direct=100, commercial mat=110 work=0 по умолчанию.
func item(id, posID, nameID string, idx int, direct, mat, work string, opts ...itOpt) Item {
	q, r := 1.0, 100.0
	n := nameID
	u := "м2"
	it := Item{
		ID: id, ClientPositionID: posID, BoqItemType: "раб",
		NameID: &n, UnitCode: &u, CurrencyType: "RUB",
		Quantity: &q, UnitRate: &r,
		TotalAmountText: direct, CommercialMaterialText: mat, CommercialWorkText: work,
		SortIndex: idx,
	}
	for _, o := range opts {
		o(&it)
	}
	return it
}

// version — данные версии; grand = Σ(mat+work) + insurance(=0).
func version(t TenderState, ps []Position, items []Item) VersionData {
	return VersionData{Tender: t, Positions: ps, Items: items}
}

// onePosVersion — версия с одной позицией "01|Работы|м2".
func onePosVersion(tid string, ver int, grand string, items []Item) VersionData {
	return version(readyState(tid, ver, grand),
		[]Position{pos(tid+"-p1", "01", "Работы", "м2", 1, 0)}, items)
}

func compare(cur, base VersionData) *Report {
	return Compare(cur, base, nil, "2026-07-15T00:00:00Z")
}

func diffByID(t *testing.T, r *Report, id string) *ItemDiff {
	t.Helper()
	for i := range r.Items {
		if r.Items[i].ID == id {
			return &r.Items[i]
		}
	}
	t.Fatalf("diff %s not found (%d items)", id, len(r.Items))
	return nil
}

func hasField(fs []FieldChange, field string) bool {
	for _, f := range fs {
		if f.Field == field {
			return true
		}
	}
	return false
}

// ─── §17.1-6: baseline policy ────────────────────────────────────────────────

func TestDefaultPreviousApprovedBaseline(t *testing.T) { // 1
	cur := readyState("T4", 4, "0")
	cands := []TenderState{
		readyState("T1", 1, "0"), readyState("T3", 3, "0"), readyState("T2", 2, "0"),
	}
	if b := PickDefaultBaseline(&cur, cands); b == nil || b.ID != "T3" {
		t.Fatalf("default baseline must be latest earlier approved (T3), got %+v", b)
	}
}

func TestUnapprovedPreviousExcluded(t *testing.T) { // 2
	cur := readyState("T3", 3, "0")
	cands := []TenderState{
		tstate("T2", 2, false, "calculated", 5, 5, "0"), // не согласована
		readyState("T1", 1, "0"),
	}
	if b := PickDefaultBaseline(&cur, cands); b == nil || b.ID != "T1" {
		t.Fatalf("unapproved must be skipped, want T1, got %+v", b)
	}
}

func TestStaleBaselineExcluded(t *testing.T) { // 3
	cur := readyState("T3", 3, "0")
	stale := tstate("T2", 2, true, "stale", 6, 5, "0")
	if reason := BaselineEligible(&cur, &stale); reason != BaselineNotReady {
		t.Fatalf("stale baseline must be NOT_READY, got %q", reason)
	}
	revMismatch := tstate("T2b", 2, true, "calculated", 7, 5, "0")
	if reason := BaselineEligible(&cur, &revMismatch); reason != BaselineNotReady {
		t.Fatalf("revision mismatch must be NOT_READY, got %q", reason)
	}
}

func TestExplicitValidBaseline(t *testing.T) { // 4
	cur := readyState("T4", 4, "0")
	v1 := readyState("T1", 1, "0")
	if reason := BaselineEligible(&cur, &v1); reason != "" {
		t.Fatalf("explicit earlier approved must be eligible, got %q", reason)
	}
}

func TestDifferentTenderNumberRejected(t *testing.T) { // 5
	cur := readyState("T4", 4, "0")
	other := readyState("X1", 1, "0")
	other.TenderNumber = "OTHER"
	if reason := BaselineEligible(&cur, &other); reason != BaselineDifferentNumber {
		t.Fatalf("want DIFFERENT_TENDER_NUMBER, got %q", reason)
	}
}

func TestNewerBaselineRejectedAndSelfRejected(t *testing.T) { // 6 + 41
	cur := readyState("T4", 4, "0")
	newer := readyState("T5", 5, "0")
	if reason := BaselineEligible(&cur, &newer); reason != BaselineNotEarlier {
		t.Fatalf("newer version must be rejected, got %q", reason)
	}
	self := cur
	if reason := BaselineEligible(&cur, &self); reason != BaselineSameTender {
		t.Fatalf("baseline=current must be rejected, got %q", reason)
	}
}

// ─── §17.7-11: matching ──────────────────────────────────────────────────────

func TestExactPositionKeyMatch(t *testing.T) { // 7-8 (persisted lineage нет — key)
	cur := version(readyState("C", 2, "110"),
		[]Position{pos("cp", "01", "  РАБОТЫ  по    бетону", "м2", 3, 0)}, // номер сменился
		[]Item{item("ci", "cp", "n1", 0, "100", "110", "0")})
	base := version(readyState("B", 1, "110"),
		[]Position{pos("bp", "01", "Работы по бетону", "м2", 1, 0)},
		[]Item{item("bi", "bp", "n1", 0, "100", "110", "0")})
	r := compare(cur, base)
	d := diffByID(t, r, "row:bi>ci")
	if d.Status != StatusUnchanged {
		t.Fatalf("normalized key must match across renumber: %+v", d)
	}
}

func TestAmbiguousPositionGroup(t *testing.T) { // 9
	cur := version(readyState("C", 2, "220"),
		[]Position{
			pos("cp1", "01", "Работы", "м2", 1, 0),
			pos("cp2", "01", "Работы", "м2", 2, 1), // дубль ключа позиции
		},
		[]Item{
			item("ci1", "cp1", "n1", 0, "100", "110", "0"),
			item("ci2", "cp2", "n1", 1, "100", "110", "0"),
		})
	base := version(readyState("B", 1, "110"),
		[]Position{pos("bp1", "01", "Работы", "м2", 1, 0)},
		[]Item{item("bi1", "bp1", "n1", 0, "100", "110", "0")})
	r := compare(cur, base)
	if len(r.Items) != 1 || r.Items[0].Status != StatusAmbiguousGroup {
		t.Fatalf("duplicate position key must form ONE ambiguous group: %+v", r.Items)
	}
	if r.Items[0].Commercial.Delta != 110 {
		t.Fatalf("group aggregate delta=%v, want 110", r.Items[0].Commercial.Delta)
	}
	if r.Summary.AmbiguousGroups != 1 {
		t.Fatalf("summary ambiguous=%d", r.Summary.AmbiguousGroups)
	}
}

func TestExactBoqKeyMatchAndParentContext(t *testing.T) { // 10-11, 23
	// материал под работой: parent-контекст в ключе — идентичность родителя.
	curItems := []Item{
		item("cw", "cp", "w1", 0, "100", "110", "0"),
		item("cm", "cp", "m1", 1, "50", "55", "0", withParent("cw")),
	}
	baseItems := []Item{
		item("bw", "bp", "w1", 0, "100", "110", "0"),
		item("bm", "bp", "m1", 1, "50", "55", "0", withParent("bw")),
	}
	cur := onePosVersion("C", 2, "165", curItems)
	base := onePosVersion("B", 1, "165", baseItems)
	base.Positions[0].ID = "bp"
	cur.Positions[0].ID = "cp"
	r := compare(cur, base)
	if diffByID(t, r, "row:bm>cm").Status != StatusUnchanged {
		t.Fatal("child rows with same parent identity must match")
	}
	// 23: смена родителя → parent change.
	cur2 := onePosVersion("C", 2, "165", []Item{
		item("cw2", "cp", "w2", 0, "100", "110", "0"),
		item("cm", "cp", "m1", 1, "50", "55", "0", withParent("cw2")),
	})
	cur2.Positions[0].ID = "cp"
	r2 := compare(cur2, base)
	// родительская идентичность в ключе → строки НЕ матчатся (added/removed) —
	// консервативная exact-политика.
	added, removed := 0, 0
	for _, d := range r2.Items {
		if d.Status == StatusAdded {
			added++
		}
		if d.Status == StatusRemoved {
			removed++
		}
	}
	if added == 0 || removed == 0 {
		t.Fatalf("parent identity change must split match: %+v", r2.Items)
	}
}

// ─── §17.12-16: statuses ─────────────────────────────────────────────────────

func TestAddedRemovedModifiedUnchanged(t *testing.T) { // 12-15
	cur := onePosVersion("C", 2, "331", []Item{
		item("c-same", "C-p1", "n1", 0, "100", "110", "0"),
		item("c-mod", "C-p1", "n2", 1, "200", "221", "0", withQty(2)),
		item("c-new", "C-p1", "n3", 2, "0", "0", "0"),
	})
	base := onePosVersion("B", 1, "320", []Item{
		item("b-same", "B-p1", "n1", 0, "100", "110", "0"),
		item("b-mod", "B-p1", "n2", 1, "190", "210", "0"),
		item("b-del", "B-p1", "n4", 2, "0", "0", "0"),
	})
	r := compare(cur, base)
	if diffByID(t, r, "row:b-same>c-same").Status != StatusUnchanged {
		t.Fatal("unchanged row misclassified")
	}
	mod := diffByID(t, r, "row:b-mod>c-mod")
	if mod.Status != StatusModified || !hasField(mod.ChangedFields, "quantity") {
		t.Fatalf("modified row wrong: %+v", mod)
	}
	if diffByID(t, r, "cur:c-new").Status != StatusAdded {
		t.Fatal("added row misclassified")
	}
	if diffByID(t, r, "base:b-del").Status != StatusRemoved {
		t.Fatal("removed row misclassified")
	}
	s := r.Summary
	if s.ItemsAdded != 1 || s.ItemsRemoved != 1 || s.ItemsModified != 1 || s.ItemsUnchanged != 1 {
		t.Fatalf("summary counts wrong: %+v", s)
	}
}

func TestDuplicateExactKeyGroup(t *testing.T) { // 16
	cur := onePosVersion("C", 2, "330", []Item{
		item("c1", "C-p1", "n1", 0, "100", "110", "0"),
		item("c2", "C-p1", "n1", 1, "100", "110", "0"),
		item("c3", "C-p1", "n1", 2, "100", "110", "0"),
	})
	base := onePosVersion("B", 1, "220", []Item{
		item("b1", "B-p1", "n1", 0, "100", "110", "0"),
		item("b2", "B-p1", "n1", 1, "100", "110", "0"),
	})
	r := compare(cur, base)
	if len(r.Items) != 1 || r.Items[0].Status != StatusAmbiguousGroup {
		t.Fatalf("duplicates must aggregate to ONE group: %+v", r.Items)
	}
	g := r.Items[0]
	if g.CurrentCount != 3 || g.BaselineCount != 2 || g.Commercial.Delta != 110 {
		t.Fatalf("group aggregate wrong: %+v", g)
	}
	if g.Note == "" {
		t.Fatal("group must carry explanatory note")
	}
}

// ─── §17.17-24: changed fields ───────────────────────────────────────────────

func TestChangedFieldsDetection(t *testing.T) { // 17-22, 24
	baseIt := item("b", "B-p1", "n1", 0, "100", "110", "0",
		withQty(1), withRate(100), withCur("RUB"), withConsump(1),
		withDelivery(0), withDesc("бетон М300"), withDetail("dc1"), withQuote("https://a", "2026-01-01"))
	curIt := item("c", "C-p1", "n1", 0, "150", "165", "0",
		withQty(2), withRate(75), withCur("USD"), withConsump(1.1),
		withDelivery(5), withDesc("бетон М300"), withDetail("dc1"), withQuote("https://b", "2026-02-02"))
	r := compare(
		onePosVersion("C", 2, "165", []Item{curIt}),
		onePosVersion("B", 1, "110", []Item{baseIt}),
	)
	d := r.Items[0]
	for _, f := range []string{"quantity", "unit_rate", "currency_type", "consumption_coefficient", "delivery_amount", "quote_link", "quote_price_date", "total_amount"} {
		if !hasField(d.ChangedFields, f) {
			t.Fatalf("field %s not detected: %+v", f, d.ChangedFields)
		}
	}
	// 24: source metadata помечено evidence-only.
	for _, f := range d.ChangedFields {
		if f.Field == "quote_link" && !f.EvidenceOnly {
			t.Fatal("quote_link must be evidence_only")
		}
		if f.Field == "quantity" && f.EvidenceOnly {
			t.Fatal("quantity is not evidence-only")
		}
	}
}

func TestNomenclatureChangeSplitsIdentity(t *testing.T) { // 22
	cur := onePosVersion("C", 2, "110", []Item{item("c", "C-p1", "nNEW", 0, "100", "110", "0")})
	base := onePosVersion("B", 1, "110", []Item{item("b", "B-p1", "nOLD", 0, "100", "110", "0")})
	r := compare(cur, base)
	// номенклатура — identity: смена → added+removed, не modified.
	if diffByID(t, r, "cur:c").Status != StatusAdded || diffByID(t, r, "base:b").Status != StatusRemoved {
		t.Fatalf("nomenclature change must split identity: %+v", r.Items)
	}
}

// ─── permutation (§17.40) ────────────────────────────────────────────────────

func TestInputPermutationInvariance(t *testing.T) { // 40
	mk := func(shuffle bool) *Report {
		items := []Item{
			item("c1", "C-p1", "n1", 0, "100", "110", "0"),
			item("c2", "C-p1", "n2", 1, "200", "220", "0"),
			item("c3", "C-p1", "n3", 2, "300", "330", "0"),
		}
		baseItems := []Item{
			item("b1", "B-p1", "n1", 0, "90", "99", "0"),
			item("b2", "B-p1", "n2", 1, "200", "220", "0"),
			item("b4", "B-p1", "n4", 2, "50", "55", "0"),
		}
		if shuffle {
			rnd := rand.New(rand.NewSource(11))
			rnd.Shuffle(len(items), func(i, j int) { items[i], items[j] = items[j], items[i] })
			rnd.Shuffle(len(baseItems), func(i, j int) { baseItems[i], baseItems[j] = baseItems[j], baseItems[i] })
		}
		return compare(onePosVersion("C", 2, "660", items), onePosVersion("B", 1, "374", baseItems))
	}
	r1, r2 := mk(false), mk(true)
	if len(r1.Items) != len(r2.Items) {
		t.Fatal("permutation changed item count")
	}
	for i := range r1.Items {
		if r1.Items[i].ID != r2.Items[i].ID || r1.Items[i].Status != r2.Items[i].Status {
			t.Fatalf("permutation changed order at %d: %s vs %s", i, r1.Items[i].ID, r2.Items[i].ID)
		}
	}
	if r1.Summary != r2.Summary {
		t.Fatal("permutation changed summary")
	}
}
