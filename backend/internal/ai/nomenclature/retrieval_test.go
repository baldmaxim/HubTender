package nomenclature

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"testing"
	"time"
)

// ─── dataset (§18) ───────────────────────────────────────────────────────────

type dsCatalog struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Type  string `json:"type"`
	Unit  string `json:"unit"`
}

type dsCase struct {
	Name            string `json:"name"`
	Description     string `json:"description"`
	Type            string `json:"type"`
	Unit            string `json:"unit"`
	ExpectTop1      string `json:"expect_top1"`
	ExpectInTop3ID  string `json:"expect_in_top3_id"`
	HardNegative    string `json:"hard_negative"`
	ForbiddenType   string `json:"forbidden_type"`
	ExpectNoCands   bool   `json:"expect_no_candidates"`
	ExpectAmbiguous bool   `json:"expect_ambiguous"`
	ExpectUnitConfl bool   `json:"expect_unit_conflict"`
}

type dataset struct {
	Catalog []dsCatalog `json:"catalog"`
	Cases   []dsCase    `json:"cases"`
}

func loadDataset(t *testing.T) (dataset, []CatalogEntry) {
	t.Helper()
	raw, err := os.ReadFile("testdata/dataset.json")
	if err != nil {
		t.Fatalf("dataset: %v", err)
	}
	var ds dataset
	if err := json.Unmarshal(raw, &ds); err != nil {
		t.Fatalf("dataset parse: %v", err)
	}
	catalog := make([]CatalogEntry, 0, len(ds.Catalog))
	for _, c := range ds.Catalog {
		catalog = append(catalog, CatalogEntry{ID: c.ID, Label: c.Label, Type: c.Type, Unit: c.Unit})
	}
	return ds, catalog
}

func find(cands []Candidate, id string) *Candidate {
	for i := range cands {
		if cands[i].ID == id {
			return &cands[i]
		}
	}
	return nil
}

// §18: evaluation с breakdown-метриками; §19.7-10 hard negatives.
func TestDatasetEvaluation(t *testing.T) {
	ds, catalog := loadDataset(t)
	top1, top3, total, abstainOK, hardNegFP := 0, 0, 0, 0, 0
	for _, c := range ds.Cases {
		cands := FindNomenclatureCandidates(RetrievalQuery{
			Description: c.Description, BoqType: c.Type, Unit: c.Unit,
		}, catalog)
		if c.ExpectNoCands {
			if len(cands) == 0 {
				abstainOK++
			} else {
				t.Fatalf("%s: ожидался abstain/no candidates, получили %v", c.Name, cands[0].Label)
			}
			continue
		}
		if len(cands) == 0 {
			t.Fatalf("%s: кандидатов нет", c.Name)
		}
		total++
		if c.ExpectTop1 != "" && cands[0].ID == c.ExpectTop1 {
			top1++
		}
		wantIn3 := c.ExpectTop1
		if c.ExpectInTop3ID != "" {
			wantIn3 = c.ExpectInTop3ID
		}
		for i, cd := range cands {
			if i < 3 && cd.ID == wantIn3 {
				top3++
				break
			}
		}
		// §19.2-3: forbidden type никогда не появляется.
		for _, cd := range cands {
			if c.ForbiddenType != "" && cd.Type == c.ForbiddenType {
				t.Fatalf("%s: тип %s запрещён, но кандидат %s присутствует", c.Name, c.ForbiddenType, cd.Label)
			}
		}
		// hard negatives: неверная марка/размер не должна быть УВЕРЕННЫМ top-1.
		if c.HardNegative != "" {
			if cands[0].ID == c.HardNegative {
				hardNegFP++
				t.Fatalf("%s: hard negative %s стал top-1", c.Name, c.HardNegative)
			}
			if neg := find(cands, c.HardNegative); neg != nil && !neg.SignificantTokenConflict {
				t.Fatalf("%s: hard negative без значимого конфликта", c.Name)
			}
		}
		if c.ExpectUnitConfl {
			if cd := find(cands, wantIn3); cd == nil || cd.UnitCompatibility != "conflict" {
				t.Fatalf("%s: ожидался unit conflict", c.Name)
			}
		}
	}
	t.Logf("eval: top1=%d/%d top3=%d/%d abstain_ok=%d high-conf FP(hard neg)=%d",
		top1, total, top3, total, abstainOK, hardNegFP)
	if hardNegFP != 0 { // §18: критические hard negatives — 0 FP
		t.Fatalf("hard negative false positives: %d", hardNegFP)
	}
	if top1*100 < total*70 {
		t.Fatalf("top1 recall слишком низкий: %d/%d", top1, total)
	}
}

// §19.1: точный unresolved-кандидат — top-1.
func TestExactCandidateTop1(t *testing.T) {
	_, catalog := loadDataset(t)
	cands := FindNomenclatureCandidates(RetrievalQuery{
		Description: "Кладка кирпичная стен", BoqType: "раб", Unit: "м2"}, catalog)
	if len(cands) == 0 || cands[0].ID != "w-kladka" {
		t.Fatalf("top1=%v", cands)
	}
	if cands[0].UnitCompatibility != "exact" { // §19.5
		t.Fatal("unit exact must be marked")
	}
}

// §19.4: архивный кандидат исключён.
func TestArchivedExcluded(t *testing.T) {
	catalog := []CatalogEntry{
		{ID: "a", Label: "Бетон М150", Type: "material", Unit: "м3", Archived: true},
		{ID: "b", Label: "Бетон М150 товарный", Type: "material", Unit: "м3"},
	}
	cands := FindNomenclatureCandidates(RetrievalQuery{
		Description: "Бетон М150", BoqType: "мат", Unit: "м3"}, catalog)
	if find(cands, "a") != nil {
		t.Fatal("archived candidate must be excluded")
	}
}

// §19.6: несовместимая единица не может быть high (score понижен + conflict).
func TestIncompatibleUnitPenalized(t *testing.T) {
	_, catalog := loadDataset(t)
	cands := FindNomenclatureCandidates(RetrievalQuery{
		Description: "ГКЛ лист 12,5", BoqType: "мат", Unit: "т"}, catalog)
	cd := find(cands, "m-gkl")
	if cd == nil || cd.UnitCompatibility != "conflict" {
		t.Fatalf("unit conflict must be visible: %+v", cd)
	}
	conf := ComputeConfidence(cands, "m-gkl", RowResult{Confidence: ConfidenceHigh,
		SelectedCandidateID: &cd.ID, RankedCandidateIDs: []string{cd.ID}})
	if conf == ConfidenceHigh { // §19.34
		t.Fatal("hard unit conflict cannot be high")
	}
}

// §19.11-13: числовые токены/reorder/сокращения.
func TestTokenHandling(t *testing.T) {
	_, catalog := loadDataset(t)
	// numeric preserved: «3х2,5» матчится только с 3×2,5.
	cands := FindNomenclatureCandidates(RetrievalQuery{
		Description: "кабель 3х2,5", BoqType: "мат", Unit: "м"}, catalog)
	if len(cands) == 0 || cands[0].ID != "m-cable-25" {
		t.Fatalf("numeric token match wrong: %+v", cands)
	}
	// reorder
	c2 := FindNomenclatureCandidates(RetrievalQuery{
		Description: "конструкций монолитных бетонирование", BoqType: "раб", Unit: "м3"}, catalog)
	if len(c2) == 0 || c2[0].ID != "w-beton" {
		t.Fatalf("reorder failed: %+v", c2)
	}
}

// §19.15-16: стабильный порядок и инвариантность к порядку каталога.
func TestDeterministicOrdering(t *testing.T) {
	_, catalog := loadDataset(t)
	q := RetrievalQuery{Description: "Профиль 100", BoqType: "мат", Unit: "м"}
	a := FindNomenclatureCandidates(q, catalog)
	shuffled := append([]CatalogEntry(nil), catalog...)
	rand.New(rand.NewSource(5)).Shuffle(len(shuffled), func(i, j int) {
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	})
	b := FindNomenclatureCandidates(q, shuffled)
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	if string(ja) != string(jb) {
		t.Fatal("catalog permutation changed candidates")
	}
	if len(a) < 2 {
		t.Fatalf("ambiguous case must return multiple: %d", len(a))
	}
}

// §19.17-19: limit, дубликаты каталога, пустой результат.
func TestLimitDuplicatesAndEmpty(t *testing.T) {
	catalog := make([]CatalogEntry, 0, 60)
	for i := 0; i < 60; i++ {
		catalog = append(catalog, CatalogEntry{
			ID: fmt.Sprintf("id-%02d", i), Label: fmt.Sprintf("Бетон М150 вариант %d", i),
			Type: "material", Unit: "м3",
		})
	}
	cands := FindNomenclatureCandidates(RetrievalQuery{
		Description: "Бетон М150", BoqType: "мат", Unit: "м3", Limit: 100}, catalog)
	if len(cands) != MaxCandidateLimit {
		t.Fatalf("limit=%d, want %d", len(cands), MaxCandidateLimit)
	}
	dup := []CatalogEntry{
		{ID: "x1", Label: "Бетон М150", Type: "material", Unit: "м3"},
		{ID: "x2", Label: "Бетон М150", Type: "material", Unit: "м3"},
	}
	d := FindNomenclatureCandidates(RetrievalQuery{Description: "Бетон М150", BoqType: "мат", Unit: "м3"}, dup)
	if len(d) != 2 || d[0].ID != "x1" { // §19.18: детерминированно по ID
		t.Fatalf("duplicate rows handled wrong: %+v", d)
	}
	if got := FindNomenclatureCandidates(RetrievalQuery{
		Description: "Слон африканский", BoqType: "мат", Unit: "шт"}, dup); len(got) != 0 { // §19.19
		t.Fatalf("no-candidates case broken: %+v", got)
	}
}

// §19.20: 10 000 записей каталога.
func TestLargeCatalogPerformance(t *testing.T) {
	catalog := make([]CatalogEntry, 0, 10000)
	for i := 0; i < 10000; i++ {
		catalog = append(catalog, CatalogEntry{
			ID:    fmt.Sprintf("id-%05d", i),
			Label: fmt.Sprintf("Материал %d марка М%d размер %d×%d", i, 100+i%10*50, i%200, i%100),
			Type:  "material", Unit: "шт",
		})
	}
	start := time.Now()
	idx := NewCatalogIndex(catalog) // §16: индекс один раз на запрос
	for i := 0; i < 50; i++ {       // 50 строк × 10k каталог
		idx.Find(RetrievalQuery{
			Description: fmt.Sprintf("Материал %d марка М150", i*13), BoqType: "мат", Unit: "шт"})
	}
	el := time.Since(start)
	if el > 5*time.Second {
		t.Fatalf("retrieval too slow: %v", el)
	}
	t.Logf("50 rows × 10k catalog: %v", el)
}
