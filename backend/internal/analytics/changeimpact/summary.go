package changeimpact

import (
	"math/big"
	"sort"
	"strings"

	"github.com/su10/hubtender/backend/internal/calc"
)

// ─── grouping helpers (map + sorted keys — без N², §16) ─────────────────────

func groupItemsByPosition(items []Item) map[string][]Item {
	out := map[string][]Item{}
	for _, it := range items {
		out[it.ClientPositionID] = append(out[it.ClientPositionID], it)
	}
	return out
}

func groupPositionsByKey(ps []Position) map[string][]*Position {
	out := map[string][]*Position{}
	for i := range ps {
		k := BuildPositionComparisonKey(&ps[i])
		out[k] = append(out[k], &ps[i])
	}
	for _, list := range out {
		sort.Slice(list, func(a, b int) bool { return list[a].SortIndex < list[b].SortIndex })
	}
	return out
}

func groupItemsByKey(items []Item, parent map[string]string) map[string][]*Item {
	out := map[string][]*Item{}
	for i := range items {
		k := BuildBoqComparisonKey(&items[i], parent[items[i].ID])
		out[k] = append(out[k], &items[i])
	}
	for _, list := range out {
		sort.Slice(list, func(a, b int) bool { return list[a].SortIndex < list[b].SortIndex })
	}
	return out
}

func sortedKeyUnion[V any](a, b map[string][]V) []string {
	seen := make(map[string]bool, len(a)+len(b))
	keys := make([]string, 0, len(a)+len(b))
	for k := range a {
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	for k := range b {
		if !seen[k] {
			seen[k] = true
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	return keys
}

// ─── ordering / summaries / contributors ─────────────────────────────────────

func (st *diffState) sortedItems() []ItemDiff {
	items := st.items
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].absImp != items[j].absImp {
			return items[i].absImp > items[j].absImp
		}
		if items[i].posSort != items[j].posSort {
			return items[i].posSort < items[j].posSort
		}
		return items[i].ID < items[j].ID
	})
	return items
}

func (st *diffState) buildPositionSummaries() ([]PositionSummary, int) {
	out := make([]PositionSummary, 0, len(st.posSeq))
	changed := 0
	for _, key := range st.posSeq {
		a := st.posAggs[key]
		ps := PositionSummary{
			PositionKey: a.key, PositionLabel: a.label,
			CurrentID: a.currentID, BaselineID: a.baselineID, Status: a.status,
			Direct:     pair(a.directBase, a.directCur),
			Commercial: pair(a.commBase, a.commCur),
			ItemsAdded: a.added, ItemsRemoved: a.removed,
			ItemsModified: a.modified, AmbiguousGroups: a.ambigCnt,
		}
		if len(a.contributors) > 5 {
			ps.TopContributors = a.contributors[:5]
		} else {
			ps.TopContributors = a.contributors
		}
		if a.added+a.removed+a.modified+a.ambigCnt > 0 || absF(ps.Commercial.Delta) > MoneyTolerance {
			changed++
		}
		out = append(out, ps)
	}
	sort.SliceStable(out, func(i, j int) bool {
		ai, aj := absF(out[i].Commercial.Delta), absF(out[j].Commercial.Delta)
		if ai != aj {
			return ai > aj
		}
		si, sj := st.posAggs[out[i].PositionKey].sortIdx, st.posAggs[out[j].PositionKey].sortIdx
		if si != sj {
			return si < sj
		}
		return out[i].PositionKey < out[j].PositionKey
	})
	return out, changed
}

func buildContributors(items []ItemDiff, insDelta *big.Rat, curIns, baseIns *Insurance) []Contributor {
	out := make([]Contributor, 0, 24)
	for i := range items {
		d := &items[i]
		if d.Status == StatusUnchanged || absF(d.Commercial.Delta) <= MoneyTolerance {
			continue
		}
		ctype := "boq_item"
		if d.Status == StatusAmbiguousGroup {
			ctype = "boq_group"
			if strings.HasPrefix(d.ID, "group:pos:") {
				ctype = "position"
			}
		}
		fields := make([]string, 0, len(d.ChangedFields))
		for _, f := range d.ChangedFields {
			fields = append(fields, f.Field)
		}
		dd := d.Direct.Delta
		out = append(out, Contributor{
			Type: ctype, ID: d.ID, Label: d.Label, PositionLabel: d.PositionLabel,
			Baseline: d.Commercial.Baseline, Current: d.Commercial.Current,
			Delta: d.Commercial.Delta, DirectDelta: &dd,
			Direction: d.Direction, ChangedFields: fields,
			CurrentItemID: d.CurrentItemID, PositionID: d.ClientPositionID,
		})
	}
	if !ratWithinTolerance(insDelta) {
		cur, _ := calc.CalculateInsuranceTotalDecimal(insInput(curIns))
		base, _ := calc.CalculateInsuranceTotalDecimal(insInput(baseIns))
		if cur == nil {
			cur = new(big.Rat)
		}
		if base == nil {
			base = new(big.Rat)
		}
		out = append(out, Contributor{
			Type: "insurance", ID: "insurance", Label: "Страхование",
			Baseline: ratToFloat2(base), Current: ratToFloat2(cur),
			Delta: ratToFloat2(insDelta), Direction: directionOf(insDelta),
		})
	}
	sort.SliceStable(out, func(i, j int) bool {
		ai, aj := absF(out[i].Delta), absF(out[j].Delta)
		if ai != aj {
			return ai > aj
		}
		return out[i].ID < out[j].ID
	})
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

// ─── insurance (формула этапа 0, ровно один раз в bridge) ────────────────────

func insInput(ins *Insurance) *calc.InsuranceDecimalInput {
	if ins == nil || !ins.Present {
		return nil
	}
	return &calc.InsuranceDecimalInput{
		JudicialPct: ins.JudicialPct, TotalPct: ins.TotalPct,
		AptPriceM2: ins.AptPriceM2, AptArea: ins.AptArea,
		ParkingPriceM2: ins.ParkingPriceM2, ParkingArea: ins.ParkingA,
		StoragePriceM2: ins.StoragePriceM2, StorageArea: ins.StorageA,
	}
}

func insuranceDelta(cur, base *Insurance) *big.Rat {
	c, err := calc.CalculateInsuranceTotalDecimal(insInput(cur))
	if err != nil || c == nil {
		c = new(big.Rat)
	}
	b, err := calc.CalculateInsuranceTotalDecimal(insInput(base))
	if err != nil || b == nil {
		b = new(big.Rat)
	}
	return ratSub(c, b)
}
