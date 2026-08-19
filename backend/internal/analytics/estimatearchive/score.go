// Package estimatearchive — чистый скоринг похожести исторических позиций
// заказчика (архив смет). Без сети и без БД: репозиторий отдаёт кандидатов,
// пакет считает score.
//
// Веса взяты из клиентского матчера версий (src/utils/matching/calculateMatchScore.ts):
// название 50, item_no 30, единица 10, объём 10. Отличие одно и осознанное:
// близость НАЗВАНИЯ считается token-overlap'ом со significant-token'ами
// (internal/ai/nomenclature), а не расстоянием Левенштейна. Названия позиций —
// длинные фразы с марками и размерами, где «М150 vs М200» важнее посимвольной
// дистанции, а третью реализацию нормализации заводить нельзя.
package estimatearchive

import (
	"math"
	"sort"
	"strings"

	"github.com/su10/hubtender/backend/internal/ai/nomenclature"
)

// Веса компонентов (сумма 100, как в TS-матчере).
const (
	WeightName   = 50.0
	WeightItemNo = 30.0
	WeightUnit   = 10.0
	WeightVolume = 10.0
)

// DefaultMinScore — отсечка по умолчанию для поиска по архиву.
const DefaultMinScore = 0.35

// Query — то, что ищем.
type Query struct {
	Ref      string // клиентский идентификатор запроса в батче (echo в ответе)
	WorkName string
	UnitCode string
	ItemNo   string
	Volume   *float64
}

// Candidate — историческая позиция-кандидат (минимум полей для скоринга).
type Candidate struct {
	PositionID string
	WorkName   string
	UnitCode   string
	ItemNo     string
	Volume     *float64
}

// Breakdown — вклад каждого компонента, 0..1. Неприменимый компонент (нет
// данных с одной из сторон) не выводится и не участвует в нормировке, чтобы
// отсутствие item_no не топило кандидата.
type Breakdown struct {
	Name   float64  `json:"name"`
	ItemNo *float64 `json:"item_no,omitempty"`
	Unit   *float64 `json:"unit,omitempty"`
	Volume *float64 `json:"volume,omitempty"`
}

// Scored — результат скоринга одного кандидата.
type Scored struct {
	Candidate                Candidate `json:"-"`
	Score                    float64   `json:"score"`
	Breakdown                Breakdown `json:"score_breakdown"`
	MatchedTokens            []string  `json:"matched_tokens,omitempty"`
	UnmatchedSignificant     []string  `json:"unmatched_significant_tokens,omitempty"`
	UnitCompatibility        string    `json:"unit_compatibility"`
	SignificantTokenConflict bool      `json:"significant_token_conflict,omitempty"`
}

// PreparedQuery — предвычисленные токены запроса (токенизация один раз на
// запрос, а не на каждого кандидата).
type PreparedQuery struct {
	Query       Query
	Tokens      []string
	TokenSet    map[string]bool
	Significant []string
	Norm        string
	NormItemNo  string
}

// Prepare токенизирует запрос один раз.
func Prepare(q Query) PreparedQuery {
	tokens := nomenclature.Tokenize(q.WorkName)
	set := make(map[string]bool, len(tokens))
	var sig []string
	for _, t := range tokens {
		set[t] = true
		if nomenclature.IsSignificantToken(t) {
			sig = append(sig, t)
		}
	}
	return PreparedQuery{
		Query:       q,
		Tokens:      tokens,
		TokenSet:    set,
		Significant: sig,
		Norm:        strings.Join(tokens, " "),
		NormItemNo:  nomenclature.NormalizeMatchText(q.ItemNo),
	}
}

// VolumeProximity — 1.0 при относительной разнице меньше 5 %, 0 при разнице
// больше 50 %, линейно между. База — СРЕДНЕЕ модулей, ровно как в
// calculateVolumeProximity (src/utils/matching/similarity.ts): значения должны
// совпадать с клиентским матчером версий.
func VolumeProximity(a, b float64) float64 {
	if a == b {
		return 1
	}
	if a == 0 || b == 0 {
		return 0
	}
	avg := (math.Abs(a) + math.Abs(b)) / 2
	if avg == 0 {
		return 1
	}
	rel := math.Abs(a-b) / avg
	switch {
	case rel < 0.05:
		return 1
	case rel > 0.5:
		return 0
	default:
		return 1 - (rel-0.05)/0.45
	}
}

// nameSimilarity — token-overlap + бонус за вхождение + значащие токены.
func nameSimilarity(pq PreparedQuery, candName string) (float64, []string, []string, bool) {
	candTokens := nomenclature.Tokenize(candName)
	if len(pq.Tokens) == 0 || len(candTokens) == 0 {
		return 0, nil, nil, false
	}
	candSet := make(map[string]bool, len(candTokens))
	candHasSignificant := false
	for _, t := range candTokens {
		candSet[t] = true
		if nomenclature.IsSignificantToken(t) {
			candHasSignificant = true
		}
	}

	var matched []string
	for _, t := range pq.Tokens {
		if candSet[t] {
			matched = append(matched, t)
		}
	}
	if len(matched) == 0 {
		return 0, nil, nil, false
	}

	denom := len(pq.Tokens)
	if len(candTokens) > denom {
		denom = len(candTokens)
	}
	score := float64(len(matched)) / float64(denom)

	candNorm := strings.Join(candTokens, " ")
	if strings.Contains(candNorm, pq.Norm) || strings.Contains(pq.Norm, candNorm) {
		score += 0.2
	}

	sigMatched := 0
	var unmatchedSig []string
	for _, t := range pq.Significant {
		if candSet[t] {
			sigMatched++
		} else {
			unmatchedSig = append(unmatchedSig, t)
		}
	}
	conflict := len(pq.Significant) > 0 && candHasSignificant && sigMatched == 0
	if sigMatched > 0 {
		score += 0.15 * float64(sigMatched)
	}
	if conflict {
		score -= 0.4
	}

	return clamp01(score), matched, unmatchedSig, conflict
}

// Score — взвешенная оценка одного кандидата, 0..1.
func Score(pq PreparedQuery, c Candidate) Scored {
	name, matched, unmatchedSig, conflict := nameSimilarity(pq, c.WorkName)

	sum := WeightName * name
	weight := WeightName
	bd := Breakdown{Name: round3(name)}

	if pq.NormItemNo != "" {
		if candItemNo := nomenclature.NormalizeMatchText(c.ItemNo); candItemNo != "" {
			v := 0.0
			if candItemNo == pq.NormItemNo {
				v = 1
			}
			sum += WeightItemNo * v
			weight += WeightItemNo
			bd.ItemNo = &v
		}
	}

	uc := nomenclature.UnitCompatibility(pq.Query.UnitCode, c.UnitCode)
	if uc != "unknown" {
		v := 0.0
		if uc == "exact" {
			v = 1
		}
		sum += WeightUnit * v
		weight += WeightUnit
		bd.Unit = &v
	}

	if pq.Query.Volume != nil && c.Volume != nil && *pq.Query.Volume > 0 && *c.Volume > 0 {
		v := round3(VolumeProximity(*pq.Query.Volume, *c.Volume))
		sum += WeightVolume * v
		weight += WeightVolume
		bd.Volume = &v
	}

	total := 0.0
	if weight > 0 {
		total = sum / weight
	}
	return Scored{
		Candidate:                c,
		Score:                    round3(clamp01(total)),
		Breakdown:                bd,
		MatchedTokens:            matched,
		UnmatchedSignificant:     unmatchedSig,
		UnitCompatibility:        uc,
		SignificantTokenConflict: conflict,
	}
}

// Rank скорит всех кандидатов, отсекает по minScore и возвращает top-limit.
// Порядок детерминирован: score DESC, затем position_id ASC.
func Rank(pq PreparedQuery, candidates []Candidate, minScore float64, limit int) []Scored {
	out := make([]Scored, 0, len(candidates))
	for _, c := range candidates {
		s := Score(pq, c)
		if s.Score < minScore {
			continue
		}
		out = append(out, s)
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Score != out[b].Score {
			return out[a].Score > out[b].Score
		}
		return out[a].Candidate.PositionID < out[b].Candidate.PositionID
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }
