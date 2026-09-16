package repository

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL integration tests: сохранение прогонов каталога правил и жизненный
// цикл находок (opened → resolved → reopened) с отметкой «Проверка завершена».
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run VerificationRunIntegration -v

type vrFixture struct {
	tenderID string
	p1, p2   string // позиции
	r2       string // строка позиции p2 с нулевой ценой
	workID   string
}

func newVRFixture(t *testing.T, pool *pgxpool.Pool) *vrFixture {
	t.Helper()
	ctx := context.Background()
	workID, _ := ensureTestNames(t, pool)
	f := &vrFixture{workID: workID}

	if err := pool.QueryRow(ctx, `
		INSERT INTO public.tenders (title, client_name, tender_number)
		VALUES ('itest verification', 'itest', 'itest-vr-' || gen_random_uuid()::text)
		RETURNING id::text`).Scan(&f.tenderID); err != nil {
		t.Fatalf("tender: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM public.tenders WHERE id = $1`, f.tenderID)
	})

	f.p1 = vrPosition(t, pool, f.tenderID, 1, 0)
	f.p2 = vrPosition(t, pool, f.tenderID, 2, 5)
	vrRow(t, pool, f, f.p1, 1, 1000)     // правило U: расценена, Кол-во ГП = 0
	f.r2 = vrRow(t, pool, f, f.p2, 2, 0) // правило Q: нулевая цена
	return f
}

func vrPosition(t *testing.T, pool *pgxpool.Pool, tenderID string, num int, manualVolume float64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.client_positions
			(tender_id, position_number, item_no, work_name, unit_code, volume, manual_volume)
		VALUES ($1, $2, $3, 'itest позиция', 'м2', 10, $4)
		RETURNING id::text`, tenderID, num, fmt.Sprint(num), manualVolume).Scan(&id); err != nil {
		t.Fatalf("position %d: %v", num, err)
	}
	return id
}

func vrRow(t *testing.T, pool *pgxpool.Pool, f *vrFixture, positionID string, qty, rate float64) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `
		INSERT INTO public.boq_items
			(tender_id, client_position_id, boq_item_type, work_name_id, unit_code,
			 quantity, unit_rate, total_amount)
		VALUES ($1, $2, 'раб', $3, 'м2', $4, $5, $6)
		RETURNING id::text`, f.tenderID, positionID, f.workID, qty, rate, qty*rate).Scan(&id); err != nil {
		t.Fatalf("boq row: %v", err)
	}
	return id
}

func findFinding(rep *QualityReport, rule, entity string) *Finding {
	for i := range rep.Findings {
		if rep.Findings[i].RuleCode == rule && rep.Findings[i].EntityID == entity {
			return &rep.Findings[i]
		}
	}
	return nil
}

func vrRun(t *testing.T, repo *QualityRepo, tenderID, trigger string) *QualityReport {
	t.Helper()
	rep, persistErr, err := repo.RunAndPersist(context.Background(), tenderID, trigger, nil)
	if err != nil {
		t.Fatalf("run: %v", err)
	}
	if persistErr != nil {
		t.Fatalf("persist: %v", persistErr)
	}
	if !rep.HistoryAvailable || rep.RunID == nil {
		t.Fatalf("история не сохранена: %+v", rep)
	}
	return rep
}

func eventCount(t *testing.T, pool *pgxpool.Pool, findingID, eventType string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), `
		SELECT count(*) FROM public.verification_finding_events
		WHERE finding_id = $1 AND event_type = $2`, findingID, eventType).Scan(&n); err != nil {
		t.Fatalf("events: %v", err)
	}
	return n
}

func TestVerificationRunIntegration_Lifecycle(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewQualityRepo(pool)
	f := newVRFixture(t, pool)

	// 1. Первый прогон: находки сохранены, отметки проверки нет — новых нет.
	rep := vrRun(t, repo, f.tenderID, RunTriggerView)
	h1 := findFinding(rep, "U", f.p1)
	q2 := findFinding(rep, "QA", f.r2)
	if h1 == nil || q2 == nil {
		t.Fatalf("ожидались находки U(p1) и Q(r2), получено %d находок", len(rep.Findings))
	}
	if h1.FindingID == nil || h1.FirstSeenAt == nil || h1.EntityType != "client_position" {
		t.Fatalf("U(p1) без истории или с неверным типом: %+v", h1)
	}
	if q2.EntityType != "boq_item" {
		t.Fatalf("Q(r2) entity_type = %q", q2.EntityType)
	}
	if rep.CheckpointAt != nil || h1.IsNew {
		t.Fatal("без отметки «Проверка завершена» новизны быть не должно")
	}
	hID, qID := *h1.FindingID, *q2.FindingID

	// Находка правила, которого нет в активном каталоге (выключили или заменили),
	// закрывается следующим прогоном, а не висит открытой навсегда.
	var retiredID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.verification_findings
			(tender_id, rule_code, entity_type, entity_id, severity, detail, fingerprint)
		VALUES ($1::uuid, 'ZZ-retired', 'client_position', $2::uuid, 'warning', 'itest', 'fp')
		RETURNING id::text`, f.tenderID, f.p1).Scan(&retiredID); err != nil {
		t.Fatalf("retired finding: %v", err)
	}
	vrRun(t, repo, f.tenderID, RunTriggerView)
	var retiredResolved bool
	if err := pool.QueryRow(ctx, `SELECT resolved_at IS NOT NULL FROM public.verification_findings WHERE id = $1`,
		retiredID).Scan(&retiredResolved); err != nil || !retiredResolved {
		t.Fatalf("находка выключенного правила не закрыта: %v %v", retiredResolved, err)
	}

	var cpID *string
	if err := pool.QueryRow(ctx, `SELECT client_position_id::text FROM public.verification_findings WHERE id = $1`,
		qID).Scan(&cpID); err != nil || cpID == nil || *cpID != f.p2 {
		t.Fatalf("client_position_id строки не проставлен: %v %v", cpID, err)
	}

	// 2. Повтор без изменений идемпотентен: те же id, событий не добавилось.
	rep = vrRun(t, repo, f.tenderID, RunTriggerView)
	if got := findFinding(rep, "U", f.p1); got == nil || *got.FindingID != hID {
		t.Fatal("повторный прогон сменил id находки")
	}
	var opened, reopened, resolved int
	if err := pool.QueryRow(ctx, `SELECT opened_count, reopened_count, resolved_count
		FROM public.verification_runs WHERE id = $1`, *rep.RunID).Scan(&opened, &reopened, &resolved); err != nil {
		t.Fatal(err)
	}
	if opened+reopened+resolved != 0 {
		t.Fatalf("прогон без изменений дал переходы: %d/%d/%d", opened, reopened, resolved)
	}
	if n := eventCount(t, pool, hID, "opened"); n != 1 {
		t.Fatalf("opened у U(p1) = %d, ожидалось 1", n)
	}

	// 3. Отметка «Проверка завершена»: всё текущее — просмотрено.
	rep = vrRun(t, repo, f.tenderID, RunTriggerCheckpoint)
	if rep.CheckpointAt == nil {
		t.Fatal("после отметки checkpoint_at пуст")
	}
	for _, fd := range rep.Findings {
		if fd.IsNew {
			t.Fatalf("сразу после отметки находка %s/%s помечена новой", fd.RuleCode, fd.EntityID)
		}
	}

	// 4. Правки: p1 получил ГП (H уходит), у r2 сменилось количество (Q открывается
	//    заново), появилась позиция p3 без ГП (новая H).
	if _, err := pool.Exec(ctx, `UPDATE public.client_positions SET manual_volume = 3 WHERE id = $1`, f.p1); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE public.boq_items SET quantity = 4, total_amount = 0 WHERE id = $1`, f.r2); err != nil {
		t.Fatal(err)
	}
	p3 := vrPosition(t, pool, f.tenderID, 3, 0)
	vrRow(t, pool, f, p3, 1, 500)

	rep = vrRun(t, repo, f.tenderID, RunTriggerView)
	if findFinding(rep, "U", f.p1) != nil {
		t.Fatal("U(p1) не ушла после проставления ГП")
	}
	q2 = findFinding(rep, "QA", f.r2)
	if q2 == nil || !q2.IsNew || *q2.FindingID != qID {
		t.Fatalf("Q(r2) со сменой отпечатка должна быть новой и с прежним id: %+v", q2)
	}
	if h3 := findFinding(rep, "U", p3); h3 == nil || !h3.IsNew {
		t.Fatalf("U(p3) должна быть новой: %+v", h3)
	}

	var resolvedAt *string
	if err := pool.QueryRow(ctx, `SELECT resolved_at::text FROM public.verification_findings WHERE id = $1`,
		hID).Scan(&resolvedAt); err != nil || resolvedAt == nil {
		t.Fatalf("U(p1) не закрыта в таблице: %v", err)
	}
	if eventCount(t, pool, hID, "resolved") != 1 || eventCount(t, pool, qID, "reopened") != 1 {
		t.Fatal("ожидались события resolved у U(p1) и reopened у Q(r2)")
	}

	// 5. Проблема вернулась: закрытая находка открывается заново и снова новая.
	if _, err := pool.Exec(ctx, `UPDATE public.client_positions SET manual_volume = 0 WHERE id = $1`, f.p1); err != nil {
		t.Fatal(err)
	}
	rep = vrRun(t, repo, f.tenderID, RunTriggerView)
	h1 = findFinding(rep, "U", f.p1)
	if h1 == nil || !h1.IsNew || *h1.FindingID != hID {
		t.Fatalf("вернувшаяся U(p1) должна открыться заново с прежним id: %+v", h1)
	}
	var reopenCount int
	if err := pool.QueryRow(ctx, `SELECT reopen_count FROM public.verification_findings WHERE id = $1`,
		hID).Scan(&reopenCount); err != nil || reopenCount != 1 {
		t.Fatalf("reopen_count = %d (%v), ожидался 1", reopenCount, err)
	}

	// 6. Вердикт попадает в историю находки.
	in := []VerdictInput{{RuleCode: "QA", EntityID: f.r2, Fingerprint: q2.Fingerprint, Verdict: "accepted"}}
	if err := repo.SetVerdicts(ctx, f.tenderID, in, nil); err != nil {
		t.Fatal(err)
	}
	if err := repo.RecordVerdictEvents(ctx, f.tenderID, in, nil); err != nil {
		t.Fatal(err)
	}
	if eventCount(t, pool, qID, "accepted") != 1 {
		t.Fatal("вердикт не записан в историю находки")
	}
}

// Два одновременных прогона не должны падать на уникальном индексе и оба
// сохраняются по очереди — их сериализует advisory-блокировка.
func TestVerificationRunIntegration_ConcurrentRunsSerialize(t *testing.T) {
	pool := newTestPool(t)
	repo := NewQualityRepo(pool)
	f := newVRFixture(t, pool)

	var wg sync.WaitGroup
	errs := make([]error, 4)
	for i := range errs {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, perr, err := repo.RunAndPersist(context.Background(), f.tenderID, RunTriggerView, nil)
			if err == nil {
				err = perr
			}
			errs[i] = err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("прогон %d: %v", i, err)
		}
	}

	var findings, runs int
	if err := pool.QueryRow(context.Background(), `
		SELECT (SELECT count(*) FROM public.verification_findings WHERE tender_id = $1),
		       (SELECT count(*) FROM public.verification_runs WHERE tender_id = $1)`,
		f.tenderID).Scan(&findings, &runs); err != nil {
		t.Fatal(err)
	}
	if runs != 4 || findings == 0 {
		t.Fatalf("runs = %d, findings = %d", runs, findings)
	}
}

// Бэкенд, выкаченный раньше миграции, не должен ломать страницу: находки
// отдаются, сохранение пропускается, ошибка сохранения возвращается отдельно.
func TestVerificationRunIntegration_WithoutMigrationStillReports(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewQualityRepo(pool)
	f := newVRFixture(t, pool)

	if _, err := pool.Exec(ctx, `ALTER TABLE public.verification_runs RENAME TO verification_runs_hidden`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(),
			`ALTER TABLE public.verification_runs_hidden RENAME TO verification_runs`); err != nil {
			t.Errorf("не удалось вернуть таблицу: %v", err)
		}
	})

	rep, persistErr, err := repo.RunAndPersist(ctx, f.tenderID, RunTriggerView, nil)
	if err != nil {
		t.Fatalf("прогон упал целиком: %v", err)
	}
	if persistErr == nil {
		t.Fatal("ожидалась ошибка сохранения")
	}
	if rep.HistoryAvailable || rep.RunID != nil {
		t.Fatal("без таблиц история не может быть доступна")
	}
	h := findFinding(rep, "U", f.p1)
	if h == nil || h.FindingID != nil || h.IsNew {
		t.Fatalf("находка должна прийти без полей истории: %+v", h)
	}
}
