//go:build integration

package services

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Поиск аналогов на реальной БД. Только изолированная тестовая БД:
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_analog_test?sslmode=disable' \
//	  go test -tags=integration ./internal/services/ -run AnalogIntegration -v

func analogTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("HUBTENDER_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("HUBTENDER_TEST_DATABASE_URL не задан — интеграционный тест пропущен")
	}
	name := dsn
	if i := strings.IndexByte(name, '?'); i >= 0 {
		name = name[:i]
	}
	name = name[strings.LastIndexByte(name, '/')+1:]
	if !strings.Contains(strings.ToLower(name), "test") {
		t.Fatalf("имя БД %q не содержит \"test\": деструктивные фикстуры отклонены", name)
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestAnalogIntegration_SearchCandidatesHasMoreAndUnitNotFiltered(t *testing.T) {
	pool := analogTestPool(t)
	ctx := context.Background()
	const name = "Устройство монолитной плиты перекрытия бетон В25 толщиной 200 мм"
	tag := fmt.Sprintf("%d", os.Getpid())

	scan := func(q string, args ...any) string {
		t.Helper()
		var s string
		if err := pool.QueryRow(ctx, q, args...).Scan(&s); err != nil {
			t.Fatalf("fixture: %v\n%s", err, q)
		}
		return s
	}
	var tenders []string
	t.Cleanup(func() {
		for _, id := range tenders {
			_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, id)
			_, _ = pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id = $1::uuid`, id)
			_, _ = pool.Exec(ctx, `DELETE FROM public.tenders WHERE id = $1::uuid`, id)
		}
	})
	mkTender := func(n string) string {
		id := scan(`INSERT INTO public.tenders (title, client_name, tender_number) VALUES ($1, 'itest-client', $2) RETURNING id::text`,
			"itest-an-search-"+n, "ITEST-ANS-"+tag+"-"+n)
		tenders = append(tenders, id)
		return id
	}
	workName := scan(`INSERT INTO public.work_names (name, unit) VALUES ($1, 'м2') RETURNING id::text`, "itest-an-search-work-"+tag)
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM public.work_names WHERE id = $1::uuid`, workName) })
	mkPos := func(tender, unit string, withRow bool, work string) string {
		id := scan(`INSERT INTO public.client_positions (tender_id, position_number, work_name, unit_code, manual_volume)
		            VALUES ($1::uuid, 1, $2, $3, 100) RETURNING id::text`, tender, work, unit)
		if withRow {
			if _, err := pool.Exec(ctx, `INSERT INTO public.boq_items (tender_id, client_position_id, sort_number, boq_item_type, work_name_id, quantity, unit_rate, currency_type)
			        VALUES ($1::uuid, $2::uuid, 1, 'раб', $3::uuid, 1, 1, 'RUB')`, tender, id, workName); err != nil {
				t.Fatalf("boq row: %v", err)
			}
		}
		return id
	}

	target := mkTender("target")
	targetPos := mkPos(target, "м3", false, name)
	// Кандидаты: три в той же единице, один — в другой (конфликт единиц остаётся в выдаче).
	mkPos(mkTender("c1"), "м3", true, name)
	mkPos(mkTender("c2"), "м3", true, name+" армированная")
	mkPos(mkTender("c3"), "м3", true, "Монолитная плита перекрытия бетон В25 200 мм")
	conflictPos := mkPos(mkTender("c4"), "м2", true, name)
	mkPos(mkTender("c5"), "м3", false, name) // без строк — не кандидат
	// Позиция того же тендера с тем же названием не должна попасть в выдачу.
	selfSibling := mkPos(target, "м3", true, name)
	if _, err := pool.Exec(ctx, `UPDATE public.client_positions SET position_number = 2 WHERE id = $1::uuid`, selfSibling); err != nil {
		t.Fatal(err)
	}

	svc := NewAnalogService(repository.NewAnalogRepo(pool),
		NewArchiveService(repository.NewArchiveRepo(pool), cache.New()), cache.New())

	resp, err := svc.Search(ctx, targetPos, "", 3)
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(resp.Hits) != 3 || !resp.HasMore {
		t.Fatalf("limit=3: hits=%d has_more=%v (кандидатов 4 → нужно 3 и has_more)", len(resp.Hits), resp.HasMore)
	}
	if resp.Query != name || resp.Target == nil || resp.Target.PositionID != targetPos {
		t.Fatalf("query/target: %q %+v", resp.Query, resp.Target)
	}

	resp, err = svc.Search(ctx, targetPos, "", 30)
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.Hits) != 4 || resp.HasMore {
		t.Fatalf("limit=30: hits=%d has_more=%v, want 4 и без has_more", len(resp.Hits), resp.HasMore)
	}
	foundConflict := false
	for _, h := range resp.Hits {
		if h.TenderID == target || h.PositionID == selfSibling || h.PositionID == targetPos {
			t.Fatalf("в выдаче позиция исключённого тендера: %+v", h)
		}
		if h.PositionID == conflictPos {
			foundConflict = true
			if h.UnitCompatibility != "conflict" {
				t.Fatalf("unit_compatibility = %q, want conflict", h.UnitCompatibility)
			}
		}
		if h.ItemsCount != 1 || h.TenderNumber == nil || h.TenderVersion == nil {
			t.Fatalf("поля попадания: %+v", h)
		}
	}
	if !foundConflict {
		t.Fatal("кандидат с другой единицей отфильтрован на уровне SQL")
	}
}
