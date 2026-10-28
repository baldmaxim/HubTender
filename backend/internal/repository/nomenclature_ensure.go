package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Виды наименований для EnsureNames.
const (
	NameKindWork     = "work"
	NameKindMaterial = "material"
)

// EnsureNameItem — одно наименование запроса «найти или создать».
type EnsureNameItem struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	Unit string `json:"unit"`
}

// EnsureNameResult — итог по элементу запроса (в порядке запроса).
type EnsureNameResult struct {
	Index   int    `json:"index"`
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Name    string `json:"name"`
	Unit    string `json:"unit"`
	Created bool   `json:"created"`
}

// NormalizeName — trim и схлопывание подряд идущих пробельных символов в один.
func NormalizeName(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// ensureLockKey — ключ advisory-блокировки: параллельные «ensure» выстраиваются
// в очередь, иначе два запроса с одним новым именем вставили бы его дважды
// (уникального индекса на name нет).
const ensureLockKey = int64(0x6e6f6d656e63) // "nomenc"

// EnsureNames для каждого элемента ищет наименование того же вида с той же
// единицей и тем же именем (без регистра, пробелы схлопнуты) и возвращает его
// id; если нет — создаёт. Всё в одной транзакции: ошибка откатывает все вставки.
// Имена элементов должны быть уже нормализованы (NormalizeName); одинаковые
// элементы внутри запроса дают одну вставку — второй находит первую в той же
// транзакции.
func (r *NomenclaturesRepo) EnsureNames(ctx context.Context, items []EnsureNameItem) ([]EnsureNameResult, error) {
	return ensureNamesPool(ctx, r.pool, items)
}

func ensureNamesPool(ctx context.Context, pool *pgxpool.Pool, items []EnsureNameItem) (res []EnsureNameResult, err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("nomenclaturesRepo.EnsureNames begin: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, ensureLockKey); err != nil {
		return nil, fmt.Errorf("nomenclaturesRepo.EnsureNames lock: %w", err)
	}
	res = make([]EnsureNameResult, 0, len(items))
	for i, it := range items {
		var table string
		switch it.Kind {
		case NameKindWork:
			table = tableWorks
		case NameKindMaterial:
			table = tableMaterials
		default:
			return nil, fmt.Errorf("nomenclaturesRepo.EnsureNames: item %d: unknown kind %q", i, it.Kind)
		}
		out, e := ensureOne(ctx, tx, table, it)
		if e != nil {
			err = fmt.Errorf("nomenclaturesRepo.EnsureNames item %d: %w", i, e)
			return nil, err
		}
		out.Index, out.Kind = i, it.Kind
		res = append(res, out)
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("nomenclaturesRepo.EnsureNames commit: %w", err)
	}
	return res, nil
}

func ensureOne(ctx context.Context, tx pgx.Tx, table string, it EnsureNameItem) (EnsureNameResult, error) {
	var out EnsureNameResult
	// Давний дубль (если есть) предпочтительнее: детерминированный выбор.
	err := tx.QueryRow(ctx, fmt.Sprintf(`
		SELECT id::text, name, unit::text FROM %s
		WHERE unit = $2
		  AND lower(regexp_replace(btrim(name), '\s+', ' ', 'g')) = lower(regexp_replace(btrim($1), '\s+', ' ', 'g'))
		ORDER BY created_at NULLS LAST, id
		LIMIT 1
	`, table), it.Name, it.Unit).Scan(&out.ID, &out.Name, &out.Unit)
	if err == nil {
		return out, nil
	}
	if err != pgx.ErrNoRows {
		return out, fmt.Errorf("select: %w", err)
	}
	if err := tx.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %s (name, unit) VALUES ($1, $2) RETURNING id::text, name, unit::text
	`, table), it.Name, it.Unit).Scan(&out.ID, &out.Name, &out.Unit); err != nil {
		return out, fmt.Errorf("insert: %w", err)
	}
	out.Created = true
	return out, nil
}
