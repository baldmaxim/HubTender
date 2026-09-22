package pricing

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
)

var tokenRE = regexp.MustCompile(`[a-zа-я0-9]+`)

var familyPatterns = map[string]*regexp.Regexp{
	"compactor": regexp.MustCompile(`компактор|пресс\s*макс|pressmax`),
	"furniture": regexp.MustCompile(`мебел|кресл|стул|диван|шкаф|стеллаж|стол|тумб`),
	"sign":      regexp.MustCompile(`знак|таблич|указател|колесоотбой|шлагбаум`),
	"cleaning":  regexp.MustCompile(`поломоеч|подметаль|пылесос|убороч`),
	"catering":  regexp.MustCompile(`пароконв|посудомо|фритюр|мармит|кофемаш|холодиль`),
	"it":        regexp.MustCompile(`компьют|мфу|принтер|терминал|касс`),
	"sanitary":  regexp.MustCompile(`мойк|раковин|рукомой|душ|ванн`),
	"door":      regexp.MustCompile(`двер|ворот|люк`),
	"equipment": regexp.MustCompile(`оборудован|установк|агрегат|машин|монтаж технологическ`),
}

func ScoreCandidate(targetName, targetUnit, targetCategory, targetHousing, targetScope string, candidate ArchiveCandidate, now time.Time) (float64, string, []string, bool) {
	targetNorm := normalize(targetName)
	candidateText := normalize(candidate.ItemName + " " + candidate.PositionName)
	itemNorm := normalize(candidate.ItemName)
	if targetNorm == "" || candidateText == "" || incompatibleFamilies(targetNorm, itemNorm, candidateText) {
		return 0, "", nil, false
	}
	nameScore := 0.6*tokenCoverage(targetNorm, candidateText) + 0.4*trigramSimilarity(targetNorm, candidateText)
	unitScore := 0.0
	if canonicalUnit(targetUnit) != "" && canonicalUnit(targetUnit) == canonicalUnit(value(candidate.UnitCode)) {
		unitScore = 1
	} else if canonicalUnit(targetUnit) != "" {
		return 0, "", []string{"Единица измерения несовместима; автоматический перенос запрещён"}, false
	}
	categoryScore := 0.0
	if targetCategory != "" && candidate.DetailCostCategoryID != nil && targetCategory == *candidate.DetailCostCategoryID {
		categoryScore = 1
	}
	age := now.Sub(candidate.TenderDate)
	recencyScore := 0.0
	switch {
	case age <= 180*24*time.Hour:
		recencyScore = 1
	case age <= 365*24*time.Hour:
		recencyScore = 0.5
	}
	contextScore := 0.0
	if (targetHousing != "" && candidate.HousingClass != nil && strings.EqualFold(targetHousing, *candidate.HousingClass)) ||
		(targetScope != "" && candidate.ConstructionScope != nil && strings.EqualFold(targetScope, *candidate.ConstructionScope)) {
		contextScore = 1
	}
	score := 0.50*nameScore + 0.20*unitScore + 0.15*categoryScore + 0.10*recencyScore + 0.05*contextScore
	warnings := []string{}
	if age > 180*24*time.Hour {
		warnings = append(warnings, fmt.Sprintf("Источник старше 180 дней (%d дней)", int(age.Hours()/24)))
	}
	exact := targetNorm == normalize(candidate.ItemName) && unitScore == 1
	level := "review"
	if exact {
		level = "exact"
		score = math.Max(score, 0.95)
	} else if score >= 0.85 {
		level = "strong"
	}
	if score < 0.70 {
		return score, "", warnings, false
	}
	return round4(score), level, warnings, true
}

func ApplyOutlierWarnings(candidates []ArchiveCandidate) []ArchiveCandidate {
	values := make([]float64, 0, len(candidates))
	for _, c := range candidates {
		if c.HistoricalRUBUnitRate != nil && *c.HistoricalRUBUnitRate > 0 {
			values = append(values, *c.HistoricalRUBUnitRate)
		}
	}
	if len(values) < 3 {
		return candidates
	}
	sort.Float64s(values)
	median := values[len(values)/2]
	for i := range candidates {
		v := candidates[i].HistoricalRUBUnitRate
		if v != nil && median > 0 && math.Abs(*v-median)/median > 0.50 {
			candidates[i].Warnings = append(candidates[i].Warnings, "Ставка отличается от медианы более чем на 50%")
		}
	}
	return candidates
}

func normalize(s string) string {
	s = strings.ToLower(strings.ReplaceAll(s, "ё", "е"))
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		} else {
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.Fields(b.String()), " ")
}

func canonicalUnit(s string) string {
	s = strings.ToLower(strings.TrimSpace(strings.ReplaceAll(s, ".", "")))
	s = strings.ReplaceAll(s, " ", "")
	switch s {
	case "шт", "штук":
		return "шт"
	case "компл", "комплект", "кт", "к-т":
		return "компл"
	case "мп", "пм":
		return "мп"
	default:
		return s
	}
}

func incompatibleFamilies(target, item, combined string) bool {
	tf := families(target)
	if tf["furniture"] == false && families(item)["furniture"] {
		return true
	}
	cf := families(combined)
	if len(tf) == 0 || len(cf) == 0 {
		return false
	}
	for f := range tf {
		if cf[f] || (f != "furniture" && cf["equipment"]) {
			return false
		}
	}
	return true
}

func families(s string) map[string]bool {
	out := map[string]bool{}
	for name, re := range familyPatterns {
		if re.MatchString(s) {
			out[name] = true
		}
	}
	return out
}

func tokenCoverage(a, b string) float64 {
	at, bt := tokenSet(a), tokenSet(b)
	if len(at) == 0 || len(bt) == 0 {
		return 0
	}
	inter := 0
	for t := range at {
		if bt[t] {
			inter++
		}
	}
	return float64(inter) / float64(len(at))
}

func tokenSet(s string) map[string]bool {
	out := map[string]bool{}
	for _, t := range tokenRE.FindAllString(normalize(s), -1) {
		if len([]rune(t)) > 1 {
			out[t] = true
		}
	}
	return out
}

func trigramSimilarity(a, b string) float64 {
	ag, bg := trigrams(a), trigrams(b)
	if len(ag) == 0 || len(bg) == 0 {
		return 0
	}
	inter := 0
	for g := range ag {
		if bg[g] {
			inter++
		}
	}
	return 2 * float64(inter) / float64(len(ag)+len(bg))
}

func trigrams(s string) map[string]bool {
	r := []rune("  " + normalize(s) + "  ")
	out := map[string]bool{}
	for i := 0; i+2 < len(r); i++ {
		out[string(r[i:i+3])] = true
	}
	return out
}

func value(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func round4(v float64) float64 { return math.Round(v*10000) / 10000 }
