//go:build integration

package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/su10/hubtender/backend/internal/calc"
)

// PostgreSQL-интеграция пилота «расценка по реальному аналогу». Только
// изолированная тестовая БД (имя содержит "test"):
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://postgres:…@127.0.0.1:55439/hubtender_analog_test?sslmode=disable' \
//	  go test -tags=integration -p 1 ./internal/repository/ -run 'Analog|Compose|Autoprice' -v

type anFix struct {
	t    *testing.T
	pool *pgxpool.Pool
	repo *AnalogRepo
	arch *archiveFixture
	// строки источника: работа и привязанный материал
	srcWork, srcMat string
}

// anSetup: источник (поз. 100 м2: работа 10 × 100 ₽ + материал 15 × 20 ₽, conv 1.5)
// и цель (поз. 200 м2, пустая).
func anSetup(t *testing.T, tag string, srcUSD, tgtUSD *float64) *anFix {
	t.Helper()
	pool := newTestPool(t)
	a := seedArchiveFixture(t, pool, "AN-"+tag, srcUSD, tgtUSD)
	f := &anFix{t: t, pool: pool, repo: NewAnalogRepo(pool), arch: a}
	f.exec(`UPDATE public.client_positions SET unit_code = 'м2' WHERE id = ANY($1::uuid[])`, []string{a.srcPosID, a.tgtPosID})
	conv, cons := 1.5, 1.0
	f.srcWork = a.addArchiveItem(t, pool, calc.BoqRab, calc.CurrencyRUB, 10, 100, nil, nil, nil)
	f.srcMat = a.addArchiveItem(t, pool, calc.BoqMat, calc.CurrencyRUB, 15, 20, &conv, &cons, &f.srcWork)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM public.analog_applications WHERE tender_id = $1::uuid`, a.tgtTenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, a.tgtTenderID)
		_, _ = pool.Exec(ctx, `DELETE FROM public.import_sessions WHERE tender_id = $1::uuid`, a.tgtTenderID)
	})
	return f
}

func (f *anFix) exec(q string, args ...any) {
	f.t.Helper()
	if _, err := f.pool.Exec(context.Background(), q, args...); err != nil {
		f.t.Fatalf("exec: %v\nSQL: %s", err, q)
	}
}

func (f *anFix) str(q string, args ...any) string {
	f.t.Helper()
	var s string
	if err := f.pool.QueryRow(context.Background(), q, args...).Scan(&s); err != nil {
		f.t.Fatalf("query: %v\nSQL: %s", err, q)
	}
	return s
}

func (f *anFix) num(q string, args ...any) int {
	f.t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		f.t.Fatalf("query: %v\nSQL: %s", err, q)
	}
	return n
}

func (f *anFix) newKey() string { return f.str(`SELECT gen_random_uuid()::text`) }

func (f *anFix) req(mode string, copyPrices bool) AnalogRequest {
	return AnalogRequest{SourcePositionID: f.arch.srcPosID, ScaleMode: mode, CopyPrices: copyPrices}
}

func (f *anFix) in(req AnalogRequest) AnalogExecuteInput {
	return AnalogExecuteInput{PositionID: f.arch.tgtPosID, UserID: archiveTestUser, Request: req}
}

func (f *anFix) preview(req AnalogRequest) (*AnalogPreview, error) {
	return f.repo.Preview(context.Background(), f.in(req))
}

// apply: предпросмотр → применение с новым ключом.
func (f *anFix) apply(req AnalogRequest) (*AnalogApplyResult, error) {
	f.t.Helper()
	p, err := f.preview(req)
	if err != nil {
		return nil, err
	}
	in := f.in(req)
	in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()
	return f.repo.Apply(context.Background(), in)
}

func (f *anFix) mustApply(req AnalogRequest) *AnalogApplyResult {
	f.t.Helper()
	res, err := f.apply(req)
	if err != nil {
		f.t.Fatalf("apply: %v", err)
	}
	return res
}

// counters — всё, что предпросмотр менять не вправе.
type anCounters struct{ items, audit, apps, sessions, reviews, revision int }

func (f *anFix) counters() anCounters {
	tid := f.arch.tgtTenderID
	return anCounters{
		items: f.num(`SELECT count(*)::int FROM public.boq_items WHERE tender_id = $1::uuid`, tid),
		audit: f.num(`SELECT count(*)::int FROM public.boq_items_audit
		              WHERE new_data->>'tender_id' = $1 OR old_data->>'tender_id' = $1`, tid),
		apps:     f.num(`SELECT count(*)::int FROM public.analog_applications WHERE tender_id = $1::uuid`, tid),
		sessions: f.num(`SELECT count(*)::int FROM public.import_sessions WHERE tender_id = $1::uuid`, tid),
		reviews:  f.num(`SELECT count(*)::int FROM public.autoprice_position_reviews WHERE tender_id = $1::uuid`, tid),
		revision: f.num(`SELECT financial_input_revision::int FROM public.tenders WHERE id = $1::uuid`, tid),
	}
}

func analogErrCode(t *testing.T, err error) string {
	t.Helper()
	var ae *AnalogError
	if !errors.As(err, &ae) {
		t.Fatalf("ожидалась *AnalogError, получено %v", err)
	}
	return ae.Code
}

type anRow struct {
	id, itemType string
	qty, rate    *float64
	delivery     *float64
	parent       *string
	session      *string
	qLink        *string
	qDate        *string
}

func (f *anFix) targetRows() []anRow {
	f.t.Helper()
	rows, err := f.pool.Query(context.Background(), `
		SELECT id::text, boq_item_type::text, quantity::float8, unit_rate::float8, delivery_amount::float8,
		       parent_work_item_id::text, import_session_id::text, quote_link, to_char(quote_price_date, 'YYYY-MM-DD')
		FROM public.boq_items WHERE client_position_id = $1::uuid ORDER BY sort_number, id`, f.arch.tgtPosID)
	if err != nil {
		f.t.Fatalf("target rows: %v", err)
	}
	defer rows.Close()
	var out []anRow
	for rows.Next() {
		var r anRow
		if err := rows.Scan(&r.id, &r.itemType, &r.qty, &r.rate, &r.delivery, &r.parent, &r.session, &r.qLink, &r.qDate); err != nil {
			f.t.Fatalf("scan: %v", err)
		}
		out = append(out, r)
	}
	return out
}

// ─── предпросмотр ничего не пишет ───────────────────────────────────────────

func TestAnalogIntegration_PreviewWritesNothing(t *testing.T) {
	f := anSetup(t, "preview", nil, nil)
	f.exec(`UPDATE public.boq_items SET quote_link = 'http://q', quote_price_date = '2026-01-10' WHERE id = $1::uuid`, f.srcWork)
	before, srcFP := f.counters(), mustFP(t, f)

	p, err := f.preview(f.req(ScaleModeVolumeRatio, true))
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if after := f.counters(); after != before {
		t.Fatalf("предпросмотр изменил БД: было %+v, стало %+v", before, after)
	}
	if !p.CanApply || p.BlockedReason != nil || !ValidAnalogToken(p.PreviewToken) {
		t.Fatalf("can_apply=%v blocked=%v token=%q", p.CanApply, p.BlockedReason, p.PreviewToken)
	}
	if p.Target.State != AnalogStateEmpty || p.Scale.Factor != 2 || !p.Scale.UnitsMatch ||
		p.Scale.SourceVolume == nil || *p.Scale.SourceVolume != 100 || *p.Scale.TargetVolume != 200 {
		t.Fatalf("target/scale: %+v / %+v", p.Target.State, p.Scale)
	}
	// Работа 10 × 2 = 20; материал привязан: 20 × 1.5 × 1 = 30 (а не 15 × 2).
	if len(p.Items) != 2 || p.Items[0].ID != nil || p.Items[1].ParentIndex == nil || *p.Items[1].ParentIndex != 0 {
		t.Fatalf("items: %+v", p.Items)
	}
	if *p.Items[0].Quantity != 20 || *p.Items[1].Quantity != 30 {
		t.Fatalf("количества: работа %v, материал %v (want 20 и 30)", *p.Items[0].Quantity, *p.Items[1].Quantity)
	}
	if p.Items[0].SourceItemID == nil || *p.Items[0].SourceItemID != f.srcWork || p.Items[0].Name == "" {
		t.Fatalf("source_item_id/name: %+v", p.Items[0])
	}
	if p.Items[0].TotalAmount == nil || *p.Items[0].TotalAmount != 2000 {
		t.Fatalf("total_amount работы = %v, want 20×100", p.Items[0].TotalAmount)
	}
	if p.Items[0].QuoteLink == nil || *p.Items[0].QuoteLink != "http://q" ||
		p.Items[0].QuotePriceDate == nil || *p.Items[0].QuotePriceDate != "2026-01-10" {
		t.Fatalf("цены/даты при copy_prices=true: %+v", p.Items[0])
	}
	if p.Totals.WorksCount != 1 || p.Totals.MaterialsCount != 1 || p.Totals.ParentLinksRestored != 1 ||
		p.Totals.TotalWorks != 2000 || p.Totals.TotalMaterial != 600 {
		t.Fatalf("totals: %+v", p.Totals)
	}
	if got := mustFP(t, f); got != srcFP {
		t.Fatal("источник изменился после предпросмотра")
	}
}

func mustFP(t *testing.T, f *anFix) string {
	t.Helper()
	fp, err := analogSourceFingerprint(context.Background(), f.pool, f.arch.srcPosID)
	if err != nil {
		t.Fatal(err)
	}
	return fp
}

// ─── применение: строки, масштаб, аудит, карточка ───────────────────────────

func TestAnalogIntegration_ApplyAuditCardAndSourceUntouched(t *testing.T) {
	f := anSetup(t, "apply", nil, nil)
	f.exec(`UPDATE public.boq_items SET quote_link = 'http://q', quote_price_date = '2026-01-10', quote_valid_until = '2026-03-01' WHERE id = $1::uuid`, f.srcWork)
	srcFP := mustFP(t, f)

	res := f.mustApply(f.req(ScaleModeVolumeRatio, true))
	if res.Replayed || res.Application.Status != AnalogStatusApplied || res.Application.ItemsCreated != 2 || res.RunID == "" {
		t.Fatalf("apply: %+v", res)
	}
	rows := f.targetRows()
	if len(rows) != 2 || rows[0].itemType != "раб" || *rows[0].qty != 20 || *rows[1].qty != 30 {
		t.Fatalf("строки цели: %+v", rows)
	}
	if rows[1].parent == nil || *rows[1].parent != rows[0].id {
		t.Fatalf("привязка материала к работе потеряна: %+v", rows[1])
	}
	for _, r := range rows {
		if r.session == nil || *r.session != res.RunID {
			t.Fatalf("строка не в чёрновом прогоне: %+v", r)
		}
	}
	if *rows[0].rate != 100 || rows[0].qLink == nil || rows[0].qDate == nil || *rows[0].qDate != "2026-01-10" {
		t.Fatalf("цена и даты должны перенестись: %+v", rows[0])
	}

	// Прогон: служебные поля и счётчик.
	if lbl := f.str(`SELECT label || '|' || source || '|' || file_name || '|' || items_count::text FROM public.import_sessions WHERE id = $1::uuid`, res.RunID); lbl != AnalogRunLabel+"|autoprice|analog-pilot|2" {
		t.Fatalf("прогон: %s", lbl)
	}
	// Карточка: pending, событие analog_apply, основание не тронуто.
	card := f.str(`SELECT status || '|' || COALESCE(basis, '-') || '|' || pd_refs::text || '|' || (events->0->>'action') || '|' || (events->0->>'user_name')
	               FROM public.autoprice_position_reviews WHERE import_session_id = $1::uuid AND client_position_id = $2::uuid`,
		res.RunID, f.arch.tgtPosID)
	if card != "pending|-|[]|analog_apply|Itest Actor" {
		t.Fatalf("карточка: %s", card)
	}
	if cmt := f.str(`SELECT events->0->>'comment' FROM public.autoprice_position_reviews WHERE import_session_id = $1::uuid`, res.RunID); cmt == "" {
		t.Fatal("в событии нет пояснения")
	}
	// Аудит: автор — пользователь, в payload происхождение.
	n := f.num(`SELECT count(*)::int FROM public.boq_items_audit
	            WHERE boq_item_id = ANY($1::uuid[]) AND operation_type = 'INSERT' AND changed_by = $2::uuid
	              AND new_data->>'origin' = 'analog_apply' AND new_data->>'source_tender_id' = $3
	              AND new_data->>'analog_application_id' = $4`,
		[]string{rows[0].id, rows[1].id}, archiveTestUser, f.arch.srcTenderID, res.Application.ID)
	if n != 2 {
		t.Fatalf("записей аудита с origin/source_tender_id/analog_application_id = %d, want 2", n)
	}
	if dup := f.num(`SELECT count(*)::int FROM public.boq_items_audit WHERE boq_item_id = $1::uuid`, rows[0].id); dup != 1 {
		t.Fatalf("дубль аудита: %d записей по строке", dup)
	}

	// Решение и список.
	apps, err := f.repo.ListApplications(context.Background(), f.arch.tgtPosID)
	if err != nil || len(apps) != 1 {
		t.Fatalf("list: %v %+v", err, apps)
	}
	a := apps[0]
	if a.ID != res.Application.ID || a.ScaleMode != ScaleModeVolumeRatio || a.ScaleFactor != 2 || !a.CopyPrices ||
		a.CreatedByName == nil || *a.CreatedByName != "Itest Actor" || a.SourcePositionID != f.arch.srcPosID ||
		a.SourceTenderNumber == nil || a.SourceWorkName != "исторический источник" || a.ItemsCreated != 2 {
		t.Fatalf("решение: %+v", a)
	}
	// Состав цели знает, откуда строка.
	tgt, err := f.repo.GetTarget(context.Background(), f.arch.tgtPosID)
	if err != nil || tgt.State != AnalogStateDraftOnly || tgt.DraftRowsCount != 2 || tgt.ForeignRowsCount != 0 ||
		tgt.ReviewStatus == nil || *tgt.ReviewStatus != "pending" || tgt.Items[0].SourceItemID == nil || !tgt.Items[0].IsDraft {
		t.Fatalf("цель после применения: %v %+v", err, tgt)
	}
	if mustFP(t, f) != srcFP {
		t.Fatal("источник изменился")
	}
	if got := f.num(`SELECT count(*)::int FROM public.boq_items WHERE client_position_id = $1::uuid`, f.arch.srcPosID); got != 2 {
		t.Fatalf("в источнике %d строк, want 2", got)
	}
}

// ─── цены не переносятся: ноль и NULL, штатное подтверждение не пройдёт ─────

func TestAnalogIntegration_CopyPricesFalse(t *testing.T) {
	f := anSetup(t, "noprice", nil, nil)
	f.exec(`UPDATE public.boq_items SET quote_link = 'http://q', quote_price_date = '2026-01-10', quote_valid_until = '2026-03-01',
	        delivery_price_type = 'суммой', delivery_amount = 7 WHERE id = $1::uuid`, f.srcMat)

	res := f.mustApply(f.req(ScaleModeNone, false))
	rows := f.targetRows()
	if len(rows) != 2 || *rows[0].qty != 10 || *rows[1].qty != 15 {
		t.Fatalf("none: количества как в источнике: %+v", rows)
	}
	for _, r := range rows {
		if r.rate == nil || *r.rate != 0 || r.delivery == nil || *r.delivery != 0 || r.qLink != nil || r.qDate != nil {
			t.Fatalf("цены не должны переноситься: %+v", r)
		}
	}
	if n := f.num(`SELECT count(*)::int FROM public.boq_items WHERE client_position_id = $1::uuid AND (quote_valid_until IS NOT NULL OR quote_price_date IS NOT NULL)`, f.arch.tgtPosID); n != 0 {
		t.Fatalf("даты цен перенеслись: %d", n)
	}

	_, err := NewAutopriceReviewRepo(f.pool).ApplyAction(context.Background(), res.RunID, f.arch.tgtPosID, archiveTestUser, "approve", "")
	var zp *AutopriceZeroPriceError
	if !errors.As(err, &zp) || zp.Count != 2 {
		t.Fatalf("approve должен упереться в zero_price (2 строки), получено %v", err)
	}
}

// ─── правила масштаба и коды ────────────────────────────────────────────────

func TestAnalogIntegration_ScaleRulesAndCodes(t *testing.T) {
	f := anSetup(t, "rules", nil, nil)
	before := f.counters()

	// Разные единицы.
	f.exec(`UPDATE public.client_positions SET unit_code = 'м3' WHERE id = $1::uuid`, f.arch.tgtPosID)
	_, err := f.preview(f.req(ScaleModeVolumeRatio, true))
	if c := analogErrCode(t, err); c != AnalogCodeScaleNeedsChoice {
		t.Fatalf("разные единицы: %s", c)
	}
	// «Как в источнике» и явный коэффициент при разных единицах допустимы; предупреждение о единицах.
	p, err := f.preview(f.req(ScaleModeNone, true))
	if err != nil || p.Scale.UnitsMatch || len(p.Warnings) == 0 || p.Warnings[0].Code != AnalogWarnUnitsDiffer {
		t.Fatalf("none при разных единицах: %v %+v", err, p)
	}
	r := f.req(ScaleModeFactor, true)
	r.ScaleFactor = ptrF(0.5)
	if p, err = f.preview(r); err != nil || *p.Items[0].Quantity != 5 {
		t.Fatalf("factor 0.5: %v", err)
	}
	r.ScaleFactor = ptrF(0)
	if _, err = f.preview(r); analogErrCode(t, err) != AnalogCodeScaleInvalid {
		t.Fatalf("factor 0: %v", err)
	}

	// Нулевой объём источника / NULL объём цели.
	f.exec(`UPDATE public.client_positions SET unit_code = 'м2' WHERE id = $1::uuid`, f.arch.tgtPosID)
	f.exec(`UPDATE public.client_positions SET manual_volume = 0, volume = NULL WHERE id = $1::uuid`, f.arch.srcPosID)
	if _, err = f.preview(f.req(ScaleModeVolumeRatio, true)); analogErrCode(t, err) != AnalogCodeVolumeUnknown {
		t.Fatalf("объём источника 0: %v", err)
	}
	f.exec(`UPDATE public.client_positions SET manual_volume = 100 WHERE id = $1::uuid`, f.arch.srcPosID)
	f.exec(`UPDATE public.client_positions SET manual_volume = NULL, volume = NULL WHERE id = $1::uuid`, f.arch.tgtPosID)
	if _, err = f.preview(f.req(ScaleModeVolumeRatio, true)); analogErrCode(t, err) != AnalogCodeVolumeUnknown {
		t.Fatalf("объём цели NULL: %v", err)
	}

	// Применение с ошибкой правил ничего не записывает.
	in := f.in(f.req(ScaleModeVolumeRatio, true))
	zeros := "00000000000000000000000000000000"
	in.PreviewToken, in.IdempotencyKey = analogToken(zeros, zeros), f.newKey()
	if _, err = f.repo.Apply(context.Background(), in); analogErrCode(t, err) != AnalogCodeVolumeUnknown {
		t.Fatalf("apply с неверным масштабом: %v", err)
	}
	if after := f.counters(); after != before {
		t.Fatalf("ошибки правил изменили БД: %+v → %+v", before, after)
	}

	// Не найдены / тот же тендер.
	bad := f.in(f.req(ScaleModeNone, true))
	bad.PositionID = "00000000-0000-4000-8000-0000000000aa"
	if _, err = f.repo.Preview(context.Background(), bad); analogErrCode(t, err) != AnalogCodeTargetNotFound {
		t.Fatalf("цель не найдена: %v", err)
	}
	bad = f.in(f.req(ScaleModeNone, true))
	bad.Request.SourcePositionID = "00000000-0000-4000-8000-0000000000bb"
	if _, err = f.repo.Preview(context.Background(), bad); analogErrCode(t, err) != AnalogCodeSourceNotFound {
		t.Fatalf("источник не найден: %v", err)
	}
	same := f.in(f.req(ScaleModeNone, true))
	same.Request.SourcePositionID = f.arch.tgtPosID
	if _, err = f.repo.Preview(context.Background(), same); analogErrCode(t, err) != AnalogCodeSourceSameTender {
		t.Fatalf("источник из того же тендера: %v", err)
	}
}

// ─── нет курса валюты у цели ────────────────────────────────────────────────

func TestAnalogIntegration_MissingFXRate(t *testing.T) {
	src := 50.0
	f := anSetup(t, "nofx", &src, nil)
	f.arch.addArchiveItem(t, f.pool, calc.BoqRab, "USD", 10, 2, nil, nil, nil)
	before := f.counters()

	_, err := f.preview(f.req(ScaleModeNone, true))
	var fx *calc.MissingFXRateError
	if !errors.As(err, &fx) || fx.Currency != "USD" {
		t.Fatalf("ожидали MissingFXRateError(USD), получили %v", err)
	}
	if after := f.counters(); after != before {
		t.Fatalf("при ошибке курса БД изменилась: %+v → %+v", before, after)
	}
	// С курсом у цели — проходит, пересчёт по курсу ЦЕЛИ.
	f.exec(`UPDATE public.tenders SET usd_rate = 100 WHERE id = $1::uuid`, f.arch.tgtTenderID)
	res := f.mustApply(f.req(ScaleModeNone, true))
	if got := f.num(`SELECT total_amount::int FROM public.boq_items WHERE import_session_id = $1::uuid AND currency_type = 'USD'`, res.RunID); got != 2000 {
		t.Fatalf("total_amount = %d, want 2000 (10 × 2 × 100)", got)
	}
}
