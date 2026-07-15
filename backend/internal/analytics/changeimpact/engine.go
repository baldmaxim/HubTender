package changeimpact

import (
	"fmt"
	"math/big"
	"sort"
	"strings"
)

// BaselineNotAvailableReport — пустой контракт при отсутствии допустимого
// baseline (HTTP 200, не 500).
func BaselineNotAvailableReport(cur TenderState, candidates []Candidate, generatedAt string) *Report {
	return &Report{
		Status:             ReportBaselineNotAvailable,
		Current:            versionMeta(&cur),
		BaselineCandidates: candidates,
		GeneratedAt:        generatedAt,
		Bridge:             []BridgeEntry{},
		ConfigChanges:      []ConfigChange{},
		PositionSummaries:  []PositionSummary{},
		TopContributors:    []Contributor{},
		Items:              []ItemDiff{},
	}
}

func versionMeta(t *TenderState) VersionMeta {
	return VersionMeta{
		TenderID:         t.ID,
		TenderNumber:     t.TenderNumber,
		Version:          t.Version,
		ApprovedAt:       t.ApprovedAt,
		InputRevision:    t.InputRev,
		CachedGrandTotal: ratToFloat2(parseMoneyRat(t.CachedGrandTotal)),
	}
}

// Compare — детерминированное exact-сравнение двух сохранённых версий.
// Одинаковые входы → одинаковый результат (кроме generated_at).
func Compare(cur, base VersionData, candidates []Candidate, generatedAt string) *Report {
	rep := &Report{
		Status:             ReportOK,
		Current:            versionMeta(&cur.Tender),
		GeneratedAt:        generatedAt,
		BaselineCandidates: candidates,
	}
	bm := versionMeta(&base.Tender)
	rep.Baseline = &bm

	curParent := buildParentIdentities(cur.Items)
	baseParent := buildParentIdentities(base.Items)

	curPosByID := make(map[string]*Position, len(cur.Positions))
	for i := range cur.Positions {
		curPosByID[cur.Positions[i].ID] = &cur.Positions[i]
	}
	basePosByID := make(map[string]*Position, len(base.Positions))
	for i := range base.Positions {
		basePosByID[base.Positions[i].ID] = &base.Positions[i]
	}

	curItemsByPos := groupItemsByPosition(cur.Items)
	baseItemsByPos := groupItemsByPosition(base.Items)

	curPosKeys := groupPositionsByKey(cur.Positions)
	basePosKeys := groupPositionsByKey(base.Positions)
	allKeys := sortedKeyUnion(curPosKeys, basePosKeys)

	st := newDiffState()

	for _, key := range allKeys {
		cps, bps := curPosKeys[key], basePosKeys[key]
		switch {
		case len(cps) == 1 && len(bps) == 1:
			st.diffMatchedPosition(key, cps[0], bps[0],
				curItemsByPos[cps[0].ID], baseItemsByPos[bps[0].ID], curParent, baseParent)
		case len(bps) == 0:
			for _, p := range cps {
				st.wholePosition(key, p, curItemsByPos[p.ID], true)
			}
		case len(cps) == 0:
			for _, p := range bps {
				st.wholePosition(key, p, baseItemsByPos[p.ID], false)
			}
		default:
			// Несколько одинаково идентифицируемых позиций — сравниваем группой
			// (§4): случайные пары по UUID запрещены.
			st.ambiguousPositionGroup(key, cps, bps, curItemsByPos, baseItemsByPos)
		}
	}

	// ── Insurance delta (формула этапа 0, ровно один раз) ────────────────────
	insDelta := insuranceDelta(&cur.Tender.Insurance, &base.Tender.Insurance)

	// ── Reconciliation bridge (§7) ───────────────────────────────────────────
	curGrand := parseMoneyRat(cur.Tender.CachedGrandTotal)
	baseGrand := parseMoneyRat(base.Tender.CachedGrandTotal)
	grandDelta := ratSub(curGrand, baseGrand)
	boqCommDelta := ratAdd(ratAdd(st.addedComm, st.removedComm), ratAdd(st.modifiedComm, st.ambiguousComm))
	reconciled := ratAdd(boqCommDelta, insDelta)
	residual := ratSub(grandDelta, reconciled)
	isReconciled := ratWithinTolerance(residual)

	rep.Bridge = []BridgeEntry{
		{Code: "BASELINE_TOTAL", Label: "Итог предыдущей версии", Amount: ratToFloat2(baseGrand)},
		{Code: "ADDED", Label: "Добавленные строки", Amount: ratToFloat2(st.addedComm)},
		{Code: "REMOVED", Label: "Удалённые строки", Amount: ratToFloat2(st.removedComm)},
		{Code: "MODIFIED", Label: "Изменённые строки", Amount: ratToFloat2(st.modifiedComm)},
		{Code: "AMBIGUOUS", Label: "Неоднозначные группы", Amount: ratToFloat2(st.ambiguousComm)},
		{Code: "INSURANCE", Label: "Страхование", Amount: ratToFloat2(insDelta)},
		{Code: "CURRENT_TOTAL", Label: "Итог текущей версии", Amount: ratToFloat2(curGrand)},
	}

	recStatus := ReconciliationOK
	if !isReconciled {
		recStatus = ReconciliationMismatch
	}
	rep.Summary = Summary{
		BaselineGrandTotal:      ratToFloat2(baseGrand),
		CurrentGrandTotal:       ratToFloat2(curGrand),
		GrandTotalDelta:         ratToFloat2(grandDelta),
		DirectTotalDelta:        ratToFloat2(st.directDelta),
		CommercialMaterialDelta: ratToFloat2(st.commMatDelta),
		CommercialWorkDelta:     ratToFloat2(st.commWorkDelta),
		BoqCommercialDelta:      ratToFloat2(boqCommDelta),
		InsuranceDelta:          ratToFloat2(insDelta),
		ReconciledTotalDelta:    ratToFloat2(reconciled),
		ItemsAdded:              st.added,
		ItemsRemoved:            st.removed,
		ItemsModified:           st.modified,
		ItemsUnchanged:          st.unchanged,
		AmbiguousGroups:         st.ambiguous,
		IsReconciled:            isReconciled,
		ReconciliationResidual:  ratToFloat2(residual),
		ReconciliationStatus:    recStatus,
	}

	rep.ConfigChanges = diffConfiguration(&cur.Tender, &base.Tender)
	rep.PositionSummaries, rep.Summary.PositionsChanged = st.buildPositionSummaries()
	rep.Items = st.sortedItems()
	rep.TopContributors = buildContributors(rep.Items, insDelta, &cur.Tender.Insurance, &base.Tender.Insurance)
	return rep
}

// ─── diff state ──────────────────────────────────────────────────────────────

type posAgg struct {
	key                string
	label              string
	currentID          *string
	baselineID         *string
	status             string
	directBase         *big.Rat
	directCur          *big.Rat
	commBase           *big.Rat
	commCur            *big.Rat
	added, removed     int
	modified, ambigCnt int
	sortIdx            int
	contributors       []string
}

type diffState struct {
	items []ItemDiff

	addedComm, removedComm      *big.Rat
	modifiedComm, ambiguousComm *big.Rat
	directDelta                 *big.Rat
	commMatDelta, commWorkDelta *big.Rat

	added, removed, modified, unchanged, ambiguous int

	posAggs map[string]*posAgg
	posSeq  []string
}

func newDiffState() *diffState {
	return &diffState{
		addedComm: new(big.Rat), removedComm: new(big.Rat),
		modifiedComm: new(big.Rat), ambiguousComm: new(big.Rat),
		directDelta:  new(big.Rat),
		commMatDelta: new(big.Rat), commWorkDelta: new(big.Rat),
		posAggs: map[string]*posAgg{},
	}
}

func (st *diffState) agg(key, label string, sortIdx int) *posAgg {
	a := st.posAggs[key]
	if a == nil {
		a = &posAgg{
			key: key, label: label, status: "matched", sortIdx: sortIdx,
			directBase: new(big.Rat), directCur: new(big.Rat),
			commBase: new(big.Rat), commCur: new(big.Rat),
		}
		st.posAggs[key] = a
		st.posSeq = append(st.posSeq, key)
	}
	return a
}

func positionLabel(p *Position) string {
	label := strings.TrimSpace(p.WorkName)
	if p.ItemNo != "" {
		label = p.ItemNo + " · " + label
	}
	return fmt.Sprintf("№%v %s", p.PositionNumber, label)
}

// itemMoney — exact rats строки.
func itemMoney(it *Item) (direct, mat, work *big.Rat) {
	return parseMoneyRat(it.TotalAmountText),
		parseMoneyRat(it.CommercialMaterialText),
		parseMoneyRat(it.CommercialWorkText)
}

// track — единая точка учёта денежных дельт (строка учитывается РОВНО один
// раз: в своей bridge-категории и в direct/mat/work агрегатах).
func (st *diffState) track(status string, dDelta, mDelta, wDelta *big.Rat, agg *posAgg) {
	comm := ratAdd(mDelta, wDelta)
	st.directDelta = ratAdd(st.directDelta, dDelta)
	st.commMatDelta = ratAdd(st.commMatDelta, mDelta)
	st.commWorkDelta = ratAdd(st.commWorkDelta, wDelta)
	switch status {
	case StatusAdded:
		st.addedComm = ratAdd(st.addedComm, comm)
	case StatusRemoved:
		st.removedComm = ratAdd(st.removedComm, comm)
	case StatusModified:
		st.modifiedComm = ratAdd(st.modifiedComm, comm)
	case StatusAmbiguousGroup:
		st.ambiguousComm = ratAdd(st.ambiguousComm, comm)
	}
	_ = agg
}

func pair(baseR, curR *big.Rat) MoneyPair {
	return MoneyPair{
		Baseline: ratToFloat2(baseR),
		Current:  ratToFloat2(curR),
		Delta:    ratToFloat2(ratSub(curR, baseR)),
	}
}

func directionOf(delta *big.Rat) string {
	if ratWithinTolerance(delta) {
		return "unchanged"
	}
	if delta.Sign() > 0 {
		return "increase"
	}
	return "decrease"
}

func itemLabel(it *Item) string {
	if d := strings.TrimSpace(derefS(it.Description)); d != "" {
		return d
	}
	if it.Name != "" {
		return it.Name
	}
	return it.ID
}

// diffMatchedPosition — exact BOQ matching внутри однозначно matched позиции.
func (st *diffState) diffMatchedPosition(
	posKey string, cp, bp *Position,
	curItems, baseItems []Item,
	curParent, baseParent map[string]string,
) {
	agg := st.agg(posKey, positionLabel(cp), cp.SortIndex)
	agg.currentID, agg.baselineID = sptr(cp.ID), sptr(bp.ID)

	curByKey := groupItemsByKey(curItems, curParent)
	baseByKey := groupItemsByKey(baseItems, baseParent)
	for _, bKey := range sortedKeyUnion(curByKey, baseByKey) {
		cs, bs := curByKey[bKey], baseByKey[bKey]
		switch {
		case len(cs) == 1 && len(bs) == 1:
			st.matchedRow(posKey, agg, cp, cs[0], bs[0], curParent, baseParent)
		case len(bs) == 0:
			for _, it := range cs {
				st.singleSide(agg, cp.ID, positionLabel(cp), *it, true)
			}
		case len(cs) == 0:
			for _, it := range bs {
				st.singleSide(agg, cp.ID, positionLabel(cp), *it, false)
			}
		default:
			st.ambiguousGroup("group:"+posKey+"|"+bKey, agg, sptr(cp.ID), positionLabel(cp), derefItems(cs), derefItems(bs))
		}
	}
}

// wholePosition — вся позиция добавлена (isCurrent) либо удалена.
func (st *diffState) wholePosition(posKey string, p *Position, items []Item, isCurrent bool) {
	agg := st.agg(posKey, positionLabel(p), p.SortIndex)
	if isCurrent {
		agg.status = "added"
		agg.currentID = sptr(p.ID)
		for _, it := range items {
			st.singleSide(agg, p.ID, positionLabel(p), it, true)
		}
	} else {
		agg.status = "removed"
		agg.baselineID = sptr(p.ID)
		for _, it := range items {
			st.singleSide(agg, p.ID, positionLabel(p), it, false)
		}
	}
}

// ambiguousPositionGroup — позиции с одинаковым ключом сравниваются агрегатом.
func (st *diffState) ambiguousPositionGroup(
	posKey string, cps, bps []*Position,
	curItemsByPos, baseItemsByPos map[string][]Item,
) {
	agg := st.agg(posKey, positionLabel(cps[0])+" (группа позиций)", cps[0].SortIndex)
	agg.status = "ambiguous"
	agg.currentID = sptr(cps[0].ID)
	var cs, bs []Item
	for _, p := range cps {
		cs = append(cs, curItemsByPos[p.ID]...)
	}
	for _, p := range bps {
		bs = append(bs, baseItemsByPos[p.ID]...)
	}
	st.ambiguousGroup("group:pos:"+posKey, agg, sptr(cps[0].ID), agg.label, cs, bs)
}

// matchedRow — 1↔1 exact match: changed fields + точные дельты.
func (st *diffState) matchedRow(
	posKey string, agg *posAgg, cp *Position,
	curIt, baseIt *Item, curParent, baseParent map[string]string,
) {
	fields := changedFields(curIt, baseIt, curParent, baseParent)

	cd, cm, cw := itemMoney(curIt)
	bd, bm, bw := itemMoney(baseIt)
	dDelta, mDelta, wDelta := ratSub(cd, bd), ratSub(cm, bm), ratSub(cw, bw)
	commDelta := ratAdd(mDelta, wDelta)

	status := StatusUnchanged
	if len(fields) > 0 || !ratWithinTolerance(dDelta) || !ratWithinTolerance(commDelta) {
		status = StatusModified
	}

	d := ItemDiff{
		ID:               "row:" + baseIt.ID + ">" + curIt.ID,
		Status:           status,
		BoqItemType:      curIt.BoqItemType,
		Label:            itemLabel(curIt),
		PositionLabel:    positionLabel(cp),
		ClientPositionID: sptr(cp.ID),
		CurrentItemID:    sptr(curIt.ID),
		BaselineItemID:   sptr(baseIt.ID),
		ChangedFields:    fields,
		Quantity:         floatPair(baseIt.Quantity, curIt.Quantity),
		UnitRate:         floatPair(baseIt.UnitRate, curIt.UnitRate),
		Direct:           pair(bd, cd),
		Commercial:       pair(ratAdd(bm, bw), ratAdd(cm, cw)),
		Direction:        directionOf(commDelta),
		posSort:          curIt.SortIndex,
	}
	st.appendDiff(&d, status, dDelta, mDelta, wDelta, agg, bd, cd, bm, bw, cm, cw)
}

// singleSide — ADDED (isCurrent) либо REMOVED строка: вторая сторона = 0 (§6).
func (st *diffState) singleSide(agg *posAgg, posID, posLabel string, it Item, isCurrent bool) {
	d0, m0, w0 := itemMoney(&it)
	zero := new(big.Rat)
	var status string
	var diff ItemDiff
	if isCurrent {
		status = StatusAdded
		diff = ItemDiff{
			ID: "cur:" + it.ID, Status: status,
			CurrentItemID: sptr(it.ID), ClientPositionID: sptr(posID),
			Direct: pair(zero, d0), Commercial: pair(zero, ratAdd(m0, w0)),
			Quantity: floatPair(nil, it.Quantity), UnitRate: floatPair(nil, it.UnitRate),
		}
		st.appendDiffBasic(&diff, &it, posLabel, status, d0, m0, w0, agg, false)
	} else {
		status = StatusRemoved
		diff = ItemDiff{
			ID: "base:" + it.ID, Status: status,
			BaselineItemID: sptr(it.ID),
			Direct:         pair(d0, zero), Commercial: pair(ratAdd(m0, w0), zero),
			Quantity: floatPair(it.Quantity, nil), UnitRate: floatPair(it.UnitRate, nil),
		}
		st.appendDiffBasic(&diff, &it, posLabel, status, d0, m0, w0, agg, true)
	}
}

func (st *diffState) appendDiffBasic(
	d *ItemDiff, it *Item, posLabel, status string,
	direct, mat, work *big.Rat, agg *posAgg, negate bool,
) {
	d.BoqItemType = it.BoqItemType
	d.Label = itemLabel(it)
	d.PositionLabel = posLabel
	d.posSort = it.SortIndex
	dD, mD, wD := direct, mat, work
	if negate {
		dD, mD, wD = new(big.Rat).Neg(direct), new(big.Rat).Neg(mat), new(big.Rat).Neg(work)
	}
	d.Direction = directionOf(ratAdd(mD, wD))
	var bd, cd, bm, bw, cm, cw *big.Rat
	zero := new(big.Rat)
	if negate {
		bd, cd, bm, bw, cm, cw = direct, zero, mat, work, zero, zero
	} else {
		bd, cd, bm, bw, cm, cw = zero, direct, zero, zero, mat, work
	}
	st.appendDiff(d, status, dD, mD, wD, agg, bd, cd, bm, bw, cm, cw)
}

// ambiguousGroup — дубли exact-ключа: агрегатное сравнение (§4/§5), без
// случайных индивидуальных пар и фиктивных individual deltas.
func (st *diffState) ambiguousGroup(
	id string, agg *posAgg, posID *string, posLabel string, cs, bs []Item,
) {
	sumSide := func(items []Item) (d, m, w *big.Rat, ids []string, label string) {
		d, m, w = new(big.Rat), new(big.Rat), new(big.Rat)
		for i := range items {
			id0, m0, w0 := itemMoney(&items[i])
			d, m, w = ratAdd(d, id0), ratAdd(m, m0), ratAdd(w, w0)
			ids = append(ids, items[i].ID)
		}
		sort.Strings(ids)
		if len(items) > 0 {
			label = itemLabel(&items[0])
		}
		return
	}
	cd, cm, cw, curIDs, curLabel := sumSide(cs)
	bd, bm, bw, baseIDs, baseLabel := sumSide(bs)
	label := curLabel
	if label == "" {
		label = baseLabel
	}
	dDelta, mDelta, wDelta := ratSub(cd, bd), ratSub(cm, bm), ratSub(cw, bw)
	var itemType string
	if len(cs) > 0 {
		itemType = cs[0].BoqItemType
	} else if len(bs) > 0 {
		itemType = bs[0].BoqItemType
	}
	sortIdx := 1 << 30
	if len(cs) > 0 {
		sortIdx = cs[0].SortIndex
	}
	d := ItemDiff{
		ID: id, Status: StatusAmbiguousGroup,
		BoqItemType: itemType, Label: label + " (группа)",
		PositionLabel: posLabel, ClientPositionID: posID,
		CurrentItemIDs: curIDs, BaselineItemIDs: baseIDs,
		CurrentCount: len(cs), BaselineCount: len(bs),
		Direct:     pair(bd, cd),
		Commercial: pair(ratAdd(bm, bw), ratAdd(cm, cw)),
		Direction:  directionOf(ratAdd(mDelta, wDelta)),
		Note:       "Несколько одинаково идентифицируемых строк сравниваются как группа.",
		posSort:    sortIdx,
	}
	st.appendDiff(&d, StatusAmbiguousGroup, dDelta, mDelta, wDelta, agg, bd, cd, bm, bw, cm, cw)
}

// appendDiff — общий учёт: счётчики, bridge-категория, позиция-агрегат.
func (st *diffState) appendDiff(
	d *ItemDiff, status string,
	dDelta, mDelta, wDelta *big.Rat, agg *posAgg,
	bd, cd, bm, bw, cm, cw *big.Rat,
) {
	d.absImp = absF(d.Commercial.Delta)
	st.items = append(st.items, *d)
	st.track(status, dDelta, mDelta, wDelta, agg)
	switch status {
	case StatusAdded:
		st.added++
		agg.added++
	case StatusRemoved:
		st.removed++
		agg.removed++
	case StatusModified:
		st.modified++
		agg.modified++
	case StatusAmbiguousGroup:
		st.ambiguous++
		agg.ambigCnt++
	default:
		st.unchanged++
	}
	agg.directBase = ratAdd(agg.directBase, bd)
	agg.directCur = ratAdd(agg.directCur, cd)
	agg.commBase = ratAdd(agg.commBase, ratAdd(bm, bw))
	agg.commCur = ratAdd(agg.commCur, ratAdd(cm, cw))
	if status != StatusUnchanged {
		agg.contributors = append(agg.contributors, d.ID)
	}
}

func derefItems(ps []*Item) []Item {
	out := make([]Item, len(ps))
	for i, p := range ps {
		out[i] = *p
	}
	return out
}

func absF(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func sptr(s string) *string { return &s }

func floatPair(baseV, curV *float64) *MoneyPair {
	f := func(p *float64) float64 {
		if p == nil {
			return 0
		}
		return *p
	}
	return &MoneyPair{Baseline: f(baseV), Current: f(curV), Delta: f(curV) - f(baseV)}
}
