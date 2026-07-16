package repository

// Этап 2.6: интеграционные тесты rollout-примитивов против реального
// PostgreSQL (COMPILED + SKIPPED без HUBTENDER_TEST_DATABASE_URL):
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run AiRolloutIntegration -v
//
// Ключевые SQL-инварианты: атомарная резервация квот/бюджета между
// «инстансами» (два пула), reconciliation, crash-recovery, circuit
// half-open probe ровно одному, CAS-переходы, retention cleanup.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func resetAIRollout(t *testing.T, repo *AISettingsRepo) {
	t.Helper()
	ctx := context.Background()
	if _, err := repo.pool.Exec(ctx, `DELETE FROM public.ai_row_feedback`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.pool.Exec(ctx, `DELETE FROM public.ai_usage_requests`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.pool.Exec(ctx, `DELETE FROM public.ai_evaluation_summaries`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.pool.Exec(ctx, `DELETE FROM public.ai_pilot_users`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.pool.Exec(ctx, `
		UPDATE public.ai_feature_settings SET rollout_mode = 'off', last_live_evaluation_id = NULL
		WHERE feature_code = $1`, AIFeatureNomenclatureRerank); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.pool.Exec(ctx, `
		UPDATE public.ai_circuit_state SET circuit_state = 'closed', consecutive_failures = 0, open_until = NULL
		WHERE feature_code = $1`, AIFeatureNomenclatureRerank); err != nil {
		t.Fatal(err)
	}
	resetAISettings(t, repo)
}

func reservationInput(userID string, rows int) AIReservationInput {
	return AIReservationInput{
		FeatureCode:       AIFeatureNomenclatureRerank,
		UserID:            userID,
		ModelID:           "prov/int",
		PromptVersion:     "nomenclature-rerank-v1",
		ConfigHash:        "hash-int",
		RequestHash:       "req-hash",
		RowsCount:         rows,
		CandidatesCount:   20,
		Amount:            "0.01000000",
		DailyRequestLimit: 2,
		DailyRowLimit:     100,
		MonthlyBudget:     "0.02500000",
		TimeoutSeconds:    60,
	}
}

// §25.I: атомарная конкурентная резервация между двумя service instances
// (два независимых pgx-пула) — за последний квотный слот проходит РОВНО один.
func TestAiRolloutIntegration_ConcurrentReservation(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	resetAIRollout(t, repo)
	uid := seedAIAdminUser(t, repo)
	ctx := context.Background()

	// Второй «инстанс» — отдельный пул.
	pool2, err := pgxpool.New(ctx, pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer pool2.Close()
	repo2 := NewAISettingsRepo(pool2)

	// Занимаем 1 из 2 слотов дневной квоты.
	if _, err := repo.ReserveUsage(ctx, reservationInput(uid, 5)); err != nil {
		t.Fatal(err)
	}

	// Гонка за последний слот: 8 конкурентных попыток на двух инстансах.
	var wg sync.WaitGroup
	var okCount, quotaCount int
	var mu sync.Mutex
	for i := 0; i < 8; i++ {
		wg.Add(1)
		r := repo
		if i%2 == 1 {
			r = repo2
		}
		go func(rp *AISettingsRepo) {
			defer wg.Done()
			_, err := rp.ReserveUsage(ctx, reservationInput(uid, 5))
			mu.Lock()
			defer mu.Unlock()
			switch err {
			case nil:
				okCount++
			case ErrAIUserQuotaExhausted:
				quotaCount++
			default:
				t.Errorf("unexpected: %v", err)
			}
		}(r)
	}
	wg.Wait()
	if okCount != 1 || quotaCount != 7 {
		t.Fatalf("last-slot race: ok=%d quota=%d (want 1/7)", okCount, quotaCount)
	}
	resetAIRollout(t, repo)
}

// §25.H: месячный бюджет — конкуренция за последний бюджетный остаток.
func TestAiRolloutIntegration_BudgetRace(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	resetAIRollout(t, repo)
	uid := seedAIAdminUser(t, repo)
	ctx := context.Background()

	// Бюджет 0.025; каждая резервация 0.01 → максимум 2.
	in := reservationInput(uid, 1)
	in.DailyRequestLimit = 100
	var wg sync.WaitGroup
	var ok, budget int
	var mu sync.Mutex
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := repo.ReserveUsage(ctx, in)
			mu.Lock()
			defer mu.Unlock()
			switch err {
			case nil:
				ok++
			case ErrAIBudgetExhausted:
				budget++
			default:
				t.Errorf("unexpected: %v", err)
			}
		}()
	}
	wg.Wait()
	if ok != 2 || budget != 4 {
		t.Fatalf("budget race: ok=%d budget=%d (want 2/4)", ok, budget)
	}
	resetAIRollout(t, repo)
}

// §25.J/K: reconciliation (actual > reserved помечается underestimate) и
// crash-recovery просроченных reservation.
func TestAiRolloutIntegration_ReconcileAndRecovery(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	resetAIRollout(t, repo)
	uid := seedAIAdminUser(t, repo)
	ctx := context.Background()

	res, err := repo.ReserveUsage(ctx, reservationInput(uid, 3))
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.ReconcileUsage(ctx, AIUsageOutcome{
		RequestID: res.RequestID, Status: "completed", ProviderOutcome: "available",
		PromptTokens: 900, CompletionTokens: 200, TotalTokens: 1100,
		ActualProviderCost: "0.01500000", // > reserved 0.01
		EstimatedCost:      "0.00130000",
		LatencyMs:          800,
	}); err != nil {
		t.Fatal(err)
	}
	var status, actual string
	var underestimate bool
	if err := pool.QueryRow(ctx, `
		SELECT request_status, actual_provider_cost::text, reservation_underestimate
		FROM public.ai_usage_requests WHERE id = $1::uuid`, res.RequestID).
		Scan(&status, &actual, &underestimate); err != nil {
		t.Fatal(err)
	}
	if status != "completed" || actual != "0.01500000" || !underestimate {
		t.Fatalf("reconcile: %s %s %v", status, actual, underestimate)
	}
	// Идемпотентность повторного reconcile.
	if err := repo.ReconcileUsage(ctx, AIUsageOutcome{RequestID: res.RequestID, Status: "released"}); err != nil {
		t.Fatal(err)
	}

	// Recovery: истёкшая reservation освобождается.
	res2, err := repo.ReserveUsage(ctx, reservationInput(uid, 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE public.ai_usage_requests SET reservation_expires_at = now() - interval '1 minute'
		WHERE id = $1::uuid`, res2.RequestID); err != nil {
		t.Fatal(err)
	}
	n, err := repo.RecoverExpiredReservations(ctx, AIFeatureNomenclatureRerank)
	if err != nil || n != 1 {
		t.Fatalf("recovery: n=%d err=%v", n, err)
	}
	resetAIRollout(t, repo)
}

// §25.M: circuit breaker между инстансами — half-open probe получает РОВНО
// один из двух пулов.
func TestAiRolloutIntegration_CircuitProbeSingleWinner(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	resetAIRollout(t, repo)
	ctx := context.Background()

	pool2, err := pgxpool.New(ctx, pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	defer pool2.Close()
	repo2 := NewAISettingsRepo(pool2)

	// 3 отказа открывают circuit.
	for i := 0; i < 3; i++ {
		if _, err := repo.CircuitRecordFailure(ctx, AIFeatureNomenclatureRerank, "timeout", 3, 1); err != nil {
			t.Fatal(err)
		}
	}
	c, _ := repo.GetCircuit(ctx, AIFeatureNomenclatureRerank)
	if c.State != "open" {
		t.Fatalf("circuit: %+v", c)
	}
	time.Sleep(1100 * time.Millisecond) // cooldown 1s истёк

	var wg sync.WaitGroup
	var probes int
	var mu sync.Mutex
	for i := 0; i < 6; i++ {
		wg.Add(1)
		r := repo
		if i%2 == 1 {
			r = repo2
		}
		go func(rp *AISettingsRepo) {
			defer wg.Done()
			ok, err := rp.CircuitAllowProbe(ctx, AIFeatureNomenclatureRerank)
			if err != nil {
				t.Error(err)
				return
			}
			if ok {
				mu.Lock()
				probes++
				mu.Unlock()
			}
		}(r)
	}
	wg.Wait()
	if probes != 1 {
		t.Fatalf("half-open probes: %d (want exactly 1)", probes)
	}
	// Успех пробы закрывает.
	if err := repo.CircuitRecordSuccess(ctx, AIFeatureNomenclatureRerank); err != nil {
		t.Fatal(err)
	}
	c, _ = repo2.GetCircuit(ctx, AIFeatureNomenclatureRerank)
	if c.State != "closed" || c.ConsecutiveFailures != 0 {
		t.Fatalf("after success: %+v", c)
	}
	resetAIRollout(t, repo)
}

// Transition CAS + pilot SQL + cleanup.
func TestAiRolloutIntegration_TransitionPilotCleanup(t *testing.T) {
	pool := newTestPool(t)
	repo := NewAISettingsRepo(pool)
	resetAIRollout(t, repo)
	uid := seedAIAdminUser(t, repo)
	ctx := context.Background()

	// CAS: неверный expectedFrom → конфликт.
	if _, err := repo.TransitionRolloutMode(ctx, AIFeatureNomenclatureRerank, "evaluation", "pilot_individual", uid); err != ErrAIRolloutConflict {
		t.Fatalf("CAS: %v", err)
	}
	s, err := repo.TransitionRolloutMode(ctx, AIFeatureNomenclatureRerank, "off", "evaluation", uid)
	if err != nil || s.RolloutMode != "evaluation" {
		t.Fatalf("off→evaluation: %v %+v", err, s)
	}
	prevVersion := s.RolloutConfigVersion

	// Emergency off поднимает версию и возвращает старый режим.
	prev, s2, err := repo.EmergencyOff(ctx, AIFeatureNomenclatureRerank, uid)
	if err != nil || prev != "evaluation" || s2.RolloutMode != "off" || s2.RolloutConfigVersion <= prevVersion {
		t.Fatalf("emergency off: %v %s %+v", err, prev, s2)
	}

	// Pilot: несуществующий user отклоняется; активный добавляется; expired
	// membership не активен; удаление немедленно.
	if _, err := repo.UpsertPilotUser(ctx, AIFeatureNomenclatureRerank, "00000000-0000-0000-0000-00000000dead", false, nil, uid); err != ErrAIPilotUserNotFound {
		t.Fatalf("ghost pilot: %v", err)
	}
	if _, err := repo.UpsertPilotUser(ctx, AIFeatureNomenclatureRerank, uid, true, nil, uid); err != nil {
		t.Fatal(err)
	}
	m, err := repo.GetActivePilotMembership(ctx, AIFeatureNomenclatureRerank, uid)
	if err != nil || m == nil || !m.BulkConfirmationAllowed {
		t.Fatalf("membership: %v %+v", err, m)
	}
	past := time.Now().Add(-time.Hour)
	if _, err := repo.PatchPilotUser(ctx, AIFeatureNomenclatureRerank, uid, AIPilotPatch{ExpiresAt: &past}); err != nil {
		t.Fatal(err)
	}
	if m, _ = repo.GetActivePilotMembership(ctx, AIFeatureNomenclatureRerank, uid); m != nil {
		t.Fatal("expired membership must be inactive")
	}
	if err := repo.RemovePilotUser(ctx, AIFeatureNomenclatureRerank, uid); err != nil {
		t.Fatal(err)
	}

	// Cleanup: старая completed-строка удаляется, reserved — нет.
	res, err := repo.ReserveUsage(ctx, reservationInput(uid, 1))
	if err != nil {
		t.Fatal(err)
	}
	_ = repo.ReconcileUsage(ctx, AIUsageOutcome{RequestID: res.RequestID, Status: "completed", ProviderOutcome: "available"})
	res2, err := repo.ReserveUsage(ctx, reservationInput(uid, 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE public.ai_usage_requests SET created_at = now() - interval '120 days'`); err != nil {
		t.Fatal(err)
	}
	n, err := repo.CleanupExpiredUsage(ctx, AIFeatureNomenclatureRerank, 90*24*time.Hour, 100)
	if err != nil || n != 1 {
		t.Fatalf("cleanup: n=%d err=%v", n, err)
	}
	var status string
	if err := pool.QueryRow(ctx, `
		SELECT request_status FROM public.ai_usage_requests WHERE id = $1::uuid`, res2.RequestID).
		Scan(&status); err != nil {
		t.Fatalf("reserved row must survive cleanup: %v", err)
	}
	resetAIRollout(t, repo)
}
