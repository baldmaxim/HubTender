package repository

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests for the machine-read endpoints (tenders:read):
// derived section fields of ListPositions and the brief tender list.
// COMPILED + SKIPPED without HUBTENDER_TEST_DATABASE_URL:
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run 'PositionList|TenderBrief' -v

type plFixture struct {
	tenderID string
	pos      map[string]string // work_name → id
	monolith string            // cost_categories.name
}

// seedPositionListFixture — иерархия как в реальном ВОР:
//
//	1   Раздел Монолит        level 0   → раздел (следующая глубже)
//	2   Плита                 level 1   → лист, строки: 2×монолит + 1×кровля
//	3   Стены                 level 1   → лист, строк нет
//	3.5 ДОП к стенам          level 1, is_additional → лист, при поиске «следующей» пропускается
//	4   Раздел Кровля         level 0   → раздел
//	5   Мембрана              level 1   → лист (последняя)
func seedPositionListFixture(t *testing.T, pool *pgxpool.Pool, tag string) *plFixture {
	t.Helper()
	ctx := context.Background()
	f := &plFixture{pos: map[string]string{}, monolith: "МОНОЛИТНЫЕ РАБОТЫ " + tag}

	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders (title, client_name, tender_number, version)
		VALUES ($1, 'itest-client', $2, 2) RETURNING id::text`,
		"itest-pl-"+tag, "ITEST-PL-"+tag).Scan(&f.tenderID); err != nil {
		t.Fatalf("seed tender: %v", err)
	}
	var ccMono, ccRoof, dccMono, dccRoof string
	mustRow := func(dst *string, q string, args ...any) {
		if err := pool.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	mustRow(&ccMono, `INSERT INTO public.cost_categories (name, unit) VALUES ($1, 'м3') RETURNING id::text`, f.monolith)
	mustRow(&ccRoof, `INSERT INTO public.cost_categories (name, unit) VALUES ($1, 'м2') RETURNING id::text`, "КРОВЛЯ "+tag)
	mustRow(&dccMono, `INSERT INTO public.detail_cost_categories (cost_category_id, location, name, unit)
		VALUES ($1::uuid, 'itest', 'плита', 'м3') RETURNING id::text`, ccMono)
	mustRow(&dccRoof, `INSERT INTO public.detail_cost_categories (cost_category_id, location, name, unit)
		VALUES ($1::uuid, 'itest', 'мембрана', 'м2') RETURNING id::text`, ccRoof)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id=$1::uuid`, f.tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id=$1::uuid`, f.tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id=$1::uuid`, f.tenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.detail_cost_categories WHERE id = ANY($1::uuid[])`, []string{dccMono, dccRoof})
		_, _ = pool.Exec(ctx, `DELETE FROM public.cost_categories WHERE id = ANY($1::uuid[])`, []string{ccMono, ccRoof})
	})

	add := func(num float64, name string, level int, additional bool, note *string) {
		var id string
		mustRow(&id, `INSERT INTO public.client_positions
			(tender_id, position_number, work_name, hierarchy_level, is_additional, client_note, unit_code, volume)
			VALUES ($1::uuid, $2, $3, $4, $5, $6, 'м3', 10) RETURNING id::text`,
			f.tenderID, num, name, level, additional, note)
		f.pos[name] = id
	}
	note := "по проекту"
	add(1, "Раздел Монолит", 0, false, nil)
	add(2, "Плита", 1, false, &note)
	add(3, "Стены", 1, false, nil)
	add(3.5, "ДОП к стенам", 1, true, nil)
	add(4, "Раздел Кровля", 0, false, nil)
	add(5, "Мембрана", 1, false, nil)

	workNameID, _ := ensureTestNames(t, pool)
	item := func(pos, dcc string) {
		if _, err := pool.Exec(ctx, `INSERT INTO public.boq_items
			(tender_id, client_position_id, boq_item_type, description, unit_code,
			 quantity, unit_rate, currency_type, detail_cost_category_id, work_name_id)
			VALUES ($1::uuid, $2::uuid, 'раб', 'itest', 'м3', 1, 1, 'RUB', $3::uuid, $4::uuid)`,
			f.tenderID, pos, dcc, workNameID); err != nil {
			t.Fatalf("seed item: %v", err)
		}
	}
	item(f.pos["Плита"], dccMono)
	item(f.pos["Плита"], dccMono)
	item(f.pos["Плита"], dccRoof)
	return f
}

func TestPositionListIntegration_SectionFields(t *testing.T) {
	pool := newTestPool(t)
	f := seedPositionListFixture(t, pool, "PL-A")
	repo := NewPositionRepo(pool)

	// Две страницы по 4: производные поля не должны ломать курсор.
	byName := map[string]PositionListRow{}
	p := PositionListParams{TenderID: f.tenderID, Limit: 4}
	for {
		rows, err := repo.ListPositions(context.Background(), p)
		if err != nil {
			t.Fatalf("ListPositions: %v", err)
		}
		for _, r := range rows {
			byName[r.WorkName] = r
		}
		if len(rows) < p.Limit {
			break
		}
		last := rows[len(rows)-1]
		p.CursorUpdatedAt, p.CursorID = &last.UpdatedAt, &last.ID
	}
	if len(byName) != 6 {
		t.Fatalf("ожидалось 6 позиций за две страницы, получено %d", len(byName))
	}

	wantSection := map[string]bool{
		"Раздел Монолит": true, "Плита": false, "Стены": false,
		"ДОП к стенам": false, "Раздел Кровля": true, "Мембрана": false,
	}
	for name, want := range wantSection {
		if got := byName[name].IsSection; got != want {
			t.Errorf("%s: is_section = %v, want %v", name, got, want)
		}
	}

	plate := byName["Плита"]
	if plate.CostCategoryName == nil || *plate.CostCategoryName != f.monolith {
		t.Errorf("Плита: cost_category_name = %v, want %q (2 монолит против 1 кровля)", plate.CostCategoryName, f.monolith)
	}
	if plate.ClientNote == nil || *plate.ClientNote != "по проекту" {
		t.Errorf("Плита: client_note = %v, want «по проекту»", plate.ClientNote)
	}
	if walls := byName["Стены"]; walls.CostCategoryName != nil || walls.CostCategoryID != nil {
		t.Errorf("Стены без строк: cost_category должен быть NULL, получено %v", walls.CostCategoryName)
	}
}

func TestTenderBriefIntegration_RestrictedByIDs(t *testing.T) {
	pool := newTestPool(t)
	f := seedPositionListFixture(t, pool, "TB-A")
	repo := NewTenderRepo(pool)
	ctx := context.Background()

	rows, err := repo.ListTendersBrief(ctx, TenderBriefParams{IDs: []string{f.tenderID}})
	if err != nil {
		t.Fatalf("ListTendersBrief: %v", err)
	}
	if len(rows) != 1 || rows[0].ID != f.tenderID {
		t.Fatalf("ограничение по id должно оставить ровно наш тендер, получено %d", len(rows))
	}
	if rows[0].TenderNumber != "ITEST-PL-TB-A" || rows[0].Version == nil || *rows[0].Version != 2 {
		t.Fatalf("карточка неполная: %+v", rows[0])
	}

	rows, err = repo.ListTendersBrief(ctx, TenderBriefParams{Search: "itest-pl-tb"})
	if err != nil {
		t.Fatalf("ListTendersBrief search: %v", err)
	}
	found := false
	for _, r := range rows {
		found = found || r.ID == f.tenderID
	}
	if !found {
		t.Fatal("поиск по подстроке номера/названия не нашёл тендер")
	}
}
