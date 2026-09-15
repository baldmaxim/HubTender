package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests: разделы ВОР из иерархии позиций и отметки
// готовности с хешем содержимого.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run VerificationSectionsIntegration -v

type vsFixture struct {
	vr                          *vrFixture
	p0, h1, sub, l3, l4, h5, l6 string
	add                         string
	rowL3                       string
}

func vsPosition(t *testing.T, pool *pgxpool.Pool, tenderID string, num float64, itemNo, name string,
	level int, volume, manualVolume float64, note *string, additional bool) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.client_positions
			(tender_id, position_number, item_no, work_name, unit_code, volume, manual_volume,
			 manual_note, hierarchy_level, is_additional)
		VALUES ($1, $2, $3, $4, 'м2', $5, $6, $7, $8, $9)
		RETURNING id::text`,
		tenderID, num, itemNo, name, volume, manualVolume, note, level, additional).Scan(&id); err != nil {
		t.Fatalf("position %s: %v", itemNo, err)
	}
	return id
}

// Структура:
//
//	0   (ур.0) позиция до первого заголовка        → раздел none
//	1   (ур.0) «Общестрой»                          → заголовок раздела
//	1.1 (ур.1) подраздел                            → сворачивается в «Общестрой»
//	1.1.1 (ур.2) расценена
//	1.1.2 (ур.2) не расценена, без примечания
//	2   (ур.0) «Фасады»                             → заголовок раздела
//	2.1 (ур.1) расценена, Кол-во ГП = 0
//	ДОП        дополнительная позиция               → раздел additional
func newVSFixture(t *testing.T, pool *pgxpool.Pool) *vsFixture {
	t.Helper()
	ctx := context.Background()
	workID, _ := ensureTestNames(t, pool)
	f := &vsFixture{vr: &vrFixture{workID: workID}}
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders (title, client_name, tender_number)
		VALUES ('itest sections', 'itest', 'itest-vs-' || gen_random_uuid()::text)
		RETURNING id::text`).Scan(&f.vr.tenderID); err != nil {
		t.Fatalf("tender: %v", err)
	}
	tid := f.vr.tenderID
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.tenders WHERE id = $1`, tid)
	})

	f.p0 = vsPosition(t, pool, tid, 1, "0", "до заголовка", 0, 5, 5, nil, false)
	f.h1 = vsPosition(t, pool, tid, 2, "1", "Общестрой", 0, 0, 0, nil, false)
	f.sub = vsPosition(t, pool, tid, 3, "1.1", "Подраздел", 1, 0, 0, nil, false)
	f.l3 = vsPosition(t, pool, tid, 4, "1.1.1", "Кладка", 2, 10, 10, nil, false)
	f.l4 = vsPosition(t, pool, tid, 5, "1.1.2", "Штукатурка", 2, 10, 0, nil, false)
	f.h5 = vsPosition(t, pool, tid, 6, "2", "Фасады", 0, 0, 0, nil, false)
	f.l6 = vsPosition(t, pool, tid, 7, "2.1", "Облицовка", 1, 20, 0, nil, false)
	f.add = vsPosition(t, pool, tid, 8, "ДОП-1", "Доп. работы", 0, 1, 1, nil, true)

	f.rowL3 = vrRow(t, pool, f.vr, f.l3, 10, 100)
	vrRow(t, pool, f.vr, f.l6, 20, 50)
	return f
}

func sectionByKey(s *TenderSections, key string) *TenderSection {
	for i := range s.Sections {
		if s.Sections[i].Key == key {
			return &s.Sections[i]
		}
	}
	return nil
}

func TestVerificationSectionsIntegration_StructureAndMarks(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewVerificationSectionsRepo(pool)
	f := newVSFixture(t, pool)
	tid := f.vr.tenderID
	actives := []string{"H", "Q"}

	res, err := repo.Load(ctx, tid, actives)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Sections) != 4 {
		t.Fatalf("ожидалось 4 раздела (none, Общестрой, Фасады, additional), получено %d: %+v", len(res.Sections), res.Sections)
	}
	none, s1, s2, add := sectionByKey(res, "none"), sectionByKey(res, "h:"+f.h1),
		sectionByKey(res, "h:"+f.h5), sectionByKey(res, "additional")
	if none == nil || s1 == nil || s2 == nil || add == nil {
		t.Fatalf("не найдены ожидаемые ключи разделов: %+v", res.Sections)
	}
	if s1.Title != "1 Общестрой" {
		t.Errorf("заголовок раздела = %q", s1.Title)
	}
	// Подраздел 1.1 — заголовок, не конечная позиция: в раздел «Общестрой»
	// входят две конечные позиции.
	if s1.Positions != 2 || s1.Priced != 1 || s1.UnpricedNoReason != 1 || s1.PricedNoGP != 0 {
		t.Errorf("Общестрой: positions=%d priced=%d unpriced_no_reason=%d priced_no_gp=%d",
			s1.Positions, s1.Priced, s1.UnpricedNoReason, s1.PricedNoGP)
	}
	if s2.Positions != 1 || s2.PricedNoGP != 1 || s2.TotalAmount != 1000 {
		t.Errorf("Фасады: positions=%d priced_no_gp=%d total=%v", s2.Positions, s2.PricedNoGP, s2.TotalAmount)
	}
	if none.Positions != 1 || add.Positions != 1 {
		t.Errorf("none=%d additional=%d", none.Positions, add.Positions)
	}
	if s1.Pricing.Status != SectionStatusNone {
		t.Fatalf("без отметки статус = %q", s1.Pricing.Status)
	}

	// Отметка с устаревшим хешем отклоняется, с неизвестным ключом — тоже.
	if err := repo.Mark(ctx, tid, s1.Key, SectionStagePricing, "stale", nil, nil); !errors.Is(err, ErrSectionChanged) {
		t.Fatalf("устаревший хеш: %v", err)
	}
	if err := repo.Mark(ctx, tid, "h:00000000-0000-0000-0000-000000000000", SectionStagePricing, s1.ContentHash, nil, nil); !errors.Is(err, ErrSectionNotFound) {
		t.Fatalf("неизвестный раздел: %v", err)
	}

	note := "расценено"
	if err := repo.Mark(ctx, tid, s1.Key, SectionStagePricing, s1.ContentHash, &note, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.Mark(ctx, tid, s2.Key, SectionStageReview, s2.ContentHash, nil, nil); err != nil {
		t.Fatal(err)
	}

	res, err = repo.Load(ctx, tid, actives)
	if err != nil {
		t.Fatal(err)
	}
	s1, s2 = sectionByKey(res, s1.Key), sectionByKey(res, s2.Key)
	if s1.Pricing.Status != SectionStatusMarked || s1.Pricing.Note == nil || *s1.Pricing.Note != note {
		t.Fatalf("Общестрой после отметки: %+v", s1.Pricing)
	}
	if s1.Review.Status != SectionStatusNone || s2.Review.Status != SectionStatusMarked {
		t.Fatal("отметки этапов перепутаны")
	}

	// Пересчёт коммерческих сумм не правка расчёта: отметка остаётся.
	if _, err := pool.Exec(ctx, `UPDATE public.boq_items
		SET total_commercial_work_cost = 12345, commercial_markup = 1.5
		WHERE client_position_id = $1`, f.l6); err != nil {
		t.Fatal(err)
	}
	// Правка цены в «Общестрое» — раздел меняется после отметки.
	if _, err := pool.Exec(ctx, `UPDATE public.boq_items SET unit_rate = 120, total_amount = 1200
		WHERE id = $1`, f.rowL3); err != nil {
		t.Fatal(err)
	}

	res, err = repo.Load(ctx, tid, actives)
	if err != nil {
		t.Fatal(err)
	}
	s1, s2 = sectionByKey(res, s1.Key), sectionByKey(res, s2.Key)
	if s2.Review.Status != SectionStatusMarked {
		t.Fatalf("пересчёт наценок снял отметку «Фасадов»: %+v", s2.Review)
	}
	if s1.Pricing.Status != SectionStatusChanged || s1.Pricing.Changes == nil {
		t.Fatalf("правка цены не перевела «Общестрой» в changed: %+v", s1.Pricing)
	}
	if s1.Pricing.Changes.RowEdits < 1 || s1.Pricing.Changes.LastChangeAt == nil {
		t.Fatalf("правки после отметки не посчитаны: %+v", s1.Pricing.Changes)
	}

	// Правка поля позиции (примечание ГП) тоже меняет хеш раздела.
	if _, err := pool.Exec(ctx, `UPDATE public.client_positions SET manual_note = 'не наш объём' WHERE id = $1`, f.l6); err != nil {
		t.Fatal(err)
	}
	res, err = repo.Load(ctx, tid, actives)
	if err != nil {
		t.Fatal(err)
	}
	if sectionByKey(res, s2.Key).Review.Status != SectionStatusChanged {
		t.Fatal("правка примечания ГП не изменила раздел")
	}

	// Снятие отметки.
	if err := repo.Unmark(ctx, tid, s1.Key, SectionStagePricing, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.Unmark(ctx, tid, s1.Key, SectionStagePricing, nil); err != nil {
		t.Fatalf("повторное снятие должно быть безопасным: %v", err)
	}
	res, err = repo.Load(ctx, tid, actives)
	if err != nil {
		t.Fatal(err)
	}
	if sectionByKey(res, s1.Key).Pricing.Status != SectionStatusNone {
		t.Fatal("отметка не снята")
	}

	var events int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.verification_section_events WHERE tender_id = $1`,
		tid).Scan(&events); err != nil || events != 3 {
		t.Fatalf("событий = %d (%v), ожидалось 3 (2 отметки + 1 снятие)", events, err)
	}
}

// Счётчики находок раздела берутся из сохранённого прогона и не учитывают
// принятые находки.
func TestVerificationSectionsIntegration_FindingCounts(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewVerificationSectionsRepo(pool)
	quality := NewQualityRepo(pool)
	f := newVSFixture(t, pool)
	tid := f.vr.tenderID

	rep, perr, err := quality.RunAndPersist(ctx, tid, RunTriggerView, nil)
	if err != nil || perr != nil {
		t.Fatalf("прогон: %v / %v", err, perr)
	}
	res, err := repo.Load(ctx, tid, []string{"H"})
	if err != nil {
		t.Fatal(err)
	}
	if !res.FindingsAvailable {
		t.Fatal("счётчики находок недоступны")
	}
	s2 := sectionByKey(res, "h:"+f.h5)
	if s2.OpenWarnings != 1 {
		t.Fatalf("у «Фасадов» ожидалась 1 находка H, получено %d", s2.OpenWarnings)
	}

	h := findFinding(rep, "H", f.l6)
	if h == nil {
		t.Fatal("нет находки H по позиции 2.1")
	}
	if err := quality.SetVerdict(ctx, tid, "H", f.l6, h.Fingerprint, "accepted", nil, nil); err != nil {
		t.Fatal(err)
	}
	res, err = repo.Load(ctx, tid, []string{"H"})
	if err != nil {
		t.Fatal(err)
	}
	if got := sectionByKey(res, "h:"+f.h5).OpenWarnings; got != 0 {
		t.Fatalf("принятая находка всё ещё считается: %d", got)
	}
}
