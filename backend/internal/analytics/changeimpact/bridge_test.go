package changeimpact

import (
	"encoding/json"
	"fmt"
	"math"
	"testing"
	"time"
)

// ─── §17.25-33: deltas + reconciliation ──────────────────────────────────────

func TestDirectAndCommercialDeltas(t *testing.T) { // 25-27
	cur := onePosVersion("C", 2, "253", []Item{
		item("c", "C-p1", "n1", 0, "150.50", "120.25", "132.75"),
	})
	base := onePosVersion("B", 1, "220", []Item{
		item("b", "B-p1", "n1", 0, "100.25", "110", "110"),
	})
	r := compare(cur, base)
	d := r.Items[0]
	if d.Direct.Delta != 50.25 {
		t.Fatalf("direct delta=%v, want 50.25", d.Direct.Delta)
	}
	if r.Summary.CommercialMaterialDelta != 10.25 || r.Summary.CommercialWorkDelta != 22.75 {
		t.Fatalf("commercial deltas wrong: %+v", r.Summary)
	}
	if d.Commercial.Delta != 33.00 {
		t.Fatalf("row commercial delta=%v, want 33.00", d.Commercial.Delta)
	}
}

func TestAddedAndRemovedDeltas(t *testing.T) { // 28-29
	cur := onePosVersion("C", 2, "110", []Item{item("c", "C-p1", "nNEW", 0, "100", "60", "50")})
	base := onePosVersion("B", 1, "77", []Item{item("b", "B-p1", "nOLD", 0, "70", "40", "37")})
	r := compare(cur, base)
	a := diffByID(t, r, "cur:c")
	if a.Commercial.Baseline != 0 || a.Commercial.Current != 110 || a.Commercial.Delta != 110 {
		t.Fatalf("added delta wrong: %+v", a.Commercial)
	}
	rm := diffByID(t, r, "base:b")
	if rm.Commercial.Baseline != 77 || rm.Commercial.Current != 0 || rm.Commercial.Delta != -77 {
		t.Fatalf("removed delta wrong: %+v", rm.Commercial)
	}
	if a.Direction != "increase" || rm.Direction != "decrease" {
		t.Fatalf("directions wrong: %s / %s", a.Direction, rm.Direction)
	}
}

func insuranceFixture(aptPrice string) Insurance {
	// формула этапа 0: base × judicial/100 × total/100 = apt×1 × 0.10 × 1.00.
	return Insurance{
		Present: true, JudicialPct: "10", TotalPct: "100",
		AptPriceM2: aptPrice, AptArea: "1", ParkingPriceM2: "0", ParkingA: "0",
		StoragePriceM2: "0", StorageA: "0",
	}
}

func TestInsuranceDeltaAndBridge(t *testing.T) { // 30, 31
	// insurance: 10% от apt_price*area. base: 1000 → 100; cur: 2000 → 200.
	curItems := []Item{item("c", "C-p1", "n1", 0, "100", "110", "0")}
	baseItems := []Item{item("b", "B-p1", "n1", 0, "100", "110", "0")}
	cur := onePosVersion("C", 2, "310", curItems) // 110 + 200
	base := onePosVersion("B", 1, "210", baseItems)
	cur.Tender.Insurance = insuranceFixture("2000")
	base.Tender.Insurance = insuranceFixture("1000")
	r := compare(cur, base)
	if r.Summary.InsuranceDelta != 100 {
		t.Fatalf("insurance delta=%v, want 100", r.Summary.InsuranceDelta)
	}
	// 31: exact reconciliation — grand delta 100 = BOQ 0 + insurance 100.
	if !r.Summary.IsReconciled || r.Summary.ReconciliationResidual != 0 {
		t.Fatalf("must reconcile exactly: %+v", r.Summary)
	}
	var insEntries int
	for _, b := range r.Bridge {
		if b.Code == "INSURANCE" {
			insEntries++
			if b.Amount != 100 {
				t.Fatalf("bridge insurance=%v", b.Amount)
			}
		}
	}
	if insEntries != 1 { // страхование ровно один раз
		t.Fatalf("insurance bridge entries=%d, want 1", insEntries)
	}
}

func TestReconciliationMismatchNotHidden(t *testing.T) { // 32
	cur := onePosVersion("C", 2, "999999", []Item{item("c", "C-p1", "n1", 0, "100", "110", "0")})
	base := onePosVersion("B", 1, "110", []Item{item("b", "B-p1", "n1", 0, "100", "110", "0")})
	r := compare(cur, base)
	if r.Summary.IsReconciled {
		t.Fatal("corrupted grand total must NOT reconcile")
	}
	if r.Summary.ReconciliationStatus != ReconciliationMismatch {
		t.Fatalf("status=%s, want RECONCILIATION_MISMATCH", r.Summary.ReconciliationStatus)
	}
	if r.Summary.ReconciliationResidual == 0 {
		t.Fatal("residual must be visible, not hidden")
	}
	// residual не прячется в bridge-категорию «прочее».
	for _, b := range r.Bridge {
		if b.Code == "OTHER" || b.Label == "Прочее" {
			t.Fatal("residual must not be hidden in 'прочее'")
		}
	}
}

func TestRowCountedOnceAcrossBridge(t *testing.T) { // 33
	cur := onePosVersion("C", 2, "220", []Item{item("c", "C-p1", "n1", 0, "200", "220", "0", withQty(2))})
	base := onePosVersion("B", 1, "110", []Item{item("b", "B-p1", "n1", 0, "100", "110", "0")})
	r := compare(cur, base)
	// изменённая строка: только MODIFIED-категория несёт её дельту (110).
	var mod, added, removed, ambig float64
	for _, b := range r.Bridge {
		switch b.Code {
		case "MODIFIED":
			mod = b.Amount
		case "ADDED":
			added = b.Amount
		case "REMOVED":
			removed = b.Amount
		case "AMBIGUOUS":
			ambig = b.Amount
		}
	}
	if mod != 110 || added != 0 || removed != 0 || ambig != 0 {
		t.Fatalf("row leaked into multiple bridge buckets: mod=%v add=%v rem=%v amb=%v", mod, added, removed, ambig)
	}
	if !r.Summary.IsReconciled {
		t.Fatalf("must reconcile: %+v", r.Summary)
	}
}

// ─── §17.34-37: position summary + contributors ──────────────────────────────

func TestPositionSummaryAndTopContributors(t *testing.T) { // 34-37
	curPos := []Position{
		pos("cpA", "01", "Позиция А", "м2", 1, 0),
		pos("cpB", "02", "Позиция Б", "м2", 2, 1),
	}
	basePos := []Position{
		pos("bpA", "01", "Позиция А", "м2", 1, 0),
		pos("bpB", "02", "Позиция Б", "м2", 2, 1),
	}
	cur := version(readyState("C", 2, "1330"), curPos, []Item{
		item("cA", "cpA", "n1", 0, "1000", "1100", "0", withQty(10)), // +990
		item("cB", "cpB", "n2", 1, "100", "110", "0"),                // -110 (базовая 220)
	})
	base := version(readyState("B", 1, "330"), basePos, []Item{
		item("bA", "bpA", "n1", 0, "100", "110", "0"),
		item("bB", "bpB", "n2", 1, "200", "220", "0", withQty(2)),
	})
	r := compare(cur, base)
	if len(r.PositionSummaries) != 2 {
		t.Fatalf("position summaries=%d", len(r.PositionSummaries))
	}
	// 37: |990| > |−110| → Позиция А первой.
	if r.PositionSummaries[0].PositionLabel != "№1 01 · Позиция А" {
		t.Fatalf("position order wrong: %+v", r.PositionSummaries[0])
	}
	if r.PositionSummaries[0].Commercial.Delta != 990 || r.PositionSummaries[0].ItemsModified != 1 {
		t.Fatalf("position summary wrong: %+v", r.PositionSummaries[0])
	}
	if r.Summary.PositionsChanged != 2 {
		t.Fatalf("positions changed=%d, want 2", r.Summary.PositionsChanged)
	}
	// 35-36: top increase первым, decrease присутствует.
	if len(r.TopContributors) < 2 || r.TopContributors[0].Delta != 990 || r.TopContributors[0].Direction != "increase" {
		t.Fatalf("top increase wrong: %+v", r.TopContributors)
	}
	foundDecrease := false
	for _, c := range r.TopContributors {
		if c.Direction == "decrease" && c.Delta == -110 {
			foundDecrease = true
		}
	}
	if !foundDecrease {
		t.Fatalf("top decrease missing: %+v", r.TopContributors)
	}
}

// ─── §17.38-39, 42-45 ────────────────────────────────────────────────────────

func TestStableIDsAndOrdering(t *testing.T) { // 38-39
	mk := func() *Report {
		return compare(
			onePosVersion("C", 2, "440", []Item{
				item("c1", "C-p1", "n1", 0, "100", "110", "0", withQty(3)),
				item("c2", "C-p1", "n2", 1, "300", "330", "0"),
			}),
			onePosVersion("B", 1, "220", []Item{
				item("b1", "B-p1", "n1", 0, "100", "110", "0"),
				item("b2", "B-p1", "n3", 1, "100", "110", "0"),
			}))
	}
	j1, _ := json.Marshal(mk())
	j2, _ := json.Marshal(mk())
	if string(j1) != string(j2) {
		t.Fatal("same inputs must give identical report")
	}
	r := mk()
	for _, d := range r.Items {
		if d.ID == "" {
			t.Fatal("empty diff ID")
		}
	}
}

func TestEmptyAndIdenticalVersions(t *testing.T) { // 42-43
	empty := compare(
		version(readyState("C", 2, "0"), nil, nil),
		version(readyState("B", 1, "0"), nil, nil))
	if len(empty.Items) != 0 || !empty.Summary.IsReconciled || empty.Summary.GrandTotalDelta != 0 {
		t.Fatalf("empty versions must give clean zero diff: %+v", empty.Summary)
	}
	same := compare(
		onePosVersion("C", 2, "110", []Item{item("c", "C-p1", "n1", 0, "100", "110", "0")}),
		onePosVersion("B", 1, "110", []Item{item("b", "B-p1", "n1", 0, "100", "110", "0")}))
	if same.Summary.ItemsModified != 0 || same.Summary.ItemsUnchanged != 1 || same.Summary.GrandTotalDelta != 0 {
		t.Fatalf("identical versions must be all-unchanged: %+v", same.Summary)
	}
}

func TestDecimalBoundariesAndNoNaN(t *testing.T) { // 44-45
	cur := onePosVersion("C", 2, "0.03", []Item{item("c", "C-p1", "n1", 0, "0.01", "0.03", "0")})
	base := onePosVersion("B", 1, "0.01", []Item{item("b", "B-p1", "n1", 0, "0.02", "0.01", "0")})
	r := compare(cur, base)
	d := r.Items[0]
	if d.Direct.Delta != -0.01 || d.Commercial.Delta != 0.02 {
		t.Fatalf("decimal boundary deltas wrong: %+v", d)
	}
	if !r.Summary.IsReconciled { // 0.02 == 0.03-0.01
		t.Fatalf("decimal reconciliation failed: %+v", r.Summary)
	}
	// tolerance: дельта 0.01 — ещё «без направления» (unchanged).
	if d2 := diffByID(t, r, "row:b>c"); d2.Status != StatusModified {
		t.Fatalf("0.02 commercial delta must be MODIFIED: %+v", d2)
	}
	check := func(vs ...float64) {
		for _, v := range vs {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				t.Fatal("NaN/Inf in report")
			}
		}
	}
	check(r.Summary.GrandTotalDelta, r.Summary.DirectTotalDelta, r.Summary.ReconciliationResidual)
	for _, it := range r.Items {
		check(it.Direct.Delta, it.Commercial.Delta)
	}
}

// ─── §17.46: performance ─────────────────────────────────────────────────────

func TestLargeComparisonNoQuadraticBehavior(t *testing.T) {
	if raceEnabled {
		t.Skip("perf-порог не осмыслен под -race instrumentation")
	} // 46
	build := func(n int, tid string, ver int, shift bool) VersionData {
		ps := make([]Position, 0, n/50+1)
		items := make([]Item, 0, n)
		grand := 0.0
		for p := 0; p*50 < n; p++ {
			pid := fmt.Sprintf("%s-p%04d", tid, p)
			ps = append(ps, pos(pid, fmt.Sprintf("%04d", p), fmt.Sprintf("Позиция %d", p), "м2", float64(p+1), p))
			for j := 0; j < 50 && p*50+j < n; j++ {
				i := p*50 + j
				rate := 100.0
				if shift && i%3 == 0 {
					rate = 150 // треть строк изменена
				}
				nameID := fmt.Sprintf("n%06d", i)
				if i%97 == 0 {
					nameID = "dup-key" // дубли exact-ключа → группы
				}
				mat := fmt.Sprintf("%.2f", rate*1.1)
				items = append(items, item(fmt.Sprintf("%s-i%06d", tid, i), pid, nameID, i,
					fmt.Sprintf("%.2f", rate), mat, "0", withRate(rate)))
				grand += rate * 1.1
			}
		}
		return version(readyState(tid, ver, fmt.Sprintf("%.2f", grand)), ps, items)
	}
	measure := func(n int) time.Duration {
		base := build(n, "B", 1, false)
		cur := build(n, "C", 2, true)
		start := time.Now()
		r := compare(cur, base)
		el := time.Since(start)
		if len(r.Items) == 0 || !r.Summary.IsReconciled {
			t.Fatalf("n=%d: unexpected result (items=%d, reconciled=%v, residual=%v)",
				n, len(r.Items), r.Summary.IsReconciled, r.Summary.ReconciliationResidual)
		}
		return el
	}
	d1 := measure(2500)
	d2 := measure(5000)
	if d2 > 2*time.Second {
		t.Fatalf("5000×5000 took %v (>2s)", d2)
	}
	if d1 > 30*time.Millisecond && d2 > d1*3+50*time.Millisecond {
		t.Fatalf("quadratic behavior: %v → %v", d1, d2)
	}
}
