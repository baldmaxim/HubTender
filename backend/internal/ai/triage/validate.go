package triage

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"
)

// MaxReasonRunes — длина причины, которая сохраняется.
const MaxReasonRunes = 500

// maxEvidence — сколько фактов на оценку сохраняется.
const maxEvidence = 8

// Evidence — факт, подтверждённый сервером.
type Evidence struct {
	Ref   string `json:"ref"`
	Value string `json:"value"`
}

// Assessment — проверенная оценка находки.
type Assessment struct {
	FindingID string
	Label     string
	Reason    string
	Evidence  []Evidence
	// Downgraded — модель сказала «ошибка» или «норма», но ни одна ссылка не
	// подтвердилась: сохранено как «не уверен».
	Downgraded bool
}

// ErrInvalidResponse — ответ не разобран: не JSON или не по схеме.
var ErrInvalidResponse = errors.New("triage: ответ модели не по схеме")

type rawAnswer struct {
	Assessments []struct {
		Finding  string     `json:"finding"`
		Label    string     `json:"label"`
		Reason   string     `json:"reason"`
		Evidence []Evidence `json:"evidence"`
	} `json:"assessments"`
}

// sameValue — значение из ответа совпадает с отправленным. Числа сравниваются как
// числа: модель может написать «0.10» вместо «0.1».
func sameValue(sent, got string) bool {
	sent, got = strings.TrimSpace(sent), strings.TrimSpace(got)
	if sent == got {
		return true
	}
	a, errA := strconv.ParseFloat(strings.ReplaceAll(sent, ",", "."), 64)
	b, errB := strconv.ParseFloat(strings.ReplaceAll(got, ",", "."), 64)
	if errA != nil || errB != nil {
		return false
	}
	diff := a - b
	if diff < 0 {
		diff = -diff
	}
	scale := a
	if scale < 0 {
		scale = -scale
	}
	return diff <= 1e-9 || diff <= scale*1e-9
}

func clipRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n]) + "…"
}

// Validate разбирает ответ модели. Возвращает оценку на каждую находку пакета: на
// пропущенные моделью — «не уверен» с пустой причиной (missing), чтобы находка не
// уходила модели повторно при каждом прогоне.
func Validate(content string, p *Prepared) (assessments []Assessment, missing int, err error) {
	var raw rawAnswer
	dec := json.NewDecoder(strings.NewReader(content))
	if err := dec.Decode(&raw); err != nil {
		return nil, 0, ErrInvalidResponse
	}

	got := map[string]Assessment{}
	for _, a := range raw.Assessments {
		findingID, ok := p.FindingRefs[strings.TrimSpace(a.Finding)]
		if !ok {
			continue
		}
		if _, dup := got[findingID]; dup {
			continue
		}
		label := a.Label
		if label != LabelLikelyError && label != LabelLikelyOK && label != LabelUnsure {
			label = LabelUnsure
		}
		var ev []Evidence
		seen := map[string]bool{}
		for _, e := range a.Evidence {
			ref := strings.TrimSpace(e.Ref)
			sent, ok := p.Facts[ref]
			if !ok || seen[ref] || !sameValue(sent, e.Value) {
				continue
			}
			seen[ref] = true
			ev = append(ev, Evidence{Ref: ref, Value: sent})
			if len(ev) == maxEvidence {
				break
			}
		}
		out := Assessment{
			FindingID: findingID,
			Label:     label,
			Reason:    clipRunes(a.Reason, MaxReasonRunes),
			Evidence:  ev,
		}
		if label != LabelUnsure && len(ev) == 0 {
			out.Label = LabelUnsure
			out.Downgraded = true
		}
		got[findingID] = out
	}

	refs := make([]string, 0, len(p.FindingRefs))
	for ref := range p.FindingRefs {
		refs = append(refs, ref)
	}
	sortRefs(refs)
	for _, ref := range refs {
		id := p.FindingRefs[ref]
		if a, ok := got[id]; ok {
			assessments = append(assessments, a)
			continue
		}
		missing++
		assessments = append(assessments, Assessment{FindingID: id, Label: LabelUnsure})
	}
	return assessments, missing, nil
}

// sortRefs — f1, f2, …, f10 в числовом порядке.
func sortRefs(refs []string) {
	num := func(s string) int {
		n, _ := strconv.Atoi(strings.TrimPrefix(s, "f"))
		return n
	}
	for i := 1; i < len(refs); i++ {
		for j := i; j > 0 && num(refs[j]) < num(refs[j-1]); j-- {
			refs[j], refs[j-1] = refs[j-1], refs[j]
		}
	}
}
