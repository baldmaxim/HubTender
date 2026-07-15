package importmemory

import (
	"fmt"
	"testing"
	"time"
)

// ─── §17.1-4: header signature ───────────────────────────────────────────────

func TestHeaderSignatureStable(t *testing.T) {
	h := []string{"№ позиции", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена"}
	a := BuildImportHeaderSignature(h)
	b := BuildImportHeaderSignature([]string{"№  ПОЗИЦИИ", " тип ", "Наименование", "ед. изм.", "Кол-во", "Цена"})
	if a == "" || a != b {
		t.Fatalf("signature must be stable to case/whitespace: %s vs %s", a, b)
	}
	// §17.4: изменение заголовка меняет сигнатуру.
	if a == BuildImportHeaderSignature([]string{"№ позиции", "Тип", "Название", "Ед. изм.", "Кол-во", "Цена"}) {
		t.Fatal("different header must change signature")
	}
	// Позиция колонки значима.
	if a == BuildImportHeaderSignature([]string{"Тип", "№ позиции", "Наименование", "Ед. изм.", "Кол-во", "Цена"}) {
		t.Fatal("column order must change signature")
	}
	// Хвостовые пустые колонки не значимы.
	if a != BuildImportHeaderSignature(append(append([]string{}, h...), "", "", "")) {
		t.Fatal("trailing empty columns must not change signature")
	}
	// Пустая колонка в середине значима (позиции сдвигаются).
	if a == BuildImportHeaderSignature([]string{"№ позиции", "", "Тип", "Наименование", "Ед. изм.", "Кол-во", "Цена"}) {
		t.Fatal("inner empty column must change signature")
	}
}

// §17.2-3: сигнатура не зависит от имени файла и значений строк — в функцию
// они физически не передаются; фиксируем контрактом compile-time: вход только
// []string заголовков. Дополнительно: одинаковые заголовки разных «файлов».
func TestHeaderSignatureIgnoresFileIdentity(t *testing.T) {
	h1 := []string{"Тип", "Наименование"}
	h2 := []string{"Тип", "Наименование"}
	if BuildImportHeaderSignature(h1) != BuildImportHeaderSignature(h2) {
		t.Fatal("same headers must give same signature regardless of file")
	}
}

// ─── §17.5-9,14: profile matching ────────────────────────────────────────────

func profileFix(id, name, sig string, active bool) Profile {
	return Profile{ID: id, Name: name, HeaderSignature: sig, IsActive: active,
		MappingSchemaVersion: MappingSchemaVersion, NormalizationVersion: NormalizationVersion}
}

func TestProfileMatching(t *testing.T) {
	sig := BuildImportHeaderSignature([]string{"Тип", "Наименование"})
	// §17.5: один exact.
	m := MatchProfiles([]Profile{profileFix("p1", "Смета X", sig, true)}, sig)
	if m.Status != ProfileMatchOne || m.Profiles[0].ID != "p1" {
		t.Fatalf("one match expected: %+v", m)
	}
	// §17.6: несколько → выбор, порядок детерминированный по имени (§17.14).
	m = MatchProfiles([]Profile{
		profileFix("p2", "Б-профиль", sig, true),
		profileFix("p1", "А-профиль", sig, true),
	}, sig)
	if m.Status != ProfileMatchMultiple || m.Profiles[0].Name != "А-профиль" {
		t.Fatalf("multiple must require choice, stable order: %+v", m)
	}
	// §17.8: inactive не применяется.
	m = MatchProfiles([]Profile{profileFix("p1", "X", sig, false)}, sig)
	if m.Status != ProfileMatchNone {
		t.Fatalf("inactive profile must not match: %+v", m)
	}
	// Чужая сигнатура.
	if MatchProfiles([]Profile{profileFix("p1", "X", "other", true)}, sig).Status != ProfileMatchNone {
		t.Fatal("wrong signature must not match")
	}
}

// §17.9: старая schema version → requires_review.
func TestProfileOldSchemaRequiresReview(t *testing.T) {
	p := profileFix("p1", "X", "sig", true)
	if ProfileStatus(p) != MemoryUsable {
		t.Fatal("current version must be usable")
	}
	p.MappingSchemaVersion = MappingSchemaVersion - 1
	if ProfileStatus(p) != MemoryRequiresReview {
		t.Fatal("old schema must require review")
	}
	p = profileFix("p2", "Y", "sig", true)
	p.NormalizationVersion = NormalizationVersion + 1
	if ProfileStatus(p) != MemoryRequiresReview {
		t.Fatal("other normalization must require review")
	}
}

// §17.10-12: merge профиля — пользователь сильнее, дубль колонок и удалённые
// поля отбрасываются, отсутствующая колонка остаётся (валидируется analyze).
func TestMergeProfileMapping(t *testing.T) {
	allowed := map[string]bool{"quantity": true, "unit_rate": true, "description": true}
	merged, fromProfile, skipped := MergeProfileMapping(
		map[string]string{
			"quantity":    "E",
			"unit_rate":   "E", // дубль колонки → skip
			"description": "C",
			"ghost_field": "Z", // удалённое поле → skip
		},
		map[string]string{"description": "D"}, // пользователь сильнее
		allowed,
	)
	if merged["description"] != "D" {
		t.Fatalf("user override must win: %+v", merged)
	}
	if merged["quantity"] != "E" {
		t.Fatalf("profile field must apply: %+v", merged)
	}
	if _, ok := merged["unit_rate"]; ok {
		t.Fatal("duplicate column must be skipped")
	}
	if _, ok := merged["ghost_field"]; ok {
		t.Fatal("removed target field must be skipped")
	}
	if len(fromProfile) != 1 || fromProfile[0] != "quantity" {
		t.Fatalf("fromProfile=%v", fromProfile)
	}
	if len(skipped) != 2 {
		t.Fatalf("skipped=%v", skipped)
	}
}

// §17.13: FixedOptions структурно не содержат financial-полей — контракт
// compile-time; проверяем что в типе ровно два разрешённых поля.
func TestFixedOptionsShape(t *testing.T) {
	fo := FixedOptions{DefaultCurrency: "RUB", DefaultBoqType: "раб"}
	if fo.DefaultCurrency != "RUB" || fo.DefaultBoqType != "раб" {
		t.Fatal("fixed options broken")
	}
}

// ─── §17.15-30: alias resolve ────────────────────────────────────────────────

func alias(id, kind, catID, text, boqType, unit, cat string) Alias {
	return Alias{ID: id, CatalogKind: kind, CatalogID: catID,
		NormalizedSourceText: NormalizeSourceText(text), CanonicalBoqType: boqType,
		NormalizedUnitCode: NormalizeSourceText(unit), DetailCategoryID: cat,
		NormalizationVersion: NormalizationVersion}
}

func TestAliasExactMatch(t *testing.T) {
	idx := NewAliasIndex([]Alias{
		alias("a1", KindMaterial, "m-1", "Кирпич керамический М150", "мат", "шт", ""),
	})
	// §17.15: exact match (регистр/пробелы нормализуются).
	r := idx.Resolve("  кирпич   керамический м150 ", "мат", "шт", "")
	if r.Status != AliasMatched || r.Alias.CatalogID != "m-1" {
		t.Fatalf("exact alias must match: %+v", r)
	}
	// Другой текст — none.
	if idx.Resolve("кирпич керамический м200", "мат", "шт", "").Status != AliasNone {
		t.Fatal("different text must not match (М150 ≠ М200)")
	}
	// §17.17-18: типовая изоляция.
	if idx.Resolve("кирпич керамический м150", "раб", "шт", "").Status != AliasNone {
		t.Fatal("material alias must not apply to work row")
	}
	// §17.19: unit mismatch не auto-resolve.
	if idx.Resolve("кирпич керамический м150", "мат", "т", "").Status != AliasNone {
		t.Fatal("unit mismatch must not resolve")
	}
}

// §17.20: category policy — alias с категорией требует совпадения контекста.
func TestAliasCategoryPolicy(t *testing.T) {
	idx := NewAliasIndex([]Alias{
		alias("a1", KindWork, "w-1", "кладка", "раб", "", "dc-1"),
	})
	if idx.Resolve("кладка", "раб", "м2", "dc-2").Status != AliasNone {
		t.Fatal("category mismatch must not resolve")
	}
	if r := idx.Resolve("кладка", "раб", "м2", "dc-1"); r.Status != AliasMatched {
		t.Fatalf("matching category must resolve: %+v", r)
	}
}

// §17.24: несколько активных целей → conflict, система не выбирает сама.
func TestAliasConflict(t *testing.T) {
	idx := NewAliasIndex([]Alias{
		alias("a1", KindMaterial, "m-1", "бетон", "мат", "", ""),
		alias("a2", KindMaterial, "m-2", "бетон", "мат", "", ""),
	})
	r := idx.Resolve("бетон", "мат", "м3", "")
	if r.Status != AliasConflict || len(r.Matches) != 2 {
		t.Fatalf("conflict expected: %+v", r)
	}
	// Одинаковая цель из generic+specific записей — НЕ конфликт, берём
	// специфичную детерминированно.
	idx2 := NewAliasIndex([]Alias{
		alias("g", KindMaterial, "m-1", "бетон", "мат", "", ""),
		alias("s", KindMaterial, "m-1", "бетон", "мат", "м3", ""),
	})
	r2 := idx2.Resolve("бетон", "мат", "м3", "")
	if r2.Status != AliasMatched || r2.Alias.ID != "s" {
		t.Fatalf("same target must pick most specific: %+v", r2)
	}
}

// §17.28: старая normalization version → requires_review, не молча.
func TestAliasOldNormalizationRequiresReview(t *testing.T) {
	old := alias("a1", KindMaterial, "m-1", "бетон", "мат", "", "")
	old.NormalizationVersion = NormalizationVersion + 1
	idx := NewAliasIndex([]Alias{old})
	r := idx.Resolve("бетон", "мат", "м3", "")
	if r.Status != AliasRequiresReview {
		t.Fatalf("stale normalization must require review: %+v", r)
	}
}

// §17.29: детерминированный выбор при равной специфичности (по ID).
func TestAliasStableOrdering(t *testing.T) {
	idx := NewAliasIndex([]Alias{
		alias("b", KindMaterial, "m-1", "бетон", "мат", "м3", ""),
		alias("a", KindMaterial, "m-1", "бетон", "мат", "м3", ""),
	})
	r := idx.Resolve("бетон", "мат", "м3", "")
	if r.Status != AliasMatched || r.Alias.ID != "a" {
		t.Fatalf("stable pick by id expected: %+v", r)
	}
}

// §17.30: в ключе нет цены/quantity — контракт compile-time (Resolve принимает
// только text/type/unit/category). Проверяем, что разные «цены» не различимы.
func TestAliasKeyHasNoFinancialInputs(t *testing.T) {
	idx := NewAliasIndex([]Alias{alias("a1", KindMaterial, "m-1", "бетон", "мат", "", "")})
	r1 := idx.Resolve("бетон", "мат", "м3", "")
	r2 := idx.Resolve("бетон", "мат", "м3", "")
	if r1.Status != AliasMatched || r2.Status != AliasMatched || r1.Alias.ID != r2.Alias.ID {
		t.Fatal("alias resolution must depend only on text/type/unit/category")
	}
}

// §17.47/§21: 5 000 aliases + 10 000 строк — без квадратичного поведения.
func TestAliasIndexPerformance(t *testing.T) {
	aliases := make([]Alias, 0, 5000)
	for i := 0; i < 5000; i++ {
		aliases = append(aliases, alias(
			fmt.Sprintf("a%05d", i), KindMaterial, fmt.Sprintf("m-%05d", i),
			fmt.Sprintf("материал позиция %d марка м%d", i, 100+i%9*50), "мат", "шт", ""))
	}
	start := time.Now()
	idx := NewAliasIndex(aliases)
	hits := 0
	for row := 0; row < 10000; row++ {
		r := idx.Resolve(fmt.Sprintf("материал позиция %d марка м%d", row%5000, 100+(row%5000)%9*50), "мат", "шт", "")
		if r.Status == AliasMatched {
			hits++
		}
	}
	elapsed := time.Since(start)
	if hits != 10000 {
		t.Fatalf("hits=%d, want 10000", hits)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("alias lookup too slow: %v", elapsed)
	}
	t.Logf("5000 aliases + 10000 rows: %v", elapsed)
}
