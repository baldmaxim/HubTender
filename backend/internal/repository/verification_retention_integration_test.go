package repository

import (
	"context"
	"testing"
	"time"
)

// Фоновый прогон (trigger auto) и очистка старых прогонов: последняя отметка
// «Проверка завершена» переживает очистку, находки остаются.
func TestVerificationRunIntegration_AutoTriggerAndRetention(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	repo := NewQualityRepo(pool)
	f := newVRFixture(t, pool)

	oldCp := vrRun(t, repo, f.tenderID, RunTriggerCheckpoint)
	lastCp := vrRun(t, repo, f.tenderID, RunTriggerCheckpoint)
	auto := vrRun(t, repo, f.tenderID, RunTriggerAuto)
	fresh := vrRun(t, repo, f.tenderID, RunTriggerView)

	// Состариваем всё, кроме последнего прогона.
	if _, err := pool.Exec(ctx, `
		UPDATE public.verification_runs
		SET started_at = now() - CASE WHEN id = $2::uuid THEN interval '42 days' ELSE interval '40 days' END
		WHERE id = ANY($1::uuid[])`, []string{*oldCp.RunID, *lastCp.RunID, *auto.RunID}, *oldCp.RunID); err != nil {
		t.Fatal(err)
	}

	if _, err := repo.PruneVerificationRuns(ctx, 30*24*time.Hour); err != nil {
		t.Fatal(err)
	}
	left := map[string]bool{}
	rows, err := pool.Query(ctx, `SELECT id::text FROM public.verification_runs WHERE tender_id = $1`, f.tenderID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		left[id] = true
	}
	rows.Close()

	if left[*oldCp.RunID] || left[*auto.RunID] {
		t.Fatalf("старые прогоны не удалены: %v", left)
	}
	if !left[*lastCp.RunID] {
		t.Fatal("последняя отметка проверки удалена — «новое» начнёт считаться от начала")
	}
	if !left[*fresh.RunID] {
		t.Fatal("свежий прогон удалён")
	}

	var findings int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM public.verification_findings WHERE tender_id = $1`,
		f.tenderID).Scan(&findings); err != nil || findings == 0 {
		t.Fatalf("находки пропали после очистки: %d %v", findings, err)
	}

	rep := vrRun(t, repo, f.tenderID, RunTriggerView)
	if rep.CheckpointAt == nil {
		t.Fatal("после очистки отметка проверки не находится")
	}
}
