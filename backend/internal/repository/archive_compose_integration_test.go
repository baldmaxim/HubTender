package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL-интеграция для сборки сметы из архива (кросс-тендерное копирование).
// Та же конвенция, что у остальных: newTestPool / HUBTENDER_TEST_DATABASE_URL,
// SKIP без тестовой БД.
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run ArchiveComposeIntegration -v

const archiveTestUser = "00000000-0000-0000-0000-000000000000"

type archiveFixture struct {
	srcTenderID string
	srcPosID    string
	tgtTenderID string
	tgtPosID    string
	// nextSort — явная нумерация строк источника. Без неё все строки получают
	// sort_number = 0, и порядок чтения решает случайный uuid: тест становится
	// флаки, хотя копирование работает верно.
	nextSort int
}

// seedArchiveFixture создаёт ДВА тендера: источник (архив) и цель.
func seedArchiveFixture(t *testing.T, pool *pgxpool.Pool, tag string, srcUSD, tgtUSD *float64) *archiveFixture {
	t.Helper()
	ctx := context.Background()
	f := &archiveFixture{}

	must := func(q string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, q, args...); err != nil {
			t.Fatalf("fixture exec: %v\nSQL: %s", err, q)
		}
	}
	scan := func(dst *string, q string, args ...any) {
		t.Helper()
		if err := pool.QueryRow(ctx, q, args...).Scan(dst); err != nil {
			t.Fatalf("fixture query: %v\nSQL: %s", err, q)
		}
	}

	scan(&f.srcTenderID, `INSERT INTO public.tenders (title, client_name, tender_number, usd_rate)
	                      VALUES ($1,'itest-client',$2,$3) RETURNING id::text`,
		"itest-arch-src-"+tag, "ITEST-AR-SRC-"+tag, srcUSD)
	scan(&f.tgtTenderID, `INSERT INTO public.tenders (title, client_name, tender_number, usd_rate)
	                      VALUES ($1,'itest-client',$2,$3) RETURNING id::text`,
		"itest-arch-tgt-"+tag, "ITEST-AR-TGT-"+tag, tgtUSD)

	scan(&f.srcPosID, `INSERT INTO public.client_positions (tender_id, position_number, work_name, manual_volume)
	                   VALUES ($1::uuid, 1, 'исторический источник', 100) RETURNING id::text`, f.srcTenderID)
	scan(&f.tgtPosID, `INSERT INTO public.client_positions (tender_id, position_number, work_name, manual_volume)
	                   VALUES ($1::uuid, 1, 'целевая позиция', 200) RETURNING id::text`, f.tgtTenderID)

	t.Cleanup(func() {
		for _, id := range []string{f.srcTenderID, f.tgtTenderID} {
			must(`DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, id)
			must(`DELETE FROM public.client_positions WHERE tender_id = $1::uuid`, id)
			must(`DELETE FROM public.tenders WHERE id = $1::uuid`, id)
		}
	})
	return f
}

// addArchiveItem кладёт в позицию-источник строку с ЗАВЕДОМО ИСПОРЧЕННЫМИ
// производными значениями: они не должны попасть в цель ни при каких условиях.
func (f *archiveFixture) addArchiveItem(
	t *testing.T, pool *pgxpool.Pool,
	itemType, currency string, qty, rate float64, conv, cons *float64, parentID *string,
) string {
	t.Helper()
	workNameID, matNameID := ensureTestNames(t, pool)
	var workRef, matRef *string
	if calc.IsWorkBoqType(itemType) {
		workRef = &workNameID
	} else {
		matRef = &matNameID
	}
	f.nextSort++
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
		  (client_position_id, tender_id, sort_number, boq_item_type, quantity,
		   unit_rate, currency_type,
		   delivery_price_type, conversion_coefficient, consumption_coefficient,
		   parent_work_item_id, work_name_id, material_name_id,
		   total_amount, commercial_markup,
		   total_commercial_material_cost, total_commercial_work_cost)
		VALUES ($1::uuid,$2::uuid,$3,$4::boq_item_type,$5,$6,$7::currency_type,
		        'в цене',$8,$9,$10::uuid,$11::uuid,$12::uuid,
		        999999, 777, 888888, 999999)
		RETURNING id::text`,
		f.srcPosID, f.srcTenderID, f.nextSort, itemType, qty, rate, currency, conv, cons,
		parentID, workRef, matRef,
	).Scan(&id); err != nil {
		t.Fatalf("add archive item: %v", err)
	}
	return id
}

func archiveGroupToExisting(f *archiveFixture, scale *ScaleSpec, itemIDs []string) ComposeGroup {
	return ComposeGroup{
		TempID:           "g1",
		TargetPositionID: &f.tgtPosID,
		Sources: []ComposeSource{{
			SourcePositionID: f.srcPosID,
			SourceItemIDs:    itemIDs,
			Scale:            scale,
		}},
	}
}

func archiveComposeInput(f *archiveFixture, groups []ComposeGroup, dryRun bool) ComposeInput {
	return ComposeInput{
		TargetTenderID: f.tgtTenderID,
		ChangedBy:      archiveTestUser,
		DryRun:         dryRun,
		Verbose:        true,
		Options:        ComposeOptions{OnMissingSource: OnMissingSourceFail, CopyDetailCostCategory: true},
		Groups:         groups,
	}
}

func countItems(t *testing.T, pool *pgxpool.Pool, positionID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM public.boq_items WHERE client_position_id = $1::uuid`,
		positionID).Scan(&n); err != nil {
		t.Fatalf("count items: %v", err)
	}
	return n
}

// ─── A. Курсы берутся у ЦЕЛЕВОГО тендера, производные не копируются ──────────

func TestArchiveComposeIntegration_UsesTargetTenderFXRate(t *testing.T) {
	pool := newTestPool(t)
	srcRate, tgtRate := 50.0, 100.0
	f := seedArchiveFixture(t, pool, "fx", &srcRate, &tgtRate)
	repo := NewArchiveRepo(pool)

	// USD-работа: qty 10 × rate 2 = 20 USD.
	f.addArchiveItem(t, pool, calc.BoqRab, "USD", 10, 2, nil, nil, nil)

	res, err := repo.Compose(context.Background(),
		archiveComposeInput(f, []ComposeGroup{archiveGroupToExisting(f, nil, nil)}, false))
	if err != nil {
		t.Fatalf("compose: %v", err)
	}
	if res.Totals.ItemsCreated != 1 {
		t.Fatalf("items_created = %d, want 1", res.Totals.ItemsCreated)
	}

	got := readTargetRows(t, pool, f.tgtPosID)
	if len(got) != 1 {
		t.Fatalf("целевых строк %d, want 1", len(got))
	}
	// 10 × 2 × 100 (курс ЦЕЛЕВОГО тендера), а не × 50 и не 999999 из источника.
	if got[0].total == nil || *got[0].total != 2000 {
		t.Fatalf("total_amount = %v, want 2000 по курсу целевого тендера", got[0].total)
	}
	if got[0].matCost != nil && *got[0].matCost == 888888 {
		t.Fatal("скопирована коммерческая стоимость материала источника")
	}
	if got[0].workCost != nil && *got[0].workCost == 999999 {
		t.Fatal("скопирована коммерческая стоимость работы источника")
	}
	if got[0].markup != nil && *got[0].markup == 777 {
		t.Fatal("скопирована наценка источника")
	}

	// Тендер-источник не изменился.
	var srcTotal float64
	if err := pool.QueryRow(context.Background(),
		`SELECT total_amount FROM public.boq_items WHERE client_position_id = $1::uuid`,
		f.srcPosID).Scan(&srcTotal); err != nil {
		t.Fatalf("read source: %v", err)
	}
	if srcTotal != 999999 {
		t.Fatalf("строка источника изменена: total_amount = %v", srcTotal)
	}
}

// ─── B. Нет курса у цели → fail-closed, ноль записанных строк ────────────────

func TestArchiveComposeIntegration_MissingTargetFXRateFailsClosed(t *testing.T) {
	pool := newTestPool(t)
	srcRate := 50.0
	f := seedArchiveFixture(t, pool, "nofx", &srcRate, nil)
	repo := NewArchiveRepo(pool)

	f.addArchiveItem(t, pool, calc.BoqRab, "USD", 10, 2, nil, nil, nil)

	_, err := repo.Compose(context.Background(),
		archiveComposeInput(f, []ComposeGroup{archiveGroupToExisting(f, nil, nil)}, false))

	var fxErr *calc.MissingFXRateError
	if !errors.As(err, &fxErr) {
		t.Fatalf("ожидали MissingFXRateError, получили %v", err)
	}
	if n := countItems(t, pool, f.tgtPosID); n != 0 {
		t.Fatalf("после отката в цели %d строк, want 0", n)
	}
}

// archiveRow — строка целевой позиции для проверок масштабирования.
type archiveRow struct {
	id, itemType string
	qty          *float64
	parent       *string
}

// ─── C. Масштабирование: привязанный материал пере-выводится и идемпотентен ──

func TestArchiveComposeIntegration_ScalingRederivesLinkedMaterial(t *testing.T) {
	pool := newTestPool(t)
	f := seedArchiveFixture(t, pool, "scale", nil, nil)
	repo := NewArchiveRepo(pool)
	boqRepo := NewBoqRepo(pool)

	conv, cons := 2.0, 0.5
	workID := f.addArchiveItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 10, 100, nil, nil, nil)
	f.addArchiveItem(t, pool, calc.BoqMat, calc.CurrencyRUB, 10, 50, &conv, &cons, &workID)

	// Объёмы: источник 100 → цель 200, значит k = 2.
	res, err := repo.Compose(context.Background(), archiveComposeInput(f, []ComposeGroup{
		archiveGroupToExisting(f, &ScaleSpec{Mode: ScaleModeVolumeRatio}, nil),
	}, false))
	if err != nil {
		t.Fatalf("compose: %v", err)
	}
	if len(res.Groups) != 1 || res.Groups[0].Sources[0].ScaleFactor != 2 {
		t.Fatalf("коэффициент масштабирования = %v, want 2", res.Groups[0].Sources[0].ScaleFactor)
	}

	rows, err := pool.Query(context.Background(), `
		SELECT id::text, boq_item_type::text, quantity, parent_work_item_id::text
		FROM public.boq_items WHERE client_position_id = $1::uuid ORDER BY sort_number`, f.tgtPosID)
	if err != nil {
		t.Fatalf("read target: %v", err)
	}
	var got []archiveRow
	func() {
		defer rows.Close()
		for rows.Next() {
			var r archiveRow
			if err := rows.Scan(&r.id, &r.itemType, &r.qty, &r.parent); err != nil {
				t.Fatalf("scan: %v", err)
			}
			got = append(got, r)
		}
	}()
	if len(got) != 2 {
		t.Fatalf("целевых строк %d, want 2", len(got))
	}

	// Ищем по типу, а не по позиции в срезе: порядок — деталь реализации.
	var workRow, matRow *archiveRow
	for i := range got {
		if calc.IsWorkBoqType(got[i].itemType) {
			workRow = &got[i]
		} else {
			matRow = &got[i]
		}
	}
	if workRow == nil || matRow == nil {
		t.Fatalf("ожидали одну работу и один материал, получили %+v", got)
	}
	if workRow.qty == nil || *workRow.qty != 20 {
		t.Fatalf("работа: 10*2 = 20, получили %v", workRow.qty)
	}
	// Пере-вывод из масштабированного родителя: 20*2*0.5 = 20.
	if matRow.qty == nil || *matRow.qty != 20 {
		t.Fatalf("привязанный материал: 20*2*0.5 = 20, получили %v", matRow.qty)
	}
	if matRow.parent == nil || *matRow.parent != workRow.id {
		t.Fatalf("связь материал→работа не переехала на целевые uuid: %v", matRow.parent)
	}
	if workRow.parent != nil {
		t.Fatalf("у работы не может быть родителя, получили %v", workRow.parent)
	}

	// Идемпотентность: штатный пересчёт связанных материалов ничего не меняет.
	if _, err := boqRepo.RecomputeLinkedMaterialsForWork(
		context.Background(), workRow.id, archiveTestUser,
	); err != nil {
		t.Fatalf("recompute linked materials: %v", err)
	}
	var after float64
	if err := pool.QueryRow(context.Background(),
		`SELECT quantity FROM public.boq_items WHERE id = $1::uuid`, matRow.id).Scan(&after); err != nil {
		t.Fatalf("read child: %v", err)
	}
	if after != 20 {
		t.Fatalf("повторный пересчёт изменил количество: %v, want 20", after)
	}
}

// ─── D. Подмножество без родительской работы — блокирующая ошибка ────────────

func TestArchiveComposeIntegration_SubsetWithoutParentIsBlocked(t *testing.T) {
	pool := newTestPool(t)
	f := seedArchiveFixture(t, pool, "parent", nil, nil)
	repo := NewArchiveRepo(pool)

	workID := f.addArchiveItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 10, 100, nil, nil, nil)
	matID := f.addArchiveItem(t, pool, calc.BoqMat, calc.CurrencyRUB, 10, 50, nil, nil, &workID)

	// Берём только материал — его родитель в набор не попал.
	_, err := repo.Compose(context.Background(), archiveComposeInput(f, []ComposeGroup{
		archiveGroupToExisting(f, nil, []string{matID}),
	}, false))

	var parentErr *InvalidBoqParentError
	if !errors.As(err, &parentErr) {
		t.Fatalf("ожидали InvalidBoqParentError, получили %v", err)
	}
	if n := countItems(t, pool, f.tgtPosID); n != 0 {
		t.Fatalf("после отката в цели %d строк, want 0", n)
	}
}

// ─── E. dry_run: ничего не записано, итоги совпадают с реальным прогоном ─────

func TestArchiveComposeIntegration_DryRunWritesNothing(t *testing.T) {
	pool := newTestPool(t)
	f := seedArchiveFixture(t, pool, "dryrun", nil, nil)
	repo := NewArchiveRepo(pool)

	f.addArchiveItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 10, 100, nil, nil, nil)

	dry, err := repo.Compose(context.Background(),
		archiveComposeInput(f, []ComposeGroup{archiveGroupToExisting(f, nil, nil)}, true))
	if err != nil {
		t.Fatalf("dry-run compose: %v", err)
	}
	if !dry.DryRun {
		t.Fatal("ответ должен быть помечен dry_run")
	}
	if n := countItems(t, pool, f.tgtPosID); n != 0 {
		t.Fatalf("dry_run записал %d строк, want 0", n)
	}
	if len(dry.Groups[0].Items) != 1 || dry.Groups[0].Items[0].NewItemID != "" {
		t.Fatal("в dry_run id новых строк отдавать нельзя")
	}
	if dry.Groups[0].Items[0].TotalAmount == nil || *dry.Groups[0].Items[0].TotalAmount != 1000 {
		t.Fatalf("dry_run должен показывать посчитанную сумму 1000, получили %v",
			dry.Groups[0].Items[0].TotalAmount)
	}

	real, err := repo.Compose(context.Background(),
		archiveComposeInput(f, []ComposeGroup{archiveGroupToExisting(f, nil, nil)}, false))
	if err != nil {
		t.Fatalf("real compose: %v", err)
	}
	if real.Totals != dry.Totals {
		t.Fatalf("итоги реального прогона %+v не совпали с dry_run %+v", real.Totals, dry.Totals)
	}
	if real.CachedGrandTotal != dry.CachedGrandTotal {
		t.Fatalf("cached_grand_total: real %q, dry %q", real.CachedGrandTotal, dry.CachedGrandTotal)
	}
	if n := countItems(t, pool, f.tgtPosID); n != 1 {
		t.Fatalf("после реального прогона %d строк, want 1", n)
	}
}

// ─── F. Создание новой целевой позиции ──────────────────────────────────────

func TestArchiveComposeIntegration_CreatesNewTargetPosition(t *testing.T) {
	pool := newTestPool(t)
	f := seedArchiveFixture(t, pool, "newpos", nil, nil)
	repo := NewArchiveRepo(pool)

	f.addArchiveItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 4, 25, nil, nil, nil)

	unit := "м2"
	volume := 50.0
	res, err := repo.Compose(context.Background(), archiveComposeInput(f, []ComposeGroup{{
		TempID: "g-new",
		NewPosition: &NewTargetPosition{
			WorkName: "новая позиция из архива", UnitCode: &unit,
			Volume: &volume, ManualVolume: &volume,
		},
		Sources: []ComposeSource{{SourcePositionID: f.srcPosID}},
	}}, false))
	if err != nil {
		t.Fatalf("compose: %v", err)
	}
	if !res.Groups[0].PositionCreated || res.Groups[0].TargetPositionID == "" {
		t.Fatalf("позиция должна быть создана: %+v", res.Groups[0])
	}
	if res.Totals.PositionsCreated != 1 {
		t.Fatalf("positions_created = %d, want 1", res.Totals.PositionsCreated)
	}
	if n := countItems(t, pool, res.Groups[0].TargetPositionID); n != 1 {
		t.Fatalf("в новой позиции %d строк, want 1", n)
	}

	// Номер позиции автоматический: в целевом тендере уже была позиция №1.
	var number float64
	if err := pool.QueryRow(context.Background(),
		`SELECT position_number FROM public.client_positions WHERE id = $1::uuid`,
		res.Groups[0].TargetPositionID).Scan(&number); err != nil {
		t.Fatalf("read position number: %v", err)
	}
	if number != 2 {
		t.Fatalf("автоматический номер позиции = %v, want 2", number)
	}
}

// ─── G. Целевая позиция из чужого тендера ───────────────────────────────────

func TestArchiveComposeIntegration_TargetFromAnotherTenderRejected(t *testing.T) {
	pool := newTestPool(t)
	f := seedArchiveFixture(t, pool, "scope", nil, nil)
	repo := NewArchiveRepo(pool)

	f.addArchiveItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 1, 1, nil, nil, nil)

	// Целью указана позиция ТЕНДЕРА-ИСТОЧНИКА.
	_, err := repo.Compose(context.Background(), archiveComposeInput(f, []ComposeGroup{{
		TempID:           "g1",
		TargetPositionID: &f.srcPosID,
		Sources:          []ComposeSource{{SourcePositionID: f.srcPosID}},
	}}, false))

	var scopeErr *ArchiveTargetScopeError
	if !errors.As(err, &scopeErr) {
		t.Fatalf("ожидали ArchiveTargetScopeError, получили %v", err)
	}
}
