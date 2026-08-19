package estimatearchive

import (
	"math"
	"testing"
)

func f(v float64) *float64 { return &v }

func TestVolumeProximity(t *testing.T) {
	cases := []struct {
		name string
		a, b float64
		want float64
	}{
		{"равные", 100, 100, 1},
		{"разница меньше 5 процентов от среднего", 100, 105, 1},
		{"разница больше 50 процентов от среднего", 100, 200, 0},
		{"кратно больше", 100, 300, 0},
		{"линейная интерполяция", 100, 140, 1 - (1.0/3.0-0.05)/0.45},
		{"оба нуля", 0, 0, 1},
		{"один ноль", 0, 100, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := VolumeProximity(c.a, c.b)
			if math.Abs(got-c.want) > 1e-9 {
				t.Fatalf("VolumeProximity(%v,%v) = %v, want %v", c.a, c.b, got, c.want)
			}
		})
	}
}

func TestScoreExactNameAndUnit(t *testing.T) {
	pq := Prepare(Query{WorkName: "Устройство цементной стяжки", UnitCode: "м2"})
	got := Score(pq, Candidate{
		PositionID: "p1",
		WorkName:   "устройство   цементной стяжки",
		UnitCode:   "м2",
	})
	if got.Score < 0.99 {
		t.Fatalf("идентичное название и единица должны давать ~1, получили %v", got.Score)
	}
	if got.UnitCompatibility != "exact" {
		t.Fatalf("unit compatibility = %q, want exact", got.UnitCompatibility)
	}
	if got.Breakdown.ItemNo != nil {
		t.Fatal("item_no не задан в запросе — компонент не должен применяться")
	}
	if got.Breakdown.Volume != nil {
		t.Fatal("объём не задан — компонент не должен применяться")
	}
}

func TestScoreSignificantTokenConflictSinks(t *testing.T) {
	pq := Prepare(Query{WorkName: "Бетон М150", UnitCode: "м3"})
	same := Score(pq, Candidate{PositionID: "a", WorkName: "Бетон М150", UnitCode: "м3"})
	other := Score(pq, Candidate{PositionID: "b", WorkName: "Бетон М200", UnitCode: "м3"})

	if !other.SignificantTokenConflict {
		t.Fatal("М150 против М200 — ожидался significant_token_conflict")
	}
	if same.SignificantTokenConflict {
		t.Fatal("М150 против М150 — конфликта быть не должно")
	}
	if other.Score >= same.Score {
		t.Fatalf("конфликт марки должен снижать score: same=%v other=%v", same.Score, other.Score)
	}
	if len(other.UnmatchedSignificant) == 0 {
		t.Fatal("несовпавшая марка должна попасть в unmatched_significant")
	}
}

func TestScoreUnknownUnitNotPunished(t *testing.T) {
	pq := Prepare(Query{WorkName: "Монтаж перегородок"})
	withUnit := Score(pq, Candidate{PositionID: "a", WorkName: "Монтаж перегородок", UnitCode: "м2"})
	if withUnit.UnitCompatibility != "unknown" {
		t.Fatalf("единица в запросе не задана → unknown, получили %q", withUnit.UnitCompatibility)
	}
	if withUnit.Breakdown.Unit != nil {
		t.Fatal("unknown-единица не должна участвовать в нормировке")
	}
	if withUnit.Score < 0.99 {
		t.Fatalf("отсутствие единицы в запросе не должно снижать score, получили %v", withUnit.Score)
	}
}

func TestScoreUnitConflictLowersScore(t *testing.T) {
	pq := Prepare(Query{WorkName: "Монтаж перегородок", UnitCode: "м2"})
	ok := Score(pq, Candidate{PositionID: "a", WorkName: "Монтаж перегородок", UnitCode: "м2"})
	bad := Score(pq, Candidate{PositionID: "b", WorkName: "Монтаж перегородок", UnitCode: "шт"})
	if bad.Score >= ok.Score {
		t.Fatalf("конфликт единиц должен снижать score: ok=%v bad=%v", ok.Score, bad.Score)
	}
	if bad.UnitCompatibility != "conflict" {
		t.Fatalf("unit compatibility = %q, want conflict", bad.UnitCompatibility)
	}
}

func TestScoreItemNoAndVolumeApplied(t *testing.T) {
	pq := Prepare(Query{WorkName: "Кладка стен", UnitCode: "м3", ItemNo: "12", Volume: f(100)})
	hit := Score(pq, Candidate{
		PositionID: "a", WorkName: "Кладка стен", UnitCode: "м3", ItemNo: "12", Volume: f(102),
	})
	miss := Score(pq, Candidate{
		PositionID: "b", WorkName: "Кладка стен", UnitCode: "м3", ItemNo: "40", Volume: f(1000),
	})
	if hit.Breakdown.ItemNo == nil || *hit.Breakdown.ItemNo != 1 {
		t.Fatal("совпавший item_no должен дать 1")
	}
	if miss.Breakdown.ItemNo == nil || *miss.Breakdown.ItemNo != 0 {
		t.Fatal("несовпавший item_no должен дать 0")
	}
	if hit.Breakdown.Volume == nil || *hit.Breakdown.Volume != 1 {
		t.Fatal("разница объёма 2 процента должна дать 1")
	}
	if miss.Score >= hit.Score {
		t.Fatalf("несовпадение item_no и объёма должно снижать score: hit=%v miss=%v", hit.Score, miss.Score)
	}
}

func TestScoreNoCommonTokensIsZero(t *testing.T) {
	pq := Prepare(Query{WorkName: "Кладка стен", UnitCode: "м3"})
	got := Score(pq, Candidate{PositionID: "a", WorkName: "Устройство кровли", UnitCode: "м3"})
	if got.Breakdown.Name != 0 {
		t.Fatalf("без общих токенов близость названия = 0, получили %v", got.Breakdown.Name)
	}
}

func TestRankSortsAndCuts(t *testing.T) {
	pq := Prepare(Query{WorkName: "Устройство стяжки", UnitCode: "м2"})
	cands := []Candidate{
		{PositionID: "c", WorkName: "Устройство кровли", UnitCode: "м2"},
		{PositionID: "a", WorkName: "Устройство стяжки", UnitCode: "м2"},
		{PositionID: "b", WorkName: "Устройство стяжки пола", UnitCode: "м2"},
	}
	got := Rank(pq, cands, 0.5, 2)
	if len(got) != 2 {
		t.Fatalf("limit=2, получили %d", len(got))
	}
	if got[0].Candidate.PositionID != "a" {
		t.Fatalf("первым должен быть точный дубль, получили %q", got[0].Candidate.PositionID)
	}
	if got[0].Score < got[1].Score {
		t.Fatal("Rank должен сортировать по убыванию score")
	}
}

func TestRankTieBreakIsDeterministic(t *testing.T) {
	pq := Prepare(Query{WorkName: "Монтаж дверей", UnitCode: "шт"})
	cands := []Candidate{
		{PositionID: "z", WorkName: "Монтаж дверей", UnitCode: "шт"},
		{PositionID: "a", WorkName: "Монтаж дверей", UnitCode: "шт"},
	}
	got := Rank(pq, cands, 0, 0)
	if got[0].Candidate.PositionID != "a" {
		t.Fatalf("при равном score сортируем по position_id, получили %q", got[0].Candidate.PositionID)
	}
}

func TestPrefilterTokens(t *testing.T) {
	got := PrefilterTokens("Устройство бетонной стяжки М150 из 2 слоёв", 3)
	if len(got) != 3 {
		t.Fatalf("ожидали 3 токена, получили %v", got)
	}
	if got[0] != "м150" {
		t.Fatalf("значащий токен должен идти первым, получили %v", got)
	}
	for _, tok := range got {
		if len([]rune(tok)) < 3 {
			t.Fatalf("короткие токены должны отбрасываться, получили %v", got)
		}
	}
}

func TestPrefilterTokensEmpty(t *testing.T) {
	if got := PrefilterTokens("  ", 4); len(got) != 0 {
		t.Fatalf("пустой запрос → пустой список, получили %v", got)
	}
}
