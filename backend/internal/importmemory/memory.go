// Package importmemory — этап 2.3: pure-логика персональной памяти умного
// импорта (профили сопоставления колонок + подтверждённые номенклатурные
// aliases).
//
// Жёсткие границы:
//   - память хранит ТОЛЬКО явно подтверждённые пользователем решения; никаких
//     неподтверждённых AI-предложений, candidate sets, workbook bytes,
//     preview rows, цен, количеств, totals, курсов и идентичности тендера;
//   - scope строго персональный (user_id); shared/team — backlog;
//   - применение профиля/alias только exact (без fuzzy) и всегда проходит
//     повторную серверную валидацию analyze/execute;
//   - persistence памяти происходит только ПОСЛЕ успешного authoritative
//     import и не влияет на его финансовый результат.
package importmemory

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"strings"
)

// Версии (§13): profile/alias с другой версией не применяются молча —
// status requires_review до подтверждения пользователем.
const (
	MappingSchemaVersion = 1 // семантика field registry этапа 2.1
	NormalizationVersion = 1 // семантика NormalizeSourceText/заголовков
)

// Статусы применимости сохранённой записи.
const (
	MemoryUsable         = "usable"
	MemoryRequiresReview = "requires_review"
)

// ─── Нормализация (§3/§5) ────────────────────────────────────────────────────

// NormalizeSourceText — стабильная нормализация текста строки/заголовка для
// exact-ключей памяти: lowercase, trim, collapse whitespace, ё→е.
// Цифры, марки, размеры сохраняются как есть (М150 ≠ М200).
func NormalizeSourceText(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "ё", "е")
	return strings.Join(strings.Fields(s), " ")
}

// ─── Header signature (§2/§5) ────────────────────────────────────────────────

// BuildImportHeaderSignature — stable SHA-256 сигнатура СТРУКТУРЫ заголовков.
// Зависит от: упорядоченного списка нормализованных заголовков, позиций
// значимых (непустых) колонок и версий схемы/нормализации.
// НЕ зависит от: значений строк, имени файла, даты, workbook fingerprint,
// количества BOQ-строк.
func BuildImportHeaderSignature(rawHeaders []string) string {
	// Хвостовые пустые колонки не значимы: у одинаковых шапок стабильная длина.
	end := len(rawHeaders)
	for end > 0 && NormalizeSourceText(rawHeaders[end-1]) == "" {
		end--
	}
	var b strings.Builder
	b.WriteString("v")
	b.WriteString(strconv.Itoa(MappingSchemaVersion))
	b.WriteString("|n")
	b.WriteString(strconv.Itoa(NormalizationVersion))
	significant := 0
	for i := 0; i < end; i++ {
		h := NormalizeSourceText(rawHeaders[i])
		b.WriteString("|")
		b.WriteString(strconv.Itoa(i))
		b.WriteString(":")
		b.WriteString(h)
		if h != "" {
			significant++
		}
	}
	b.WriteString("|sig=")
	b.WriteString(strconv.Itoa(significant))
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

// ─── Alias-модель (§3/§6) ────────────────────────────────────────────────────

// Catalog kinds.
const (
	KindMaterial = "material"
	KindWork     = "work"
)

// Alias — активное подтверждённое соответствие пользователя (строка БД).
// Financial-полей здесь нет и быть не может (§16).
type Alias struct {
	ID                   string
	CatalogKind          string // material | work
	CatalogID            string // material_name_id либо work_name_id
	NormalizedSourceText string
	CanonicalBoqType     string
	NormalizedUnitCode   string // "" = любой unit
	DetailCategoryID     string // "" = любой контекст категории
	NormalizationVersion int
	UseCount             int
	SavedAt              string // ISO date для provenance UI
}

// CatalogKindForBoqType — материал/работа по каноническому типу строки.
func CatalogKindForBoqType(boqType string) string {
	if strings.HasPrefix(boqType, "раб") || strings.HasPrefix(boqType, "суб-раб") {
		return KindWork
	}
	if strings.HasPrefix(boqType, "мат") || strings.HasPrefix(boqType, "суб-мат") {
		return KindMaterial
	}
	return ""
}

// aliasKey — точный ключ поиска (§3): БЕЗ цен/qty/валюты/тендера/строки.
func aliasKey(kind, normText, boqType string) string {
	return kind + "\x00" + normText + "\x00" + boqType
}

// AliasIndex — прединдексированные активные aliases пользователя: один батч
// из БД → O(1) exact lookup на строку (§21, без запроса на каждую строку).
type AliasIndex struct {
	byKey map[string][]Alias
}

// NewAliasIndex строит индекс один раз на analyze/execute.
func NewAliasIndex(aliases []Alias) *AliasIndex {
	idx := &AliasIndex{byKey: make(map[string][]Alias, len(aliases))}
	for _, al := range aliases {
		if al.NormalizedSourceText == "" || al.CatalogID == "" {
			continue
		}
		k := aliasKey(al.CatalogKind, al.NormalizedSourceText, al.CanonicalBoqType)
		idx.byKey[k] = append(idx.byKey[k], al)
	}
	return idx
}

// Len — количество проиндексированных aliases.
func (idx *AliasIndex) Len() int {
	if idx == nil {
		return 0
	}
	n := 0
	for _, v := range idx.byKey {
		n += len(v)
	}
	return n
}

// AliasResolution — результат exact-поиска alias для строки.
type AliasResolution struct {
	Status  string  // none | matched | conflict | requires_review
	Alias   *Alias  // при matched
	Matches []Alias // при conflict — все совместимые цели
}

// Статусы Resolve.
const (
	AliasNone           = "none"
	AliasMatched        = "matched"
	AliasConflict       = "conflict"
	AliasRequiresReview = "requires_review"
)

// Resolve — exact alias lookup (§6): пользователь уже отфильтрован на этапе
// загрузки; здесь совпадение текста+типа, затем совместимость unit/категории.
// Несколько РАЗНЫХ каталожных целей → conflict (никогда не выбираем сами).
func (idx *AliasIndex) Resolve(sourceText, boqType, unitCode, detailCategoryID string) AliasResolution {
	if idx == nil || len(idx.byKey) == 0 {
		return AliasResolution{Status: AliasNone}
	}
	kind := CatalogKindForBoqType(boqType)
	norm := NormalizeSourceText(sourceText)
	if kind == "" || norm == "" {
		return AliasResolution{Status: AliasNone}
	}
	rowUnit := NormalizeSourceText(unitCode)
	candidates := idx.byKey[aliasKey(kind, norm, boqType)]
	if len(candidates) == 0 {
		return AliasResolution{Status: AliasNone}
	}

	var compatible []Alias
	staleOnly := true
	for _, al := range candidates {
		// §5/§13: другая версия нормализации не применяется молча.
		if al.NormalizationVersion != NormalizationVersion {
			continue
		}
		staleOnly = false
		// Unit policy (§6): alias без unit подходит к любому; иначе exact.
		if al.NormalizedUnitCode != "" && rowUnit != "" && al.NormalizedUnitCode != rowUnit {
			continue
		}
		if al.NormalizedUnitCode != "" && rowUnit == "" {
			continue
		}
		// Category context (§6): alias с категорией требует совпадения.
		if al.DetailCategoryID != "" && al.DetailCategoryID != detailCategoryID {
			continue
		}
		compatible = append(compatible, al)
	}
	if len(compatible) == 0 {
		if staleOnly {
			return AliasResolution{Status: AliasRequiresReview, Matches: candidates}
		}
		return AliasResolution{Status: AliasNone}
	}

	// Разные каталожные цели → конфликт; одинаковая цель из нескольких
	// записей (unit-specific + generic) → детерминированно самая специфичная.
	targets := map[string]bool{}
	for _, al := range compatible {
		targets[al.CatalogID] = true
	}
	if len(targets) > 1 {
		return AliasResolution{Status: AliasConflict, Matches: compatible}
	}
	best := compatible[0]
	for _, al := range compatible[1:] {
		if specificity(al) > specificity(best) ||
			(specificity(al) == specificity(best) && al.ID < best.ID) {
			best = al
		}
	}
	return AliasResolution{Status: AliasMatched, Alias: &best}
}

func specificity(al Alias) int {
	s := 0
	if al.NormalizedUnitCode != "" {
		s++
	}
	if al.DetailCategoryID != "" {
		s++
	}
	return s
}
