//go:build integration

package repository

import (
	"context"
	"testing"
)

// Права записи пилота «аналог» на сервере: доступ к /positions и дедлайн тендера.

type anAccessSnap struct {
	rows, apps, sessions, revision int
	totalWorks, grand              string
}

func (f *anFix) accessSnap() anAccessSnap {
	tid := f.arch.tgtTenderID
	return anAccessSnap{
		rows:     f.num(`SELECT count(*)::int FROM public.boq_items WHERE client_position_id = $1::uuid`, f.arch.tgtPosID),
		apps:     f.num(`SELECT count(*)::int FROM public.analog_applications WHERE tender_id = $1::uuid`, tid),
		sessions: f.num(`SELECT count(*)::int FROM public.import_sessions WHERE tender_id = $1::uuid`, tid),
		revision: f.num(`SELECT financial_input_revision::int FROM public.tenders WHERE id = $1::uuid`, tid),
		totalWorks: f.str(`SELECT COALESCE(total_works, 0)::text || '/' || COALESCE(total_material, 0)::text
		                   FROM public.client_positions WHERE id = $1::uuid`, f.arch.tgtPosID),
		grand: f.str(`SELECT COALESCE(cached_grand_total, -1)::text FROM public.tenders WHERE id = $1::uuid`, tid),
	}
}

// anUser создаёт пользователя с ролью и списком страниц; чистит за собой.
func (f *anFix) anUser(tag, role, pages string) string {
	f.t.Helper()
	f.exec(`INSERT INTO public.roles (code, name) VALUES ($1, $1) ON CONFLICT (code) DO NOTHING`, role)
	id := f.str(`SELECT gen_random_uuid()::text`)
	f.exec(`INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)`, id, "itest-"+tag+"-"+id[:8]+"@test.local")
	f.exec(`INSERT INTO public.users (id, email, full_name, role_code, access_status, access_enabled, allowed_pages)
	        VALUES ($1::uuid, $2, $3, $4, 'approved', true, $5::jsonb)`,
		id, "itest-"+tag+"-"+id[:8]+"@test.local", "Itest "+tag, role, pages)
	f.t.Cleanup(func() {
		ctx := context.Background()
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.analog_applications WHERE created_by = $1::uuid OR reverted_by = $1::uuid`, id)
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.import_sessions WHERE user_id = $1::uuid`, id)
		_, _ = f.pool.Exec(ctx, `DELETE FROM public.users WHERE id = $1::uuid`, id)
		_, _ = f.pool.Exec(ctx, `DELETE FROM auth.users WHERE id = $1::uuid`, id)
	})
	return id
}

func (f *anFix) setDeadline(sql string) {
	f.exec(`UPDATE public.tenders SET submission_deadline = `+sql+` WHERE id = $1::uuid`, f.arch.tgtTenderID)
}

func (f *anFix) extend(userID, interval string) {
	f.exec(`UPDATE public.users SET tender_deadline_extensions = jsonb_build_array(jsonb_build_object(
	            'tender_id', $2::text,
	            'extended_deadline', to_char(now() AT TIME ZONE 'UTC' + `+interval+`, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
	        WHERE id = $1::uuid`, userID, f.arch.tgtTenderID)
}

func (f *anFix) inAs(userID string, req AnalogRequest) AnalogExecuteInput {
	in := f.in(req)
	in.UserID = userID
	return in
}

// applyAs: предпросмотр и применение от имени пользователя.
func (f *anFix) applyAs(userID string, req AnalogRequest) (*AnalogApplyResult, error) {
	p, err := f.repo.Preview(context.Background(), f.inAs(userID, req))
	if err != nil {
		return nil, err
	}
	in := f.inAs(userID, req)
	in.PreviewToken, in.IdempotencyKey = p.PreviewToken, f.newKey()
	return f.repo.Apply(context.Background(), in)
}

func TestAnalogIntegration_AccessDeadlinePassedDeniesEverything(t *testing.T) {
	f := anSetup(t, "dl-passed", nil, nil)
	ctx := context.Background()
	req := f.req(ScaleModeVolumeRatio, true)

	// Решение, применённое администратором до истечения дедлайна, — для revert.
	applied := f.mustApply(req)
	eng := f.anUser("eng", "engineer", `[]`)
	f.setDeadline(`now() - interval '1 hour'`)
	before := f.accessSnap()
	rowsBefore := f.targetRows()

	if _, err := f.repo.Preview(ctx, f.inAs(eng, req)); analogErrCode(t, err) != AnalogCodeDeadlinePassed {
		t.Fatalf("preview: %v", err)
	}
	in := f.inAs(eng, req)
	in.PreviewToken, in.IdempotencyKey = "x", f.newKey()
	if _, err := f.repo.Apply(ctx, in); analogErrCode(t, err) != AnalogCodeDeadlinePassed {
		t.Fatalf("apply: %v", err)
	}
	// Повтор чужого ключа не должен отдавать чужой результат.
	_, err := f.repo.Apply(ctx, AnalogExecuteInput{
		PositionID: f.arch.tgtPosID, UserID: eng, Request: req, PreviewToken: "x",
		IdempotencyKey: f.str(`SELECT idempotency_key::text FROM public.analog_applications WHERE id = $1::uuid`, applied.Application.ID),
	})
	if analogErrCode(t, err) != AnalogCodeDeadlinePassed {
		t.Fatalf("replay чужого ключа: %v", err)
	}
	if _, err := f.repo.Revert(ctx, applied.Application.ID, eng); analogErrCode(t, err) != AnalogCodeDeadlinePassed {
		t.Fatalf("revert: %v", err)
	}

	if after := f.accessSnap(); after != before {
		t.Fatalf("БД изменилась после отказов: %+v → %+v", before, after)
	}
	if rows := f.targetRows(); len(rows) != len(rowsBefore) {
		t.Fatalf("строки цели: %d → %d", len(rowsBefore), len(rows))
	}
	if st := f.str(`SELECT status FROM public.analog_applications WHERE id = $1::uuid`, applied.Application.ID); st != AnalogStatusApplied {
		t.Fatalf("применение должно остаться активным, статус %s", st)
	}
}

func TestAnalogIntegration_AccessExtensionAllowsApply(t *testing.T) {
	f := anSetup(t, "dl-ext", nil, nil)
	eng := f.anUser("ext", "engineer", `[]`)
	f.setDeadline(`now() - interval '2 hours'`)
	req := f.req(ScaleModeVolumeRatio, true)

	if _, err := f.applyAs(eng, req); analogErrCode(t, err) != AnalogCodeDeadlinePassed {
		t.Fatalf("без продления: %v", err)
	}
	// Продление раньше дедлайна ничего не открывает.
	f.extend(eng, `interval '-3 hours'`)
	if _, err := f.applyAs(eng, req); analogErrCode(t, err) != AnalogCodeDeadlinePassed {
		t.Fatalf("продление раньше дедлайна: %v", err)
	}
	// Продление в будущем — проходит, в том числе revert.
	f.extend(eng, `interval '2 hours'`)
	res, err := f.applyAs(eng, req)
	if err != nil || res.Replayed || len(f.targetRows()) != 2 {
		t.Fatalf("apply с продлением: %v %+v", err, res)
	}
	if r, err := f.repo.Revert(context.Background(), res.Application.ID, eng); err != nil || !r.Changed {
		t.Fatalf("revert с продлением: %v %+v", err, r)
	}
}

func TestAnalogIntegration_AccessFullRoleIgnoresDeadline(t *testing.T) {
	f := anSetup(t, "dl-lead", nil, nil)
	lead := f.anUser("lead", "veduschiy_inzhener", `[]`)
	f.setDeadline(`now() - interval '1 day'`)
	res, err := f.applyAs(lead, f.req(ScaleModeVolumeRatio, true))
	if err != nil || len(f.targetRows()) != 2 {
		t.Fatalf("ведущий инженер при истёкшем дедлайне: %v %+v", err, res)
	}
}

func TestAnalogIntegration_AccessWithoutPositionsPage(t *testing.T) {
	f := anSetup(t, "no-page", nil, nil)
	ctx := context.Background()
	req := f.req(ScaleModeVolumeRatio, true)
	applied := f.mustApply(req)
	// Дедлайн не истёк (NULL) — отказ именно по странице; ведущий инженер обходит
	// только дедлайн, но не страницы (как hasPageAccess на фронте).
	for _, role := range []string{"engineer", "veduschiy_inzhener"} {
		u := f.anUser("nopage-"+role, role, `["/tenders","/library"]`)
		before := f.accessSnap()
		if _, err := f.repo.Preview(ctx, f.inAs(u, req)); analogErrCode(t, err) != AnalogCodeForbidden {
			t.Fatalf("%s preview: %v", role, err)
		}
		if _, err := f.applyAs(u, req); analogErrCode(t, err) != AnalogCodeForbidden {
			t.Fatalf("%s apply: %v", role, err)
		}
		if _, err := f.repo.Revert(ctx, applied.Application.ID, u); analogErrCode(t, err) != AnalogCodeForbidden {
			t.Fatalf("%s revert: %v", role, err)
		}
		if after := f.accessSnap(); after != before {
			t.Fatalf("%s: БД изменилась: %+v → %+v", role, before, after)
		}
	}
	// Неизвестный пользователь.
	if _, err := f.repo.Preview(ctx, f.inAs("00000000-0000-0000-0000-0000000000ff", req)); analogErrCode(t, err) != AnalogCodeForbidden {
		t.Fatalf("неизвестный пользователь: %v", err)
	}
	// Страница есть — проходит.
	ok := f.anUser("page-ok", "engineer", `["/positions"]`)
	if _, err := f.repo.Preview(ctx, f.inAs(ok, req)); err != nil {
		t.Fatalf("с /positions: %v", err)
	}
	// Администратору страницы не нужны — как canManageUsers на фронте.
	admin := f.anUser("nopage-admin", "administrator", `["/tenders","/library"]`)
	if _, err := f.repo.Preview(ctx, f.inAs(admin, req)); err != nil {
		t.Fatalf("администратор без /positions: %v", err)
	}
}
