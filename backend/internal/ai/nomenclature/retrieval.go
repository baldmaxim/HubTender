package nomenclature

import (
	"sort"
	"strings"
)

// CatalogEntry — запись справочника для retrieval (батч-загрузка, без N+1).
type CatalogEntry struct {
	ID       string
	Label    string
	Type     string // material | work
	Unit     string
	Archived bool // в текущей схеме поля нет; hook для будущего фильтра
}

// Candidate — детерминированный кандидат (§4) с объяснимым score.
type Candidate struct {
	ID                       string   `json:"id"`
	Label                    string   `json:"label"`
	Type                     string   `json:"type"`
	Unit                     string   `json:"unit"`
	DeterministicScore       float64  `json:"deterministic_score"`
	MatchedTokens            []string `json:"matched_tokens,omitempty"`
	UnmatchedSignificant     []string `json:"unmatched_significant_tokens,omitempty"`
	UnitCompatibility        string   `json:"unit_compatibility"` // exact | unknown | conflict
	CategoryCompatibility    string   `json:"category_compatibility"`
	RetrievalReasons         []string `json:"retrieval_reasons,omitempty"`
	SignificantTokenConflict bool     `json:"significant_token_conflict,omitempty"`
}

// RetrievalQuery — вход retrieval.
type RetrievalQuery struct {
	Description string
	BoqType     string // canonical: раб/суб-раб/раб-комп./мат/суб-мат/мат-комп.
	Unit        string
	Limit       int
}

// normalizeMatchText — Unicode-safe нормализация (§4): lowercase, trim,
// collapse whitespace, унификация ×/x/х и Ø/ф; цифры/марки/сечения/классы
// СОХРАНЯЮТСЯ (М150≠М200, 3×2,5≠3×4, Ø20≠Ø25, A400≠A500).
// matchReplacer — построен один раз (NewReplacer компилирует trie).
var matchReplacer = strings.NewReplacer(
	"×", "x", "х", "x", // кириллическая х и знак умножения → x
	"ø", "d", "ф", "d", "⌀", "d",
	"²", "2", "³", "3",
	",", ".", // десятичная запятая внутри размеров → точка
	"(", " ", ")", " ", "«", " ", "»", " ", "\"", " ", ";", " ",
	"{", " ", "}", " ", ":", " ", "'", " ",
	// гомоглифы кириллица↔латиница (одинаково применяются к строке и
	// каталогу): А400↔A400, СВ↔CB и т.п. не теряют различий цифр.
	"а", "a", "в", "b", "е", "e", "к", "k", "м", "m",
	"н", "h", "о", "o", "р", "p", "с", "c", "т", "t", "у", "y",
)

func normalizeMatchText(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = matchReplacer.Replace(s)
	fields := strings.Fields(s)
	out := fields[:0]
	for _, f := range fields {
		f = strings.Trim(f, ".·-_/")
		if f != "" {
			out = append(out, f)
		}
	}
	return strings.Join(out, " ")
}

// tokenize — токены нормализованного текста.
func tokenize(s string) []string {
	return strings.Fields(normalizeMatchText(s))
}

// isSignificantToken — числовые/маркировочные токены (м150, a500, 3x2.5, d20,
// 100x50, 10мм…): их конфликт критичен (§4/§9.7).
func isSignificantToken(t string) bool {
	hasDigit := false
	for _, r := range t {
		if r >= '0' && r <= '9' {
			hasDigit = true
			break
		}
	}
	return hasDigit
}

// typeGroup — материал/работа для hard-constraint §4.1-2.
func typeGroup(boqType string) string {
	if strings.HasPrefix(boqType, "мат") || strings.HasPrefix(boqType, "суб-мат") {
		return "material"
	}
	if strings.HasPrefix(boqType, "раб") || strings.HasPrefix(boqType, "суб-раб") {
		return "work"
	}
	return ""
}

// unitCompatibility — политика §5: exact | unknown | conflict; конверсии
// (м↔м², шт↔компл, кг↔т) НЕ предполагаются.
func unitCompatibility(rowUnit, catalogUnit string) string {
	ru := normalizeMatchText(rowUnit)
	cu := normalizeMatchText(catalogUnit)
	if ru == "" || cu == "" {
		return "unknown"
	}
	if ru == cu {
		return "exact"
	}
	return "conflict"
}

// CatalogIndex — прединдексированный каталог (§4/§16: токенизация один раз,
// без повторной работы на каждую строку).
type CatalogIndex struct {
	entries []indexedEntry
}

type indexedEntry struct {
	entry    CatalogEntry
	norm     string
	tokens   []string
	tokenSet map[string]bool
	sig      []string
}

// NewCatalogIndex строит индекс один раз на запрос.
func NewCatalogIndex(catalog []CatalogEntry) *CatalogIndex {
	idx := &CatalogIndex{entries: make([]indexedEntry, 0, len(catalog))}
	for i := range catalog {
		e := catalog[i]
		tokens := tokenize(e.Label)
		set := make(map[string]bool, len(tokens))
		var sig []string
		for _, t := range tokens {
			set[t] = true
			if isSignificantToken(t) {
				sig = append(sig, t)
			}
		}
		idx.entries = append(idx.entries, indexedEntry{
			entry: e, norm: strings.Join(tokens, " "),
			tokens: tokens, tokenSet: set, sig: sig,
		})
	}
	return idx
}

// FindNomenclatureCandidates — one-shot обёртка (строит индекс сама).
func FindNomenclatureCandidates(q RetrievalQuery, catalog []CatalogEntry) []Candidate {
	return NewCatalogIndex(catalog).Find(q)
}

// Find — детерминированный retrieval (§4): pure, без AI и без DB.
func (idx *CatalogIndex) Find(q RetrievalQuery) []Candidate {
	limit := q.Limit
	if limit <= 0 {
		limit = DefaultCandidateLimit
	}
	if limit > MaxCandidateLimit {
		limit = MaxCandidateLimit
	}
	group := typeGroup(q.BoqType)
	rowTokens := tokenize(q.Description)
	if len(rowTokens) == 0 || group == "" {
		return nil
	}
	rowSet := map[string]bool{}
	var rowSignificant []string
	for _, t := range rowTokens {
		rowSet[t] = true
		if isSignificantToken(t) {
			rowSignificant = append(rowSignificant, t)
		}
	}
	rowNorm := strings.Join(rowTokens, " ")

	out := make([]Candidate, 0, limit)
	for i := range idx.entries {
		ie := &idx.entries[i]
		e := &ie.entry
		if e.Archived || e.Type != group { // §4.1-4
			continue
		}
		candTokens := ie.tokens
		if len(candTokens) == 0 {
			continue
		}
		candSet := ie.tokenSet

		var matched []string
		matchedCount := 0
		for _, t := range rowTokens {
			if candSet[t] {
				matched = append(matched, t)
				matchedCount++
			}
		}
		if matchedCount == 0 {
			continue
		}
		overlap := float64(matchedCount) / float64(maxInt(len(rowTokens), len(candTokens)))

		// significant numeric tokens: совпадения поднимают, конфликты топят.
		sigMatched, sigConflict := 0, false
		var unmatchedSig []string
		candSig := ie.sig
		for _, t := range rowSignificant {
			if candSet[t] {
				sigMatched++
			} else {
				unmatchedSig = append(unmatchedSig, t)
			}
		}
		if len(rowSignificant) > 0 && len(candSig) > 0 && sigMatched == 0 {
			sigConflict = true // Ø20 vs Ø25, М150 vs М200 …
		}

		score := overlap
		var reasons []string
		reasons = append(reasons, "Совпадение токенов названия")
		if strings.Contains(ie.norm, rowNorm) || strings.Contains(rowNorm, ie.norm) {
			score += 0.2
			reasons = append(reasons, "Название почти полностью содержится в кандидате")
		}
		if sigMatched > 0 {
			score += 0.15 * float64(sigMatched)
			reasons = append(reasons, "Совпали марки/размеры")
		}
		if sigConflict {
			score -= 0.4
			reasons = append(reasons, "Марки/размеры НЕ совпадают")
		}
		uc := unitCompatibility(q.Unit, e.Unit)
		switch uc {
		case "exact":
			score += 0.15
			reasons = append(reasons, "Единица измерения совпадает")
		case "conflict":
			score -= 0.25
			reasons = append(reasons, "Единица измерения не совпадает")
		}
		if score <= 0.05 {
			continue
		}
		if score > 1 {
			score = 1
		}
		out = append(out, Candidate{
			ID: e.ID, Label: e.Label, Type: e.Type, Unit: e.Unit,
			DeterministicScore:       round3(score),
			MatchedTokens:            matched,
			UnmatchedSignificant:     unmatchedSig,
			UnitCompatibility:        uc,
			CategoryCompatibility:    "unknown", // категорий у номенклатуры нет (аудит §1)
			RetrievalReasons:         reasons,
			SignificantTokenConflict: sigConflict,
		})
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].DeterministicScore != out[b].DeterministicScore {
			return out[a].DeterministicScore > out[b].DeterministicScore
		}
		if out[a].Label != out[b].Label {
			return out[a].Label < out[b].Label
		}
		return out[a].ID < out[b].ID
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func round3(v float64) float64 { return float64(int(v*1000+0.5)) / 1000 }
