//go:build integration

package repository

import (
	"context"
	"errors"
	"sync"
	"testing"
)

// ─── ручные строки и подтверждённые позиции ─────────────────────────────────

func TestAnalogIntegration_ForeignRowsBlockAndAreKept(t *testing.T) {
	f := anSetup(t, "foreign", nil, nil)
	// Ручная строка в цели (без import_session_id).
	f.rawWork(f.arch.tgtPosID)
	before := f.counters()

	p, err := f.preview(f.req(ScaleModeNone, true))
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	if p.CanApply || p.BlockedReason == nil || *p.BlockedReason != AnalogStateForeign ||
		p.Target.State != AnalogStateForeign || p.Target.ForeignRowsCount != 1 || len(p.Items) != 0 {
		t.Fatalf("preview для цели с ручными строками: %+v", p)
	}
	in := f.in(f.req(ScaleModeNone, true))
	in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()
	if _, err := f.repo.Apply(context.Background(), in); analogErrCode(t, err) != AnalogCodeTargetHasRows {
		t.Fatalf("apply: %v", err)
	}
	if after := f.counters(); after != before {
		t.Fatalf("ручные строки или БД изменились: %+v → %+v", before, after)
	}
}

func TestAnalogIntegration_LockedByApprovalOrExclusion(t *testing.T) {
	f := anSetup(t, "locked", nil, nil)
	res := f.mustApply(f.req(ScaleModeVolumeRatio, true))
	ap := NewAutopriceReviewRepo(f.pool)
	ctx := context.Background()

	if _, err := ap.ApplyAction(ctx, res.RunID, f.arch.tgtPosID, archiveTestUser, "approve", ""); err != nil {
		t.Fatalf("approve: %v", err)
	}
	check := func(label string) {
		t.Helper()
		p, err := f.preview(f.req(ScaleModeVolumeRatio, true))
		if err != nil || p.CanApply || p.BlockedReason == nil || *p.BlockedReason != AnalogStateLocked {
			t.Fatalf("%s: preview %v %+v", label, err, p)
		}
		in := f.in(f.req(ScaleModeVolumeRatio, true))
		in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()
		if _, err := f.repo.Apply(ctx, in); analogErrCode(t, err) != AnalogCodeTargetLocked {
			t.Fatalf("%s: apply %v", label, err)
		}
		if _, err := f.repo.Revert(ctx, res.Application.ID, archiveTestUser); analogErrCode(t, err) != AnalogCodeTargetLocked {
			t.Fatalf("%s: revert %v", label, err)
		}
		if n := len(f.targetRows()); n != 2 {
			t.Fatalf("%s: строки изменились (%d)", label, n)
		}
	}
	check("approved")

	if _, err := ap.ApplyAction(ctx, res.RunID, f.arch.tgtPosID, archiveTestUser, "reopen", ""); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if tgt, _ := f.repo.GetTarget(ctx, f.arch.tgtPosID); tgt.State != AnalogStateDraftOnly {
		t.Fatalf("после reopen состояние %s", tgt.State)
	}
	if _, err := ap.ApplyAction(ctx, res.RunID, f.arch.tgtPosID, archiveTestUser, "exclude", "не нужна"); err != nil {
		t.Fatalf("exclude: %v", err)
	}
	check("excluded")
}

// ─── идемпотентность ────────────────────────────────────────────────────────

func TestAnalogIntegration_IdempotencySequentialAndConflict(t *testing.T) {
	f := anSetup(t, "idem", nil, nil)
	req := f.req(ScaleModeVolumeRatio, true)
	p, err := f.preview(req)
	if err != nil {
		t.Fatal(err)
	}
	in := f.in(req)
	in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()

	first, err := f.repo.Apply(context.Background(), in)
	if err != nil || first.Replayed {
		t.Fatalf("первое применение: %v %+v", err, first)
	}
	second, err := f.repo.Apply(context.Background(), in)
	if err != nil || !second.Replayed || second.Application.ID != first.Application.ID {
		t.Fatalf("повтор: %v %+v", err, second)
	}
	if n := len(f.targetRows()); n != 2 {
		t.Fatalf("строк после повтора %d, want 2", n)
	}
	if n := f.num(`SELECT count(*)::int FROM public.analog_applications WHERE client_position_id = $1::uuid`, f.arch.tgtPosID); n != 1 {
		t.Fatalf("решений %d, want 1", n)
	}
	// Тот же ключ, другое тело.
	other := in
	other.Request.ScaleMode = ScaleModeNone
	if _, err := f.repo.Apply(context.Background(), other); analogErrCode(t, err) != AnalogCodeIdempotencyClash {
		t.Fatalf("другое тело: %v", err)
	}
	other = in
	other.Request.CopyPrices = false
	if _, err := f.repo.Apply(context.Background(), other); analogErrCode(t, err) != AnalogCodeIdempotencyClash {
		t.Fatalf("другие цены: %v", err)
	}
}

func TestAnalogIntegration_IdempotencyConcurrent(t *testing.T) {
	f := anSetup(t, "race", nil, nil)
	req := f.req(ScaleModeVolumeRatio, true)
	p, err := f.preview(req)
	if err != nil {
		t.Fatal(err)
	}
	in := f.in(req)
	in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()

	const workers = 3
	results := make([]*AnalogApplyResult, workers)
	errs := make([]error, workers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], errs[i] = f.repo.Apply(context.Background(), in)
		}(i)
	}
	close(start)
	wg.Wait()

	replayed := 0
	for i := range results {
		if errs[i] != nil {
			t.Fatalf("горутина %d: %v", i, errs[i])
		}
		if results[i].Application.ID != results[0].Application.ID {
			t.Fatalf("разные решения: %s и %s", results[i].Application.ID, results[0].Application.ID)
		}
		if results[i].Replayed {
			replayed++
		}
	}
	if replayed != workers-1 {
		t.Fatalf("replayed = %d, want %d (ровно одно настоящее применение)", replayed, workers-1)
	}
	if n := len(f.targetRows()); n != 2 {
		t.Fatalf("строк после гонки %d, want 2", n)
	}
	if n := f.num(`SELECT count(*)::int FROM public.analog_applications WHERE client_position_id = $1::uuid`, f.arch.tgtPosID); n != 1 {
		t.Fatalf("решений %d, want 1", n)
	}
}

// ─── устаревший предпросмотр ────────────────────────────────────────────────

func TestAnalogIntegration_StaleSourceOrTarget(t *testing.T) {
	f := anSetup(t, "stale", nil, nil)
	ctx := context.Background()
	req := f.req(ScaleModeVolumeRatio, true)
	apply := func(token string) error {
		in := f.in(req)
		in.PreviewToken, in.IdempotencyKey = token, f.newKey()
		_, err := f.repo.Apply(ctx, in)
		return err
	}
	changedOf := func(err error) string {
		if analogErrCode(t, err) != AnalogCodeStale {
			t.Fatalf("ожидался ANALOG_STALE: %v", err)
		}
		var ae *AnalogError
		if !errors.As(err, &ae) {
			t.Fatal("нет AnalogError")
		}
		return ae.Extras["changed"].(string)
	}

	// Источник изменился.
	p, _ := f.preview(req)
	f.exec(`UPDATE public.boq_items SET unit_rate = unit_rate + 1 WHERE id = $1::uuid`, f.srcWork)
	if got := changedOf(apply(p.PreviewToken)); got != "source" {
		t.Fatalf("changed = %s, want source", got)
	}
	if len(f.targetRows()) != 0 {
		t.Fatal("при STALE строки не должны записываться")
	}

	// Цель изменилась (объём позиции).
	p, _ = f.preview(req)
	f.exec(`UPDATE public.client_positions SET manual_volume = 300 WHERE id = $1::uuid`, f.arch.tgtPosID)
	if got := changedOf(apply(p.PreviewToken)); got != "target" {
		t.Fatalf("changed = %s, want target", got)
	}

	// Правка чернового ряда после применения → старый токен устарел.
	f.mustApply(req)
	p, _ = f.preview(req)
	f.exec(`UPDATE public.boq_items SET quote_link = 'http://edited' WHERE client_position_id = $1::uuid AND boq_item_type = 'раб'`, f.arch.tgtPosID)
	if got := changedOf(apply(p.PreviewToken)); got != "target" {
		t.Fatalf("changed = %s, want target (правка строки цели)", got)
	}
}

// ─── повторное применение и отмена ──────────────────────────────────────────

// extraSource — второй источник: одна работа (7 м2), другой тендер.
func (f *anFix) extraSource() string {
	f.t.Helper()
	tid := f.str(`INSERT INTO public.tenders (title, client_name, tender_number) VALUES ('itest-an-src2', 'itest-client', 'ITEST-AN-SRC2-' || gen_random_uuid()::text) RETURNING id::text`)
	pos := f.str(`INSERT INTO public.client_positions (tender_id, position_number, work_name, unit_code, manual_volume)
	              VALUES ($1::uuid, 1, 'второй источник', 'м2', 50) RETURNING id::text`, tid)
	workName, _ := ensureTestNames(f.t, f.pool)
	f.exec(`INSERT INTO public.boq_items (tender_id, client_position_id, sort_number, boq_item_type, work_name_id, quantity, unit_rate, currency_type)
	        VALUES ($1::uuid, $2::uuid, 1, 'раб', $3::uuid, 7, 55, 'RUB')`, tid, pos, workName)
	f.t.Cleanup(func() {
		ctx := context.Background()
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.boq_items WHERE tender_id = $1::uuid`, tid)
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.client_positions WHERE tender_id = $1::uuid`, tid)
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.tenders WHERE id = $1::uuid`, tid)
	})
	return pos
}

func TestAnalogIntegration_ReapplyReplacesOnlyOwnRowsAndRevert(t *testing.T) {
	f := anSetup(t, "reapply", nil, nil)
	ctx := context.Background()
	first := f.mustApply(f.req(ScaleModeVolumeRatio, true))
	oldRows := f.targetRows()

	r2 := f.req(ScaleModeNone, false)
	r2.SourcePositionID = f.extraSource()
	second := f.mustApply(r2)
	if second.RunID != first.RunID {
		t.Fatalf("прогон должен быть один на тендер: %s и %s", first.RunID, second.RunID)
	}
	rows := f.targetRows()
	if len(rows) != 1 || *rows[0].qty != 7 || rows[0].id == oldRows[0].id {
		t.Fatalf("после повторного применения должны остаться только строки второго источника: %+v", rows)
	}
	if n := f.num(`SELECT count(*)::int FROM public.boq_items_audit WHERE boq_item_id = ANY($1::uuid[]) AND operation_type = 'DELETE' AND changed_by = $2::uuid`,
		[]string{oldRows[0].id, oldRows[1].id}, archiveTestUser); n != 2 {
		t.Fatalf("аудит DELETE прежних строк: %d, want 2", n)
	}
	status := func(id string) string {
		return f.str(`SELECT status FROM public.analog_applications WHERE id = $1::uuid`, id)
	}
	if status(first.Application.ID) != AnalogStatusSuperseded || status(second.Application.ID) != AnalogStatusApplied {
		t.Fatalf("статусы: %s / %s", status(first.Application.ID), status(second.Application.ID))
	}
	if n := f.num(`SELECT items_count FROM public.import_sessions WHERE id = $1::uuid`, first.RunID); n != 1 {
		t.Fatalf("items_count = %d, want 1", n)
	}

	// Отмена заменённого — нельзя.
	if _, err := f.repo.Revert(ctx, first.Application.ID, archiveTestUser); analogErrCode(t, err) != AnalogCodeNotActive {
		t.Fatalf("revert superseded: %v", err)
	}

	// Ручной дочерний материал под строкой аналога блокирует отмену.
	_, matName := ensureTestNames(t, f.pool)
	f.exec(`INSERT INTO public.boq_items (tender_id, client_position_id, sort_number, boq_item_type, material_name_id, parent_work_item_id, quantity, unit_rate, currency_type)
	        VALUES ($1::uuid, $2::uuid, 9, 'мат', $3::uuid, $4::uuid, 1, 1, 'RUB')`, f.arch.tgtTenderID, f.arch.tgtPosID, matName, rows[0].id)
	if _, err := f.repo.Revert(ctx, second.Application.ID, archiveTestUser); analogErrCode(t, err) != AnalogCodeForeignChildren {
		t.Fatalf("revert с чужим дочерним: %v", err)
	}
	if n := len(f.targetRows()); n != 2 {
		t.Fatalf("строки не должны удаляться при отказе: %d", n)
	}
	f.exec(`DELETE FROM public.boq_items WHERE client_position_id = $1::uuid AND import_session_id IS NULL`, f.arch.tgtPosID)

	// Отмена удаляет свои строки, пишет событие и аудит.
	res, err := f.repo.Revert(ctx, second.Application.ID, archiveTestUser)
	if err != nil || !res.Changed || res.Application.Status != AnalogStatusReverted || res.Application.RevertedAt == nil ||
		res.Application.RevertedByName == nil || *res.Application.RevertedByName != "Itest Actor" {
		t.Fatalf("revert: %v %+v", err, res)
	}
	if n := len(f.targetRows()); n != 0 {
		t.Fatalf("после отмены строк %d, want 0", n)
	}
	if n := f.num(`SELECT items_count FROM public.import_sessions WHERE id = $1::uuid`, first.RunID); n != 0 {
		t.Fatalf("items_count = %d, want 0", n)
	}
	if n := f.num(`SELECT count(*)::int FROM public.boq_items_audit WHERE boq_item_id = $1::uuid AND operation_type = 'DELETE' AND changed_by = $2::uuid`, rows[0].id, archiveTestUser); n != 1 {
		t.Fatalf("аудит DELETE при отмене: %d", n)
	}
	if ev := f.str(`SELECT events->-1->>'action' FROM public.autoprice_position_reviews WHERE import_session_id = $1::uuid`, first.RunID); ev != "analog_revert" {
		t.Fatalf("последнее событие %q, want analog_revert", ev)
	}
	if tot := f.num(`SELECT COALESCE(total_works, 0)::int FROM public.client_positions WHERE id = $1::uuid`, f.arch.tgtPosID); tot != 0 {
		t.Fatalf("итоги позиции не пересчитаны: total_works = %d", tot)
	}
	// Повтор отмены — текущее состояние, без изменений.
	again, err := f.repo.Revert(ctx, second.Application.ID, archiveTestUser)
	if err != nil || again.Changed || again.Application.Status != AnalogStatusReverted {
		t.Fatalf("повторная отмена: %v %+v", err, again)
	}
	// После отмены позиция снова пуста для нового применения.
	if tgt, _ := f.repo.GetTarget(ctx, f.arch.tgtPosID); tgt.State != AnalogStateEmpty {
		t.Fatalf("состояние после отмены: %s", tgt.State)
	}
}

// ─── следующая позиция ──────────────────────────────────────────────────────

func TestAnalogIntegration_NextUnpriced(t *testing.T) {
	f := anSetup(t, "next", nil, nil)
	ctx := context.Background()
	pos := func(num int, unit *string) string {
		return f.str(`INSERT INTO public.client_positions (tender_id, position_number, work_name, unit_code)
		              VALUES ($1::uuid, $2, $3, $4) RETURNING id::text`, f.arch.tgtTenderID, num, "поз", unit)
	}
	noUnit := pos(2, nil)
	withUnit := pos(3, sptr("м3"))
	last := pos(4, sptr("м3"))

	n, err := f.repo.NextUnpriced(ctx, f.arch.tgtPosID)
	if err != nil || n == nil || n.PositionID != withUnit {
		t.Fatalf("next: %v %+v (позиция без единицы %s пропускается)", err, n, noUnit)
	}
	f.rawWork(withUnit)
	n, err = f.repo.NextUnpriced(ctx, f.arch.tgtPosID)
	if err != nil || n == nil || n.PositionID != last {
		t.Fatalf("next после расценки: %v %+v", err, n)
	}
	n, err = f.repo.NextUnpriced(ctx, last)
	if err != nil || n != nil {
		t.Fatalf("после последней должно быть null: %v %+v", err, n)
	}
	if _, err = f.repo.NextUnpriced(ctx, "00000000-0000-4000-8000-0000000000aa"); analogErrCode(t, err) != AnalogCodeTargetNotFound {
		t.Fatalf("несуществующая позиция: %v", err)
	}
}

// rawWork кладёт ручную строку (без прогона) в позицию тендера цели.
func (f *anFix) rawWork(positionID string) {
	f.t.Helper()
	workName, _ := ensureTestNames(f.t, f.pool)
	f.exec(`INSERT INTO public.boq_items (tender_id, client_position_id, sort_number, boq_item_type, work_name_id, quantity, unit_rate, currency_type)
	        VALUES ($1::uuid, $2::uuid, 1, 'раб', $3::uuid, 1, 1, 'RUB')`, f.arch.tgtTenderID, positionID, workName)
}
