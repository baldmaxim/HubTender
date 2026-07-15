package changeimpact

import "sort"

// Причины непригодности baseline (§2).
const (
	BaselineSameTender      = "BASELINE_SAME_TENDER"
	BaselineDifferentNumber = "BASELINE_DIFFERENT_TENDER_NUMBER"
	BaselineNotEarlier      = "BASELINE_NOT_EARLIER_VERSION"
	BaselineNotApproved     = "BASELINE_NOT_APPROVED"
	BaselineNotReady        = "BASELINE_NOT_READY"
)

// BaselineEligible — "" если кандидат допустим, иначе код причины.
// Правила §2: тот же tender_number, строго более ранняя версия, financial
// approved, calculated и совпадающие ревизии. Несогласованная версия НИКОГДА
// не используется как молчаливый fallback.
func BaselineEligible(cur, cand *TenderState) string {
	if cand.ID == cur.ID {
		return BaselineSameTender
	}
	if cand.TenderNumber != cur.TenderNumber {
		return BaselineDifferentNumber
	}
	if cand.Version >= cur.Version {
		return BaselineNotEarlier
	}
	if !cand.Approved {
		return BaselineNotApproved
	}
	if cand.CalcStatus != "calculated" || cand.CalcRev != cand.InputRev {
		return BaselineNotReady
	}
	return ""
}

// PickDefaultBaseline — последняя (максимальная) более ранняя допустимая
// версия; детерминированный tie-break по approved_at, затем по ID.
func PickDefaultBaseline(cur *TenderState, cands []TenderState) *TenderState {
	eligible := make([]*TenderState, 0, len(cands))
	for i := range cands {
		if BaselineEligible(cur, &cands[i]) == "" {
			eligible = append(eligible, &cands[i])
		}
	}
	if len(eligible) == 0 {
		return nil
	}
	sort.SliceStable(eligible, func(i, j int) bool {
		if eligible[i].Version != eligible[j].Version {
			return eligible[i].Version > eligible[j].Version
		}
		if eligible[i].ApprovedAt != eligible[j].ApprovedAt {
			return eligible[i].ApprovedAt > eligible[j].ApprovedAt
		}
		return eligible[i].ID < eligible[j].ID
	})
	return eligible[0]
}

// CandidatesOf — сериализуемый список допустимых baseline (§2).
func CandidatesOf(cur *TenderState, cands []TenderState) []Candidate {
	out := make([]Candidate, 0, len(cands))
	for i := range cands {
		c := &cands[i]
		if BaselineEligible(cur, c) != "" {
			continue
		}
		out = append(out, Candidate{
			TenderID:         c.ID,
			Version:          c.Version,
			ApprovedAt:       c.ApprovedAt,
			CachedGrandTotal: ratToFloat2(parseMoneyRat(c.CachedGrandTotal)),
			Label:            c.TenderNumber + " · v" + itoa(c.Version),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Version > out[j].Version })
	return out
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var b [20]byte
	i := len(b)
	for v > 0 {
		i--
		b[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}
