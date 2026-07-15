package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// ─── fakes ───────────────────────────────────────────────────────────────────

// fakeBoqRepo implements boqRepoer; only InsertTemplateItems is exercised.
type fakeBoqRepo struct {
	res  *repository.TemplateInsertResult
	err  error
	call int
}

func (f *fakeBoqRepo) InsertTemplateItems(_ context.Context, _, _, _ string) (*repository.TemplateInsertResult, error) {
	f.call++
	return f.res, f.err
}

func (f *fakeBoqRepo) ListBoqItems(context.Context, string, string) ([]repository.BoqItemRow, error) {
	panic("not used")
}
func (f *fakeBoqRepo) GetBoqItemByID(context.Context, string) (*repository.BoqItemRow, error) {
	panic("not used")
}
func (f *fakeBoqRepo) CreateBoqItem(context.Context, repository.CreateBoqItemInput) (*repository.BoqItemRow, error) {
	panic("not used")
}
func (f *fakeBoqRepo) UpdateBoqItem(context.Context, string, repository.BoqItemPatch) (*repository.BoqItemRow, error) {
	panic("not used")
}
func (f *fakeBoqRepo) DeleteBoqItem(context.Context, string, string) (*repository.BoqItemRow, error) {
	panic("not used")
}
func (f *fakeBoqRepo) RecomputeLinkedMaterialsForWork(context.Context, string, string) (int, error) {
	panic("not used")
}
func (f *fakeBoqRepo) CopyPositionItems(context.Context, string, string, string) (*repository.CopyResult, error) {
	panic("not used")
}

// countingEnqueuer records every recalc enqueue.
type countingEnqueuer struct{ enqueued []string }

func (e *countingEnqueuer) Enqueue(tenderID string) {
	e.enqueued = append(e.enqueued, tenderID)
}

// ─── §9. On a repository/domain error the service must have NO side effects ──

func TestInsertTemplateItems_ErrorHasNoSideEffects(t *testing.T) {
	const tenderID = "tender-1"
	overviewKey := "tender:overview:" + tenderID

	c := cache.New()
	c.Set(overviewKey, "cached-overview", time.Minute)
	c.Set(tenderListKeyPrefix+"all", "cached-list", time.Minute)

	enq := &countingEnqueuer{}

	// The repository fails with a blocking domain error (as an invalid template
	// parent would), wrapped exactly as the real repository wraps it.
	domainErr := &repository.InvalidTemplateParentError{
		TemplateItemID: "m1", ParentTemplateItemID: "m0",
		Reason: repository.ParentNotWorkItem, ParentItemType: "мат",
	}
	repo := &fakeBoqRepo{err: domainErr}

	svc := &BoqService{repo: repo, cache: c, recalc: enq}

	res, err := svc.InsertTemplateItems(context.Background(), "tmpl", "pos", "user")

	// 1. No success result reaches the caller/frontend.
	if res != nil {
		t.Fatalf("result must be nil on error, got %+v", res)
	}
	// 2. The domain error survives the service's %w wrapping.
	var pe *repository.InvalidTemplateParentError
	if !errors.As(err, &pe) {
		t.Fatalf("errors.As must find InvalidTemplateParentError, got %v", err)
	}
	// 3. Cache was NOT invalidated.
	if _, ok := c.Get(overviewKey); !ok {
		t.Fatal("cache.Delete must NOT be called on error (overview key was evicted)")
	}
	if _, ok := c.Get(tenderListKeyPrefix + "all"); !ok {
		t.Fatal("cache.DeleteByPrefix must NOT be called on error (tender list was evicted)")
	}
	// 4. Recalc was NOT enqueued.
	if len(enq.enqueued) != 0 {
		t.Fatalf("enqueueRecalc must NOT be called on error, got %v", enq.enqueued)
	}
}

// Sanity counterpart: on success the side effects DO run, so the test above is
// actually proving something.
func TestInsertTemplateItems_SuccessTriggersSideEffects(t *testing.T) {
	const tenderID = "tender-1"
	overviewKey := "tender:overview:" + tenderID

	c := cache.New()
	c.Set(overviewKey, "cached-overview", time.Minute)

	enq := &countingEnqueuer{}
	repo := &fakeBoqRepo{res: &repository.TemplateInsertResult{
		TotalInserted: 2, TenderID: tenderID,
	}}

	svc := &BoqService{repo: repo, cache: c, recalc: enq}

	res, err := svc.InsertTemplateItems(context.Background(), "tmpl", "pos", "user")
	if err != nil || res == nil {
		t.Fatalf("unexpected failure: res=%v err=%v", res, err)
	}
	if _, ok := c.Get(overviewKey); ok {
		t.Fatal("cache.Delete SHOULD be called on success")
	}
	if len(enq.enqueued) != 1 || enq.enqueued[0] != tenderID {
		t.Fatalf("enqueueRecalc should run once for %s, got %v", tenderID, enq.enqueued)
	}
}
