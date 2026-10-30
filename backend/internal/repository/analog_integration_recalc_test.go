//go:build integration

package repository

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Паритет узкого пересчёта аналога (ComposeRecalcTargetOnly/Preview) с полным
// тендерным: после применения/отмены повторный полный пересчёт старыми функциями
// не должен ничего менять в тендере.

// anRecalcFix — фикстура аналога плюс тактика наценок у цели и две соседние
// позиции со строками (их итоги и коммерция должны остаться на месте).
func anRecalcSetup(t *testing.T, tag string) *anFix {
	t.Helper()
	f := anSetup(t, tag, nil, nil)
	ctx := context.Background()

	// Строка источника с нулевой ценой: её коммерческие суммы нулевые, но
	// commercial_markup всё равно обязан быть записан (как в полном пути).
	f.arch.addArchiveItem(t, f.pool, calc.BoqMat, calc.CurrencyRUB, 5, 0, nil, nil, nil)

	var tacticID string
	if err := f.pool.QueryRow(ctx, `
		INSERT INTO public.markup_tactics (name, sequences)
		VALUES ('itest recalc tactic', '{
		  "раб":     [{"baseIndex": -1, "action1": "multiply", "operand1Type": "number", "operand1Key": 1.3}],
		  "мат":     [{"baseIndex": -1, "action1": "multiply", "operand1Type": "number", "operand1Key": 1.1}],
		  "суб-раб": [{"baseIndex": -1, "action1": "multiply", "operand1Type": "number", "operand1Key": 1.05}]
		}'::jsonb) RETURNING id::text`).Scan(&tacticID); err != nil {
		t.Fatalf("tactic: %v", err)
	}
	t.Cleanup(func() {
		_, _ = f.pool.Exec(ctx, `UPDATE public.tenders SET markup_tactic_id = NULL WHERE markup_tactic_id = $1::uuid`, tacticID)
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.markup_tactics WHERE id = $1::uuid`, tacticID)
	})
	f.exec(`UPDATE public.tenders SET markup_tactic_id = $1::uuid WHERE id = $2::uuid`, tacticID, f.arch.tgtTenderID)

	// Соседние позиции цели.
	workName, matName := ensureTestNames(t, f.pool)
	for n := 2; n <= 3; n++ {
		posID := f.str(`INSERT INTO public.client_positions (tender_id, position_number, work_name, manual_volume, unit_code)
		                VALUES ($1::uuid, $2, 'соседняя позиция', 10, 'м2') RETURNING id::text`, f.arch.tgtTenderID, n)
		workID := f.str(`INSERT INTO public.boq_items
		  (tender_id, client_position_id, sort_number, boq_item_type, work_name_id, quantity, unit_rate, currency_type, total_amount)
		  VALUES ($1::uuid, $2::uuid, 1, 'раб', $3::uuid, 3, 50, 'RUB', 150) RETURNING id::text`,
			f.arch.tgtTenderID, posID, workName)
		f.exec(`INSERT INTO public.boq_items
		  (tender_id, client_position_id, sort_number, boq_item_type, material_name_id, parent_work_item_id,
		   quantity, unit_rate, currency_type, total_amount)
		  VALUES ($1::uuid, $2::uuid, 2, 'мат', $3::uuid, $4::uuid, 4, 25, 'RUB', 100)`,
			f.arch.tgtTenderID, posID, matName, workID)
	}
	f.exec(`UPDATE public.client_positions SET manual_volume = 200 WHERE id = $1::uuid`, f.arch.tgtPosID)

	// Согласованное исходное состояние: полный пересчёт старыми функциями.
	f.fullRecalc()
	return f
}

// fullRecalc — эталон: тендерные функции старого пути в отдельной транзакции.
func (f *anFix) fullRecalc() {
	f.t.Helper()
	ctx := context.Background()
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		f.t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if err := setAuditUser(ctx, tx, archiveTestUser); err != nil {
		f.t.Fatal(err)
	}
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		f.t.Fatal(err)
	}
	tid := f.arch.tgtTenderID
	if err := RecomputePositionTotalsForTenderTx(ctx, tx, tid); err != nil {
		f.t.Fatalf("positions: %v", err)
	}
	if err := MaterializeCommercialForTenderTx(ctx, tx, tid); err != nil {
		f.t.Fatalf("commercial: %v", err)
	}
	if _, err := RecalculateTenderGrandTotalTx(ctx, tx, tid); err != nil {
		f.t.Fatalf("grand total: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		f.t.Fatalf("commit: %v", err)
	}
}

// snapshot — все производные суммы тендера одним текстом (numeric без хвостовых нулей).
func (f *anFix) snapshot() string {
	f.t.Helper()
	tid := f.arch.tgtTenderID
	items := f.str(`SELECT COALESCE(string_agg(
	    id::text || '|' || COALESCE(trim_scale(total_amount)::text, '~') || '|' ||
	    COALESCE(trim_scale(commercial_markup)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_commercial_material_cost)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_commercial_work_cost)::text, '~'), E'\n' ORDER BY id), '')
	  FROM public.boq_items WHERE tender_id = $1::uuid`, tid)
	positions := f.str(`SELECT COALESCE(string_agg(
	    id::text || '|' || COALESCE(trim_scale(total_material)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_works)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_commercial_material)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_commercial_work)::text, '~'), E'\n' ORDER BY id), '')
	  FROM public.client_positions WHERE tender_id = $1::uuid`, tid)
	grand := f.str(`SELECT COALESCE(trim_scale(cached_grand_total)::text, '~') FROM public.tenders WHERE id = $1::uuid`, tid)
	return "ITEMS\n" + items + "\nPOSITIONS\n" + positions + "\nGRAND " + grand
}

// assertFullRecalcIsNoop — старый полный пересчёт после шага ничего не меняет.
func (f *anFix) assertFullRecalcIsNoop(label string) string {
	f.t.Helper()
	before := f.snapshot()
	f.fullRecalc()
	if after := f.snapshot(); after != before {
		f.t.Fatalf("%s: полный пересчёт изменил тендер\n--- после шага ---\n%s\n--- после полного пересчёта ---\n%s",
			label, before, after)
	}
	return before
}

func TestAnalogIntegration_NarrowRecalcParity(t *testing.T) {
	f := anRecalcSetup(t, "parity")
	base, baseNb := f.snapshot(), f.neighbours()

	// Применение: строки цели посчитаны, коммерция ненулевая.
	f.mustApply(f.req(ScaleModeVolumeRatio, true))
	applied := f.assertFullRecalcIsNoop("apply")
	if applied == base {
		t.Fatal("применение ничего не изменило")
	}
	if n := f.num(`SELECT count(*)::int FROM public.boq_items
	               WHERE client_position_id = $1::uuid AND commercial_markup IS NOT NULL
	                 AND total_commercial_material_cost IS NOT NULL AND total_commercial_work_cost IS NOT NULL`,
		f.arch.tgtPosID); n != 3 {
		t.Fatalf("у строк цели записана коммерция: %d из 3 (в т.ч. нулевая по цене)", n)
	}
	if n := f.num(`SELECT count(*)::int FROM public.boq_items
	               WHERE client_position_id = $1::uuid AND total_commercial_work_cost > 0`, f.arch.tgtPosID); n == 0 {
		t.Fatal("коммерция работ цели нулевая: тактика не сработала")
	}
	if g := f.str(`SELECT COALESCE(cached_grand_total::text, '~') FROM public.tenders WHERE id = $1::uuid`, f.arch.tgtTenderID); g == "~" || g == "0" {
		t.Fatalf("cached_grand_total не пересчитан: %s", g)
	}
	if st := f.str(`SELECT financial_calculation_status FROM public.tenders WHERE id = $1::uuid`, f.arch.tgtTenderID); st != "calculated" {
		t.Fatalf("статус расчёта тендера после применения: %s", st)
	}

	// Соседние позиции применением не затронуты.
	if got := f.neighbours(); got != baseNb {
		t.Fatalf("соседние позиции изменились:\n%s\n%s", baseNb, got)
	}

	// Повторное применение (замена своих строк другим масштабом).
	f.mustApply(f.req(ScaleModeNone, true))
	f.assertFullRecalcIsNoop("apply повторно")

	// Отмена последнего решения.
	apps, err := f.repo.ListApplications(context.Background(), f.arch.tgtPosID)
	if err != nil || len(apps) == 0 {
		t.Fatalf("list: %v", err)
	}
	var active string
	for _, a := range apps {
		if a.Status == AnalogStatusApplied {
			active = a.ID
		}
	}
	if active == "" {
		t.Fatal("нет активного решения")
	}
	if _, err := f.repo.Revert(context.Background(), active, archiveTestUser); err != nil {
		t.Fatalf("revert: %v", err)
	}
	f.assertFullRecalcIsNoop("revert")
	if got := f.neighbours(); got != baseNb {
		t.Fatal("соседние позиции изменились после отмены")
	}
	if n := f.num(`SELECT count(*)::int FROM public.boq_items WHERE client_position_id = $1::uuid`, f.arch.tgtPosID); n != 0 {
		t.Fatalf("после отмены в цели %d строк", n)
	}
	if got := f.str(`SELECT total_works::text || '|' || total_material::text FROM public.client_positions WHERE id = $1::uuid`, f.arch.tgtPosID); got != "0|0" {
		t.Fatalf("итоги цели после отмены: %s", got)
	}
}

// neighbours — итоги и коммерция всего, что не относится к целевой позиции.
func (f *anFix) neighbours() string {
	f.t.Helper()
	items := f.str(`SELECT COALESCE(string_agg(
	    id::text || '|' || COALESCE(trim_scale(total_amount)::text, '~') || '|' ||
	    COALESCE(trim_scale(commercial_markup)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_commercial_material_cost)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_commercial_work_cost)::text, '~'), E'\n' ORDER BY id), '')
	  FROM public.boq_items WHERE tender_id = $1::uuid AND client_position_id <> $2::uuid`,
		f.arch.tgtTenderID, f.arch.tgtPosID)
	positions := f.str(`SELECT COALESCE(string_agg(
	    id::text || '|' || COALESCE(trim_scale(total_material)::text, '~') || '|' ||
	    COALESCE(trim_scale(total_works)::text, '~'), E'\n' ORDER BY id), '')
	  FROM public.client_positions WHERE tender_id = $1::uuid AND id <> $2::uuid`,
		f.arch.tgtTenderID, f.arch.tgtPosID)
	return items + "\n" + positions
}

// Предпросмотр: ничего не пишет (в т.ч. в tenders) и отдаёт те же данные,
// что сохраняет применение.
func TestAnalogIntegration_PreviewMatchesApplyAndWritesNothing(t *testing.T) {
	f := anRecalcSetup(t, "prevapply")
	snapBefore := f.snapshot()
	tenderRow := `SELECT financial_input_revision::text || '|' || financial_calculation_status || '|' ||
	                     COALESCE(financial_calculation_revision::text, '~') || '|' || COALESCE(financial_calculated_at::text, '~') || '|' ||
	                     financial_approved::text
	              FROM public.tenders WHERE id = $1::uuid`
	tenderBefore := f.str(tenderRow, f.arch.tgtTenderID)
	before := f.counters()

	req := f.req(ScaleModeVolumeRatio, true)
	p, err := f.preview(req)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if after := f.counters(); after != before {
		t.Fatalf("предпросмотр изменил БД: %+v → %+v", before, after)
	}
	if got := f.snapshot(); got != snapBefore {
		t.Fatalf("предпросмотр изменил итоги:\n%s\n%s", snapBefore, got)
	}
	if got := f.str(tenderRow, f.arch.tgtTenderID); got != tenderBefore {
		t.Fatalf("предпросмотр изменил тендер: %s → %s", tenderBefore, got)
	}

	in := f.in(req)
	in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()
	res, err := f.repo.Apply(context.Background(), in)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}

	// Итоги и предупреждения предпросмотра == сохранённый результат применения.
	var stored struct {
		Totals   json.RawMessage `json:"totals"`
		Warnings json.RawMessage `json:"warnings"`
	}
	raw := f.str(`SELECT result::text FROM public.analog_applications WHERE id = $1::uuid`, res.Application.ID)
	if err := json.Unmarshal([]byte(raw), &stored); err != nil {
		t.Fatal(err)
	}
	pt, _ := json.Marshal(p.Totals)
	pw, _ := json.Marshal(p.Warnings)
	if !jsonEqual(t, pt, stored.Totals) || !jsonEqual(t, pw, stored.Warnings) {
		t.Fatalf("preview != apply:\ntotals  %s | %s\nwarnings %s | %s", pt, stored.Totals, pw, stored.Warnings)
	}
	if !p.CanApply || p.Totals.TotalWorks != 2000 || p.Totals.TotalMaterial != 600 {
		t.Fatalf("totals предпросмотра: can_apply=%v %+v", p.CanApply, p.Totals)
	}

	// Строки предпросмотра == строки в БД после применения.
	rows := f.targetRows()
	if len(p.Items) != len(rows) {
		t.Fatalf("строк в предпросмотре %d, после применения %d", len(p.Items), len(rows))
	}
	for i, it := range p.Items {
		if it.ID != nil {
			t.Fatalf("в предпросмотре отдан id строки: %v", *it.ID)
		}
		var total *float64
		if err := f.pool.QueryRow(context.Background(),
			`SELECT total_amount::float8 FROM public.boq_items WHERE id = $1::uuid`, rows[i].id).Scan(&total); err != nil {
			t.Fatal(err)
		}
		if it.Quantity == nil || rows[i].qty == nil || *it.Quantity != *rows[i].qty ||
			it.UnitRate == nil || rows[i].rate == nil || *it.UnitRate != *rows[i].rate ||
			it.TotalAmount == nil || total == nil || *it.TotalAmount != *total || it.BoqItemType != rows[i].itemType {
			t.Fatalf("строка %d: предпросмотр %+v, БД %+v (total %v)", i, it, rows[i], total)
		}
	}
}

func jsonEqual(t *testing.T, a, b []byte) bool {
	t.Helper()
	var x, y any
	if err := json.Unmarshal(a, &x); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(b, &y); err != nil {
		t.Fatal(err)
	}
	xa, _ := json.Marshal(x)
	yb, _ := json.Marshal(y)
	return string(xa) == string(yb)
}
