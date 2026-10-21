package repository

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests: правила R («работа = 1 при заметном объёме позиции
// в той же единице») и S («материал в сотни раз больше объёма позиции в той же
// измеряемой единице»), а также position_id у находок.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run TestQualityRulesRS -v

type rsFixture struct {
	pool     *pgxpool.Pool
	tenderID string
	next     int
}

func newRSFixture(t *testing.T, pool *pgxpool.Pool) *rsFixture {
	t.Helper()
	ctx := context.Background()

	// Единицы строк ссылаются на public.units(code) — добавляем недостающие.
	for _, code := range []string{"м", "м2", "м3", "шт", "компл", "м.п.", "м²", "кв.м", "м2\r\n(по полу)"} {
		if _, err := pool.Exec(ctx, `
			INSERT INTO public.units (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING`, code); err != nil {
			t.Fatalf("unit %q: %v", code, err)
		}
	}

	f := &rsFixture{pool: pool}
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders (title, client_name, tender_number)
		VALUES ('itest rules R/S', 'itest', 'itest-rs-' || gen_random_uuid()::text)
		RETURNING id::text`).Scan(&f.tenderID); err != nil {
		t.Fatalf("tender: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.tenders WHERE id = $1`, f.tenderID)
	})
	return f
}

// position создаёт позицию с заданными единицей и Кол-вом ГП.
func (f *rsFixture) position(t *testing.T, unit string, manualVolume float64) string {
	t.Helper()
	f.next++
	var id string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO public.client_positions
			(tender_id, position_number, item_no, work_name, unit_code, volume, manual_volume)
		VALUES ($1, $2, $3, 'itest позиция', $4, $5, $5)
		RETURNING id::text`, f.tenderID, f.next, fmt.Sprint(f.next), unit, manualVolume,
	).Scan(&id); err != nil {
		t.Fatalf("position (%s %v): %v", unit, manualVolume, err)
	}
	return id
}

// nameID возвращает id наименования из справочника, создавая его при отсутствии;
// созданное убирается после теста (после удаления тендера — порядок cleanup LIFO).
func (f *rsFixture) nameID(t *testing.T, table, name string) string {
	t.Helper()
	ctx := context.Background()
	var id string
	if err := f.pool.QueryRow(ctx, `SELECT id::text FROM public.`+table+` WHERE name = $1 LIMIT 1`, name).Scan(&id); err == nil {
		return id
	}
	if err := f.pool.QueryRow(ctx, `INSERT INTO public.`+table+` (name, unit) VALUES ($1, 'м2') RETURNING id::text`,
		name).Scan(&id); err != nil {
		t.Fatalf("%s %q: %v", table, name, err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(context.Background(), `DELETE FROM public.`+table+` WHERE id = $1`, id)
	})
	return id
}

func (f *rsFixture) work(t *testing.T, positionID, name, unit string, qty float64) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
			(tender_id, client_position_id, boq_item_type, work_name_id, unit_code,
			 quantity, unit_rate, total_amount)
		VALUES ($1, $2, 'раб', $3, $4, $5::numeric, 100, $5::numeric * 100)
		RETURNING id::text`, f.tenderID, positionID, f.nameID(t, "work_names", name), unit, qty,
	).Scan(&id); err != nil {
		t.Fatalf("work (%s %v): %v", unit, qty, err)
	}
	return id
}

// material создаёт материал позиции; parentID — привязанная работа ("" — без привязки).
func (f *rsFixture) material(t *testing.T, positionID, name, unit string, qty float64, parentID string) string {
	t.Helper()
	var parent *string
	if parentID != "" {
		parent = &parentID
	}
	var id string
	if err := f.pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
			(tender_id, client_position_id, boq_item_type, material_type, description,
			 unit_code, quantity, unit_rate, currency_type, parent_work_item_id, material_name_id)
		VALUES ($1, $2, 'мат', 'основн.', 'материал', $3, $4, 1, 'RUB', $5::uuid, $6)
		RETURNING id::text`, f.tenderID, positionID, unit, qty, parent, f.nameID(t, "material_names", name),
	).Scan(&id); err != nil {
		t.Fatalf("material (%s %v): %v", unit, qty, err)
	}
	return id
}

func (f *rsFixture) fingerprint(t *testing.T, expr, itemID string) string {
	t.Helper()
	var fp string
	if err := f.pool.QueryRow(context.Background(), `
		SELECT `+expr+`
		FROM public.boq_items b
		JOIN public.client_positions cp ON cp.id = b.client_position_id
		WHERE b.id = $1`, itemID).Scan(&fp); err != nil {
		t.Fatalf("fingerprint: %v", err)
	}
	return fp
}

func TestQualityRulesRS(t *testing.T) {
	pool := newTestPool(t)
	repo := NewQualityRepo(pool)
	f := newRSFixture(t, pool)

	// R: работа 1 м2 в позиции на 350 м2 — находка; рядом комплект и чужая единица — нет.
	pScreed := f.position(t, "м2", 350)
	rScreed := f.work(t, pScreed, "Устройство стяжки", "м2", 1)
	pOtherUnit := f.position(t, "м2", 350)
	rOtherUnit := f.work(t, pOtherUnit, "Пусконаладка тестовая", "компл", 1)
	pKit := f.position(t, "компл", 25)
	rKit := f.work(t, pKit, "Работа в комплектах", "м3", 1)

	// R: синонимы и пояснение в скобках.
	pMeter := f.position(t, "м", 120)
	rMeter := f.work(t, pMeter, "Прокладка тестовая", "м.п.", 1)
	pNote := f.position(t, "м2\r\n(по полу)", 50)
	rNote := f.work(t, pNote, "Покрытие тестовое", "м²", 1)

	// R: к работе привязан материал.
	pLinked := f.position(t, "м2", 100)
	rLinked := f.work(t, pLinked, "Работа с материалом", "м2", 1)
	f.material(t, pLinked, "Материал привязанный", "м2", 100, rLinked)

	// S: физический выброс — кабель 25 680 м при позиции на 1 м.
	pCable := f.position(t, "м", 1)
	sCable := f.material(t, pCable, "Кабель тестовый", "м", 25680, "")
	// S: комплектные и штучные единицы не сравниваются.
	pKitMat := f.position(t, "компл", 1)
	sKit := f.material(t, pKitMat, "Комплект тестовый", "компл", 1500, "")
	pPieces := f.position(t, "шт", 1)
	sPieces := f.material(t, pPieces, "Деталь тестовая", "шт", 5000, "")
	// S: синоним единицы — кв.м = м2.
	pArea := f.position(t, "м2", 10)
	sArea := f.material(t, pArea, "Плитка тестовая", "кв.м", 1500, "")

	rep := vrRun(t, repo, f.tenderID, RunTriggerView)

	mustFind := func(rule, entity, position string) *Finding {
		t.Helper()
		fd := findFinding(rep, rule, entity)
		if fd == nil {
			t.Fatalf("ожидалась находка %s по %s", rule, entity)
		}
		if fd.PositionID == nil || *fd.PositionID != position {
			t.Fatalf("%s: position_id = %v, ожидалась позиция %s", rule, fd.PositionID, position)
		}
		return fd
	}
	mustNot := func(rule, entity string) {
		t.Helper()
		if fd := findFinding(rep, rule, entity); fd != nil {
			t.Fatalf("находки %s по %s быть не должно: %s", rule, entity, fd.Detail)
		}
	}

	t.Run("R_same_unit", func(t *testing.T) {
		fd := mustFind("R", rScreed, pScreed)
		for _, want := range []string{"Устройство стяжки", "м2"} {
			if !strings.Contains(fd.Detail, want) {
				t.Fatalf("detail %q не содержит %q", fd.Detail, want)
			}
		}
		if strings.Contains(fd.Detail, "привязано материалов") {
			t.Fatalf("у работы нет материалов, detail: %q", fd.Detail)
		}
	})

	t.Run("R_different_unit_silent", func(t *testing.T) {
		mustNot("R", rOtherUnit)
		mustNot("R", rKit)
	})

	t.Run("R_synonyms", func(t *testing.T) {
		mustFind("R", rMeter, pMeter)
		mustFind("R", rNote, pNote)
	})

	t.Run("R_linked_materials", func(t *testing.T) {
		fd := mustFind("R", rLinked, pLinked)
		if !strings.Contains(fd.Detail, "привязано материалов: 1") {
			t.Fatalf("detail %q без числа привязанных материалов", fd.Detail)
		}
	})

	t.Run("R_fingerprint_unchanged", func(t *testing.T) {
		fd := mustFind("R", rScreed, pScreed)
		want := f.fingerprint(t, `md5(concat_ws('|', trim_scale(b.quantity), trim_scale(cp.manual_volume), trim_scale(b.unit_rate)))`, rScreed)
		if fd.Fingerprint != want {
			t.Fatalf("отпечаток R = %s, прежний %s", fd.Fingerprint, want)
		}
	})

	t.Run("S_physical_outlier", func(t *testing.T) {
		fd := mustFind("S", sCable, pCable)
		for _, want := range []string{"Кабель тестовый", "25680"} {
			if !strings.Contains(fd.Detail, want) {
				t.Fatalf("detail %q не содержит %q", fd.Detail, want)
			}
		}
		want := f.fingerprint(t, `md5(concat_ws('|', trim_scale(b.quantity), trim_scale(cp.manual_volume),
			lower(btrim(b.unit_code, E' \t\r\n')), lower(btrim(cp.unit_code, E' \t\r\n'))))`, sCable)
		if fd.Fingerprint != want {
			t.Fatalf("отпечаток S = %s, прежний %s", fd.Fingerprint, want)
		}
	})

	t.Run("S_pieces_and_kits_silent", func(t *testing.T) {
		mustNot("S", sKit)
		mustNot("S", sPieces)
	})

	t.Run("S_unit_synonym", func(t *testing.T) {
		mustFind("S", sArea, pArea)
	})
}

// Находка по позиции ведёт на саму позицию, по строке — на позицию строки.
func TestQualityRulesRS_PositionIDOfFindings(t *testing.T) {
	pool := newTestPool(t)
	repo := NewQualityRepo(pool)
	f := newVRFixture(t, pool)

	rep := vrRun(t, repo, f.tenderID, RunTriggerView)
	u := findFinding(rep, "U", f.p1)
	if u == nil || u.EntityType != "client_position" {
		t.Fatalf("ожидалась находка U по позиции p1: %+v", u)
	}
	if u.PositionID == nil || *u.PositionID != u.EntityID {
		t.Fatalf("U: position_id = %v, ожидался entity_id %s", u.PositionID, u.EntityID)
	}
	q := findFinding(rep, "QA", f.r2)
	if q == nil || q.EntityType != "boq_item" {
		t.Fatalf("ожидалась находка QA по строке r2: %+v", q)
	}
	if q.PositionID == nil || *q.PositionID != f.p2 {
		t.Fatalf("QA: position_id = %v, ожидалась позиция %s", q.PositionID, f.p2)
	}
}
