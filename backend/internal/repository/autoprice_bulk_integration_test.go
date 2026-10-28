package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgreSQL-интеграция пакетной записи авторасценки:
//
//	HUBTENDER_TEST_DATABASE_URL='postgres://…/hubtender_test?sslmode=disable' \
//	  go test ./internal/repository/ -run AutopriceBulkIntegration -v

type abFixture struct {
	pool                 *pgxpool.Pool
	repo                 *AutopriceReviewRepo
	boq                  *BoqRepo
	tenderID, pos1, pos2 string
	runID                string
	workNameID, matID    string
}

func abSetup(t *testing.T, tag string) *abFixture {
	t.Helper()
	pool := newTestPool(t)
	ctx := context.Background()
	f := &abFixture{pool: pool, repo: NewAutopriceReviewRepo(pool), boq: NewBoqRepo(pool)}
	f.tenderID, f.pos1 = seedSourceTender(t, pool, tag)
	f.workNameID, f.matID = ensureTestNames(t, pool)
	if err := pool.QueryRow(ctx, `
		INSERT INTO public.client_positions (tender_id, position_number, work_name)
		VALUES ($1::uuid, 2, 'p2') RETURNING id::text`, f.tenderID).Scan(&f.pos2); err != nil {
		t.Fatalf("seed pos2: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM public.import_sessions WHERE tender_id=$1::uuid`, f.tenderID)
	})
	run, err := f.repo.CreateRun(ctx, f.tenderID, rbActor, "прогон", nil)
	if err != nil {
		t.Fatal(err)
	}
	f.runID = run.ID
	return f
}

func (f *abFixture) work(ref string, qty, rate float64) AutopriceBulkItem {
	return AutopriceBulkItem{Ref: ref, Item: CreateBoqItemInput{
		BoqItemType: "раб", WorkNameID: &f.workNameID, UnitCode: sptr("м2"),
		Quantity: fptr(qty), UnitRate: fptr(rate), CurrencyType: sptr("RUB"),
	}}
}

func (f *abFixture) mat(ref, parent string, qty, rate float64) AutopriceBulkItem {
	return AutopriceBulkItem{Ref: ref, ParentRef: parent, Item: CreateBoqItemInput{
		BoqItemType: "мат", MaterialType: sptr("основн."), MaterialNameID: &f.matID, UnitCode: sptr("шт"),
		Quantity: fptr(qty), UnitRate: fptr(rate), CurrencyType: sptr("RUB"),
		DeliveryPriceType: sptr("в цене"), ConversionCoefficient: fptr(1), ConsumptionCoefficient: fptr(1),
	}}
}

func (f *abFixture) count(t *testing.T, q string, args ...any) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(context.Background(), q, args...).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func (f *abFixture) runRows(t *testing.T, pos string) int {
	return f.count(t, `SELECT count(*)::int FROM public.boq_items WHERE client_position_id=$1::uuid AND import_session_id=$2::uuid`, pos, f.runID)
}

func (f *abFixture) itemsCount(t *testing.T) int {
	return f.count(t, `SELECT items_count FROM public.import_sessions WHERE id=$1::uuid`, f.runID)
}

func (f *abFixture) inputRevision(t *testing.T) int {
	return f.count(t, `SELECT financial_input_revision::int FROM public.tenders WHERE id=$1::uuid`, f.tenderID)
}

func (f *abFixture) write(items []AutopriceBulkItem, review *AutopriceReviewInput, pos string, replace bool) (*AutopriceBulkResult, error) {
	return f.repo.BulkWrite(context.Background(), f.runID, rbActor, []AutopriceBulkPosition{
		{PositionID: pos, Replace: replace, Items: items, Review: review}})
}

func TestAutopriceBulkIntegration_ParentRefTotalsAndOrder(t *testing.T) {
	f := abSetup(t, "AB-1")
	ctx := context.Background()
	rev0 := f.inputRevision(t)

	// Материал раньше работы в запросе: ответ идёт в порядке запроса, а родитель
	// проставляется по ref вставленной работы.
	res, err := f.write([]AutopriceBulkItem{f.mat("m1", "w1", 3, 10), f.work("w1", 2, 100), f.mat("m2", "", 1, 7)},
		&AutopriceReviewInput{Basis: sptr("ASSUMED")}, f.pos1, false)
	if err != nil {
		t.Fatalf("bulk: %v", err)
	}
	if res.TenderID != f.tenderID || len(res.Positions) != 1 {
		t.Fatalf("result: %+v", res)
	}
	pr := res.Positions[0]
	if len(pr.Items) != 3 || pr.Items[0].Ref != "m1" || pr.Items[1].Ref != "w1" || pr.Items[2].Ref != "m2" {
		t.Fatalf("порядок: %+v", pr.Items)
	}
	if pr.Items[0].ParentWorkItemID == nil || *pr.Items[0].ParentWorkItemID != pr.Items[1].ID ||
		pr.Items[1].ParentWorkItemID != nil || pr.Items[2].ParentWorkItemID != nil {
		t.Fatalf("parent_work_item_id: %+v", pr.Items)
	}
	if pr.Review == nil || pr.Review.Status != AutopriceStatusPending || pr.Review.Basis == nil || *pr.Review.Basis != "ASSUMED" {
		t.Fatalf("review: %+v", pr.Review)
	}
	if pr.Items[1].TotalAmount == nil || *pr.Items[1].TotalAmount != 200 || *pr.Items[0].TotalAmount != 30 {
		t.Fatalf("total_amount: work=%v mat=%v", pr.Items[1].TotalAmount, pr.Items[0].TotalAmount)
	}

	if n := f.runRows(t, f.pos1); n != 3 {
		t.Fatalf("строк прогона = %d, want 3", n)
	}
	if n := f.itemsCount(t); n != 3 {
		t.Fatalf("items_count = %d, want 3", n)
	}
	if rev := f.inputRevision(t); rev != rev0+1 {
		t.Fatalf("ревизия: %d, want %d (одна на запрос)", rev, rev0+1)
	}
	// Итоги позиции = суммы total_amount по типам; sort_number — порядок запроса.
	var tm, tw, sumMat, sumWork float64
	if err := f.pool.QueryRow(ctx, `SELECT total_material::float8, total_works::float8 FROM public.client_positions WHERE id=$1::uuid`, f.pos1).Scan(&tm, &tw); err != nil {
		t.Fatal(err)
	}
	if err := f.pool.QueryRow(ctx, `
		SELECT COALESCE(sum(total_amount) FILTER (WHERE boq_item_type::text='мат'),0)::float8,
		       COALESCE(sum(total_amount) FILTER (WHERE boq_item_type::text='раб'),0)::float8
		FROM public.boq_items WHERE client_position_id=$1::uuid`, f.pos1).Scan(&sumMat, &sumWork); err != nil {
		t.Fatal(err)
	}
	if tm != sumMat || tw != sumWork || tm != 37 || tw != 200 {
		t.Fatalf("итоги позиции: material=%v works=%v, суммы строк: %v %v", tm, tw, sumMat, sumWork)
	}
	var sortW int
	_ = f.pool.QueryRow(ctx, `SELECT sort_number FROM public.boq_items WHERE id=$1::uuid`, pr.Items[1].ID).Scan(&sortW)
	if sortW != 1 {
		t.Fatalf("sort_number работы = %d, want 1 (индекс в запросе)", sortW)
	}
	// Аудит INSERT с автором — по строке, дублей триггера нет.
	if n := f.count(t, `SELECT count(*)::int FROM public.boq_items_audit WHERE boq_item_id = ANY($1::uuid[]) AND operation_type='INSERT' AND changed_by=$2::uuid`,
		[]string{pr.Items[0].ID, pr.Items[1].ID, pr.Items[2].ID}, rbActor); n != 3 {
		t.Fatalf("аудит INSERT = %d, want 3", n)
	}
	if n := f.count(t, `SELECT count(*)::int FROM public.boq_items_audit WHERE boq_item_id = ANY($1::uuid[])`,
		[]string{pr.Items[0].ID, pr.Items[1].ID, pr.Items[2].ID}); n != 3 {
		t.Fatalf("всего записей аудита = %d, want 3", n)
	}
}

func TestAutopriceBulkIntegration_RollsBackWholeRequest(t *testing.T) {
	f := abSetup(t, "AB-2")
	ctx := context.Background()
	rev0 := f.inputRevision(t)

	bad := f.work("w2", 1, 5)
	missing := "99999999-9999-4999-8999-999999999999"
	bad.Item.WorkNameID = &missing // нет в справочнике → FK 23503 на второй позиции

	_, err := f.repo.BulkWrite(ctx, f.runID, rbActor, []AutopriceBulkPosition{
		{PositionID: f.pos1, Items: []AutopriceBulkItem{f.work("w1", 1, 5), f.mat("m1", "w1", 2, 3)}, Review: &AutopriceReviewInput{}},
		{PositionID: f.pos2, Items: []AutopriceBulkItem{f.work("ok", 1, 1), bad}},
	})
	var be *AutopriceBulkError
	if !errors.As(err, &be) || be.PositionID != f.pos2 || be.Ref != "w2" {
		t.Fatalf("want AutopriceBulkError(pos2, w2), got %v", err)
	}
	if n := f.count(t, `SELECT count(*)::int FROM public.boq_items WHERE tender_id=$1::uuid`, f.tenderID); n != 0 {
		t.Fatalf("после отката в БД %d строк", n)
	}
	if n := f.count(t, `SELECT count(*)::int FROM public.autoprice_position_reviews WHERE import_session_id=$1::uuid`, f.runID); n != 0 {
		t.Fatalf("карточка записана вопреки откату: %d", n)
	}
	if n := f.itemsCount(t); n != 0 {
		t.Fatalf("items_count = %d, want 0", n)
	}
	if rev := f.inputRevision(t); rev != rev0 {
		t.Fatalf("ревизия тендера изменилась: %d → %d", rev0, rev)
	}
	var tm, tw float64
	_ = f.pool.QueryRow(ctx, `SELECT COALESCE(total_material,0)::float8, COALESCE(total_works,0)::float8 FROM public.client_positions WHERE id=$1::uuid`, f.pos1).Scan(&tm, &tw)
	if tm != 0 || tw != 0 {
		t.Fatalf("итоги позиции изменились: %v %v", tm, tw)
	}
}

func TestAutopriceBulkIntegration_ReplaceTouchesOnlyOwnRun(t *testing.T) {
	f := abSetup(t, "AB-3")
	ctx := context.Background()

	run2, err := f.repo.CreateRun(ctx, f.tenderID, rbActor, "другой прогон", nil)
	if err != nil {
		t.Fatal(err)
	}
	manualID := apAddItem(t, f.boq, f.tenderID, f.pos1, f.matID, 11, nil)
	otherRunID := apAddItem(t, f.boq, f.tenderID, f.pos1, f.matID, 12, &run2.ID)

	first, err := f.write([]AutopriceBulkItem{f.work("w1", 1, 100), f.mat("m1", "w1", 1, 10)}, nil, f.pos1, false)
	if err != nil {
		t.Fatal(err)
	}
	oldIDs := []string{first.Positions[0].Items[0].ID, first.Positions[0].Items[1].ID}
	if n := f.itemsCount(t); n != 2 {
		t.Fatalf("items_count = %d, want 2", n)
	}

	second, err := f.write([]AutopriceBulkItem{f.work("w9", 3, 50)}, nil, f.pos1, true)
	if err != nil {
		t.Fatalf("replace: %v", err)
	}
	if n := f.count(t, `SELECT count(*)::int FROM public.boq_items WHERE id = ANY($1::uuid[])`, oldIDs); n != 0 {
		t.Fatalf("старые строки прогона остались: %d", n)
	}
	for name, id := range map[string]string{"ручная": manualID, "другого прогона": otherRunID} {
		if n := f.count(t, `SELECT count(*)::int FROM public.boq_items WHERE id=$1::uuid`, id); n != 1 {
			t.Fatalf("строка %s удалена", name)
		}
	}
	if n := f.runRows(t, f.pos1); n != 1 {
		t.Fatalf("строк прогона = %d, want 1", n)
	}
	if n := f.itemsCount(t); n != 1 {
		t.Fatalf("items_count = %d, want 1 (2 − 2 + 1)", n)
	}
	if n := f.count(t, `SELECT items_count FROM public.import_sessions WHERE id=$1::uuid`, run2.ID); n != 1 {
		t.Fatalf("items_count чужого прогона = %d, want 1", n)
	}
	// Аудит DELETE по каждой удалённой строке, с автором.
	if n := f.count(t, `SELECT count(*)::int FROM public.boq_items_audit WHERE boq_item_id = ANY($1::uuid[]) AND operation_type='DELETE' AND changed_by=$2::uuid`, oldIDs, rbActor); n != 2 {
		t.Fatalf("аудит DELETE = %d, want 2", n)
	}
	// Итоги = суммы оставшихся строк: ручная и чужого прогона (мат, 2×11 и 2×12) + новая работа 150.
	var tm, tw float64
	_ = f.pool.QueryRow(ctx, `SELECT total_material::float8, total_works::float8 FROM public.client_positions WHERE id=$1::uuid`, f.pos1).Scan(&tm, &tw)
	if tm != 46 || tw != 150 || second.Positions[0].Items[0].TotalAmount == nil || *second.Positions[0].Items[0].TotalAmount != 150 {
		t.Fatalf("итоги позиции: material=%v works=%v", tm, tw)
	}
}

func TestAutopriceBulkIntegration_ReplaceRefusesForeignChildren(t *testing.T) {
	f := abSetup(t, "AB-4")
	res, err := f.write([]AutopriceBulkItem{f.work("w1", 1, 100)}, nil, f.pos1, false)
	if err != nil {
		t.Fatal(err)
	}
	workID := res.Positions[0].Items[0].ID
	child := f.mat("x", "", 1, 5).Item
	child.ClientPositionID, child.TenderID, child.ParentWorkItemID, child.CreatedBy = f.pos1, f.tenderID, &workID, rbActor
	childRow, err := f.boq.CreateBoqItem(context.Background(), child) // ручной материал под работой прогона
	if err != nil {
		t.Fatal(err)
	}

	_, err = f.write([]AutopriceBulkItem{f.work("w2", 1, 1)}, nil, f.pos1, true)
	if !errors.Is(err, ErrAutopriceForeignChildren) {
		t.Fatalf("want ErrAutopriceForeignChildren, got %v", err)
	}
	if n := f.count(t, `SELECT count(*)::int FROM public.boq_items WHERE id = ANY($1::uuid[])`, []string{workID, childRow.ID}); n != 2 {
		t.Fatalf("строки удалены вопреки отказу: осталось %d из 2", n)
	}
}

func TestAutopriceBulkIntegration_ApprovedBlocksAnyWrite(t *testing.T) {
	f := abSetup(t, "AB-5")
	ctx := context.Background()
	if _, err := f.write([]AutopriceBulkItem{f.work("w1", 1, 100)}, &AutopriceReviewInput{}, f.pos1, false); err != nil {
		t.Fatal(err)
	}
	if _, err := f.repo.ApplyAction(ctx, f.runID, f.pos1, rbActor, "approve", "ок"); err != nil {
		t.Fatalf("approve: %v", err)
	}

	cases := map[string]AutopriceBulkPosition{
		"items":   {PositionID: f.pos1, Items: []AutopriceBulkItem{f.work("w2", 1, 1)}},
		"replace": {PositionID: f.pos1, Replace: true},
		"review":  {PositionID: f.pos1, Review: &AutopriceReviewInput{Basis: sptr("ASSUMED")}},
	}
	for name, p := range cases {
		// Вторая, неподтверждённая позиция в том же запросе не должна записаться.
		_, err := f.repo.BulkWrite(ctx, f.runID, rbActor, []AutopriceBulkPosition{
			{PositionID: f.pos2, Items: []AutopriceBulkItem{f.work("ok", 1, 1)}}, p})
		var be *AutopriceBulkError
		if !errors.Is(err, ErrAutopriceApproved) || !errors.As(err, &be) || be.PositionID != f.pos1 {
			t.Fatalf("%s: want approved for pos1, got %v", name, err)
		}
	}
	if n := f.runRows(t, f.pos1); n != 1 {
		t.Fatalf("строки подтверждённой позиции изменились: %d", n)
	}
	if n := f.runRows(t, f.pos2); n != 0 {
		t.Fatalf("вторая позиция записана вопреки отказу: %d", n)
	}
}

func TestAutopriceBulkIntegration_RunAndPositionChecks(t *testing.T) {
	f := abSetup(t, "AB-6")
	ctx := context.Background()
	otherTender, otherPos := seedSourceTender(t, f.pool, "AB-6b")
	_ = otherTender

	_, err := f.write([]AutopriceBulkItem{f.work("w1", 1, 1)}, nil, otherPos, false)
	var be *AutopriceBulkError
	if !errors.Is(err, ErrAutopricePositionNotFound) || !errors.As(err, &be) || be.PositionID != otherPos {
		t.Fatalf("чужая позиция: %v", err)
	}
	_, err = f.repo.BulkWrite(ctx, "99999999-9999-4999-8999-999999999999", rbActor,
		[]AutopriceBulkPosition{{PositionID: f.pos1}})
	if !errors.Is(err, ErrAutopriceRunNotFound) {
		t.Fatalf("нет прогона: %v", err)
	}
	if _, err := f.pool.Exec(ctx, `UPDATE public.import_sessions SET cancelled_at = now() WHERE id=$1::uuid`, f.runID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.write([]AutopriceBulkItem{f.work("w1", 1, 1)}, nil, f.pos1, false); !errors.Is(err, ErrAutopriceRunCancelled) {
		t.Fatalf("отменённый прогон: %v", err)
	}
}
