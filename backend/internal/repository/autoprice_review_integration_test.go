package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL-интеграция подтверждения авторасценки:
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run AutopriceIntegration -v

const apOtherUser = "7a1f2b3c-4d5e-46f7-a8b9-c0d1e2f3a4c6"

func apSeedOtherUser(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, q := range []string{
		`INSERT INTO public.roles (code, name, color) VALUES ('administrator', 'Администратор', '#f00') ON CONFLICT (code) DO NOTHING`,
		`INSERT INTO auth.users (id, email) VALUES ('` + apOtherUser + `'::uuid, 'ap-other@example.com') ON CONFLICT (id) DO NOTHING`,
		`INSERT INTO public.users (id, email, full_name, role_code, access_enabled, access_status)
		 VALUES ('` + apOtherUser + `'::uuid, 'ap-other@example.com', 'AP Other', 'administrator', true, 'approved')
		 ON CONFLICT (id) DO NOTHING`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed other user: %v", err)
		}
	}
}

func apAddItem(t *testing.T, boq *BoqRepo, tenderID, posID, matID string, rate float64, session *string) string {
	t.Helper()
	item, err := boq.CreateBoqItem(context.Background(), CreateBoqItemInput{
		TenderID: tenderID, ClientPositionID: posID, BoqItemType: "мат",
		MaterialType: sptr("основн."), MaterialNameID: &matID, UnitCode: sptr("шт"),
		Quantity: fptr(2), UnitRate: fptr(rate), CurrencyType: sptr("RUB"),
		DeliveryPriceType: sptr("в цене"), ConversionCoefficient: fptr(1),
		ConsumptionCoefficient: fptr(1), CreatedBy: rbActor, ImportSessionID: session,
	})
	if err != nil {
		t.Fatalf("create item: %v", err)
	}
	return item.ID
}

func apPause(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `SELECT pg_sleep(0.05)`); err != nil {
		t.Fatal(err)
	}
}

func apReview(t *testing.T, repo *AutopriceReviewRepo, sid, pos string) *AutopriceReview {
	t.Helper()
	rv, err := repo.GetReview(context.Background(), sid, pos)
	if err != nil {
		t.Fatalf("get review: %v", err)
	}
	return rv
}

func TestAutopriceIntegration_ApprovalStale(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	tenderID, posID := seedSourceTender(t, pool, "AP-A")
	_, matID := ensureTestNames(t, pool)
	repo, boq := NewAutopriceReviewRepo(pool), NewBoqRepo(pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.import_sessions WHERE tender_id=$1::uuid`, tenderID)
	})

	run, err := repo.CreateRun(ctx, tenderID, rbActor, "прогон", sptr("run.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got, err := repo.TenderOfRun(ctx, run.ID); err != nil || got != tenderID {
		t.Fatalf("TenderOfRun = %q, %v", got, err)
	}

	// Привязка строки к прогону: счётчик +1; чужой тендер/несуществующая сессия — отказ.
	itemA := apAddItem(t, boq, tenderID, posID, matID, 10, &run.ID)
	apAddItem(t, boq, tenderID, posID, matID, 0, nil) // ручная строка с нулевой ценой
	var cnt int
	_ = pool.QueryRow(ctx, `SELECT items_count FROM public.import_sessions WHERE id=$1::uuid`, run.ID).Scan(&cnt)
	if cnt != 1 {
		t.Fatalf("items_count = %d, want 1", cnt)
	}
	otherTender, _ := seedSourceTender(t, pool, "AP-A2")
	bad := run.ID
	if _, err := boq.CreateBoqItem(ctx, CreateBoqItemInput{
		TenderID: otherTender, ClientPositionID: posID, BoqItemType: "мат", MaterialNameID: &matID,
		Quantity: fptr(1), UnitRate: fptr(1), CreatedBy: rbActor, ImportSessionID: &bad,
	}); err == nil {
		t.Fatal("session of another tender must be rejected")
	} else {
		var is *InvalidImportSessionError
		if !errors.As(err, &is) {
			t.Fatalf("want InvalidImportSessionError, got %v", err)
		}
	}

	if _, err := repo.UpsertReview(ctx, run.ID, posID, rbActor, AutopriceReviewInput{Basis: sptr("ASSUMED")}); err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Нулевая цена в любой строке позиции — подтвердить нельзя.
	_, err = repo.ApplyAction(ctx, run.ID, posID, rbActor, "approve", "")
	var zp *AutopriceZeroPriceError
	if !errors.As(err, &zp) || zp.Count != 1 {
		t.Fatalf("want zero price error with count 1, got %v", err)
	}
	if rv := apReview(t, repo, run.ID, posID); rv.ZeroPriceCount != 1 || rv.ItemsCount != 2 {
		t.Fatalf("counts: zero=%d items=%d", rv.ZeroPriceCount, rv.ItemsCount)
	}
	var zeroID string
	_ = pool.QueryRow(ctx, `SELECT id::text FROM public.boq_items WHERE client_position_id=$1::uuid AND unit_rate=0`, posID).Scan(&zeroID)
	if _, err := boq.UpdateBoqItem(ctx, zeroID, BoqItemPatch{UnitRate: fptr(5), ChangedBy: rbActor}); err != nil {
		t.Fatal(err)
	}

	apPause(t, pool)
	if rv, err := repo.ApplyAction(ctx, run.ID, posID, rbActor, "approve", "ок"); err != nil || rv.Status != "approved" || rv.ApprovalStale || rv.ApprovedByName == nil {
		t.Fatalf("approve: %+v, %v", rv, err)
	}
	if _, err := repo.PatchReview(ctx, run.ID, posID, rbActor, AutopriceReviewPatch{EngineerComment: sptr("x")}); !errors.Is(err, ErrAutopriceApproved) {
		t.Fatalf("patch on approved: %v", err)
	}
	if _, err := repo.UpsertReview(ctx, run.ID, posID, rbActor, AutopriceReviewInput{}); !errors.Is(err, ErrAutopriceApproved) {
		t.Fatalf("upsert on approved: %v", err)
	}

	// Количество не снимает подтверждение.
	apPause(t, pool)
	if _, err := boq.UpdateBoqItem(ctx, itemA, BoqItemPatch{Quantity: fptr(7), ChangedBy: rbActor}); err != nil {
		t.Fatal(err)
	}
	if apReview(t, repo, run.ID, posID).ApprovalStale {
		t.Fatal("quantity change must not make approval stale")
	}
	run1, _ := repo.GetRun(ctx, run.ID)
	if run1.ApprovedCount != 1 || run1.UnapprovedCount != 0 {
		t.Fatalf("run counters after qty change: %+v", run1)
	}

	// Цена снимает.
	apPause(t, pool)
	if _, err := boq.UpdateBoqItem(ctx, itemA, BoqItemPatch{UnitRate: fptr(11), ChangedBy: rbActor}); err != nil {
		t.Fatal(err)
	}
	if !apReview(t, repo, run.ID, posID).ApprovalStale {
		t.Fatal("unit_rate change must make approval stale")
	}
	reviews, err := repo.ListReviews(ctx, run.ID)
	if err != nil || len(reviews) != 1 || !reviews[0].ApprovalStale || reviews[0].Events != nil {
		t.Fatalf("list: %+v, %v", reviews, err)
	}
	run2, _ := repo.GetRun(ctx, run.ID)
	if run2.PositionsTotal != 1 || run2.ApprovedCount != 0 || run2.UnapprovedCount != 1 {
		t.Fatalf("run counters after rate change: %+v", run2)
	}

	// Карточка: origin/machine/changed.
	d, err := repo.GetPositionDetail(ctx, run.ID, posID)
	if err != nil || len(d.Items) != 2 {
		t.Fatalf("detail: %+v, %v", d, err)
	}
	for _, it := range d.Items {
		switch it.ID {
		case itemA:
			if it.Origin != "auto" || it.Machine == nil || it.Machine.UnitRate == nil || *it.Machine.UnitRate != 10 ||
				len(it.Changed) != 1 || it.Changed[0] != "unit_rate" {
				t.Fatalf("auto item: %+v machine=%+v", it, it.Machine)
			}
		default:
			if it.Origin != "manual" || it.Machine != nil || len(it.Changed) != 0 {
				t.Fatalf("manual item: %+v", it)
			}
		}
	}

	// reopen → approve снова чистит устаревание; удаление строки снова снимает.
	if _, err := repo.ApplyAction(ctx, run.ID, posID, rbActor, "reopen", ""); err != nil {
		t.Fatal(err)
	}
	apPause(t, pool)
	if rv, err := repo.ApplyAction(ctx, run.ID, posID, rbActor, "approve", ""); err != nil || rv.ApprovalStale {
		t.Fatalf("re-approve: %+v, %v", rv, err)
	}
	apPause(t, pool)
	if _, err := boq.DeleteBoqItem(ctx, zeroID, rbActor); err != nil {
		t.Fatal(err)
	}
	if !apReview(t, repo, run.ID, posID).ApprovalStale {
		t.Fatal("DELETE must make approval stale")
	}
	if d, _ := repo.GetPositionDetail(ctx, run.ID, posID); len(d.Deleted) != 1 || d.Deleted[0].BoqItemID != zeroID {
		t.Fatalf("deleted list: %+v", d.Deleted)
	}
	if tn, _ := repo.ListTenders(ctx); len(tn) == 0 {
		t.Fatal("ListTenders must include tender with live run")
	}
}

func TestAutopriceIntegration_CancelGuard(t *testing.T) {
	pool := newTestPool(t)
	ctx := context.Background()
	apSeedOtherUser(t, pool)
	tenderID, posID := seedSourceTender(t, pool, "AP-B")
	_, matID := ensureTestNames(t, pool)
	repo, boq, logRepo := NewAutopriceReviewRepo(pool), NewBoqRepo(pool), NewImportLogRepo(pool)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.import_sessions WHERE tender_id=$1::uuid`, tenderID)
	})
	newRun := func(rate float64) (string, string) {
		run, err := repo.CreateRun(ctx, tenderID, rbActor, "r", nil)
		if err != nil {
			t.Fatal(err)
		}
		return run.ID, apAddItem(t, boq, tenderID, posID, matID, rate, &run.ID)
	}

	// 1) подтверждённая позиция — отмена запрещена.
	sid, _ := newRun(10)
	if _, err := repo.UpsertReview(ctx, sid, posID, rbActor, AutopriceReviewInput{}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ApplyAction(ctx, sid, posID, rbActor, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := logRepo.CancelSession(ctx, sid, rbActor, false); !errors.Is(err, ErrImportSessionAutopriceProtected) {
		t.Fatalf("approved: want protected, got %v", err)
	}

	// 2) правка строки другим пользователем — отмена запрещена.
	sid2, item2 := newRun(10)
	if _, err := boq.UpdateBoqItem(ctx, item2, BoqItemPatch{UnitRate: fptr(12), ChangedBy: apOtherUser}); err != nil {
		t.Fatal(err)
	}
	if _, err := logRepo.CancelSession(ctx, sid2, rbActor, false); !errors.Is(err, ErrImportSessionAutopriceProtected) {
		t.Fatalf("foreign edit: want protected, got %v", err)
	}

	// 3) без подтверждений и чужих правок (своя правка автором — не в счёт) — отменяется.
	sid3, item3 := newRun(10)
	if _, err := boq.UpdateBoqItem(ctx, item3, BoqItemPatch{UnitRate: fptr(12), ChangedBy: rbActor}); err != nil {
		t.Fatal(err)
	}
	res, err := logRepo.CancelSession(ctx, sid3, rbActor, false)
	if err != nil || res.BoqDeleted != 1 {
		t.Fatalf("clean cancel: %+v, %v", res, err)
	}
}
