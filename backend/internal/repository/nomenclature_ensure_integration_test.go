package repository

import (
	"context"
	"testing"
)

// PostgreSQL integration tests для EnsureNames. SKIPPED без HUBTENDER_TEST_DATABASE_URL.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run NomenclatureEnsure -v

func TestNormalizeName(t *testing.T) {
	if got := NormalizeName("  a \t b  c  "); got != "a b c" {
		t.Fatalf("got %q", got)
	}
}

func ensureCleanup(t *testing.T, r *NomenclaturesRepo, like string) {
	t.Helper()
	ctx := context.Background()
	for _, table := range []string{tableWorks, tableMaterials} {
		if _, err := r.pool.Exec(ctx, `DELETE FROM `+table+` WHERE name LIKE $1`, like); err != nil {
			t.Fatalf("cleanup %s: %v", table, err)
		}
	}
}

func countNames(t *testing.T, r *NomenclaturesRepo, table, like string) int {
	t.Helper()
	var n int
	if err := r.pool.QueryRow(context.Background(), `SELECT count(*) FROM `+table+` WHERE name LIKE $1`, like).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func TestNomenclatureEnsureIntegration(t *testing.T) {
	pool := newTestPool(t)
	r := NewNomenclaturesRepo(pool)
	const like = "%itest-ensure%"
	ensureCleanup(t, r, like)
	t.Cleanup(func() { ensureCleanup(t, r, like) })
	ctx := context.Background()
	for _, u := range []string{"м2", "м3"} {
		if _, err := pool.Exec(ctx, `INSERT INTO public.units (code, name) VALUES ($1, $1) ON CONFLICT DO NOTHING`, u); err != nil {
			t.Fatalf("seed unit: %v", err)
		}
	}

	items := []EnsureNameItem{
		{Kind: NameKindWork, Name: "itest-ensure Стяжка", Unit: "м2"},
		{Kind: NameKindMaterial, Name: "itest-ensure Цемент", Unit: "м3"},
	}
	first, err := r.EnsureNames(ctx, items)
	if err != nil || len(first) != 2 || !first[0].Created || !first[1].Created || first[0].Index != 0 || first[1].Kind != NameKindMaterial {
		t.Fatalf("первый вызов: %v %+v", err, first)
	}

	// Повтор: те же id, created=false, дублей нет.
	second, err := r.EnsureNames(ctx, items)
	if err != nil || second[0].Created || second[1].Created || second[0].ID != first[0].ID || second[1].ID != first[1].ID {
		t.Fatalf("повтор: %v %+v", err, second)
	}
	if n := countNames(t, r, tableWorks, like); n != 1 {
		t.Fatalf("work_names: %d строк", n)
	}

	// Регистр и пробелы: то же имя (нормализация делает сервис, поиск — БД по обеим сторонам).
	if _, err := pool.Exec(ctx, `INSERT INTO `+tableWorks+` (name, unit) VALUES ('  itest-ensure   ШТУКАТУРКА ', 'м2')`); err != nil {
		t.Fatal(err)
	}
	third, err := r.EnsureNames(ctx, []EnsureNameItem{{Kind: NameKindWork, Name: "itest-ensure штукатурка", Unit: "м2"}})
	if err != nil || third[0].Created || third[0].Name != "  itest-ensure   ШТУКАТУРКА " {
		t.Fatalf("регистр/пробелы: %v %+v", err, third)
	}

	// Другая единица или другой вид — новое имя.
	other, err := r.EnsureNames(ctx, []EnsureNameItem{
		{Kind: NameKindWork, Name: "itest-ensure Стяжка", Unit: "м3"},
		{Kind: NameKindMaterial, Name: "itest-ensure Стяжка", Unit: "м2"},
	})
	if err != nil || !other[0].Created || !other[1].Created || other[0].ID == first[0].ID {
		t.Fatalf("другая единица/вид: %v %+v", err, other)
	}

	// Одинаковые элементы внутри запроса — одна вставка.
	dup, err := r.EnsureNames(ctx, []EnsureNameItem{
		{Kind: NameKindWork, Name: "itest-ensure Дубль", Unit: "м2"},
		{Kind: NameKindWork, Name: "ITEST-ENSURE   дубль", Unit: "м2"},
	})
	if err != nil || !dup[0].Created || dup[1].Created || dup[0].ID != dup[1].ID {
		t.Fatalf("дубль в запросе: %v %+v", err, dup)
	}
	if n := countNames(t, r, tableWorks, "itest-ensure Дубль"); n != 1 {
		t.Fatalf("дубль в запросе: %d строк", n)
	}

	// Ошибка в середине (единицы нет в справочнике -> FK) откатывает всё.
	_, err = r.EnsureNames(ctx, []EnsureNameItem{
		{Kind: NameKindWork, Name: "itest-ensure Откат", Unit: "м2"},
		{Kind: NameKindWork, Name: "itest-ensure Откат 2", Unit: "нет-такой"},
	})
	if err == nil {
		t.Fatal("ожидалась ошибка FK")
	}
	if n := countNames(t, r, tableWorks, "itest-ensure Откат%"); n != 0 {
		t.Fatalf("транзакция не откатилась: %d строк", n)
	}
}
