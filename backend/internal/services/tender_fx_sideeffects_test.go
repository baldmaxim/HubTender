package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0-F1 §H.10: cache invalidation and the (idempotent, optional) recalc
// enqueue happen ONLY after the repo transaction committed; a fail-closed rate
// change (repo error) leaves the cache untouched and enqueues nothing.

type fakeTenderRepo struct {
	updateErr error
	adminErr  error
	updated   bool
}

func (f *fakeTenderRepo) ListTenders(context.Context, repository.TenderListParams) ([]repository.TenderRow, error) {
	panic("not used")
}
func (f *fakeTenderRepo) ListTendersBrief(context.Context, repository.TenderBriefParams) ([]repository.TenderBriefRow, error) {
	panic("not used")
}
func (f *fakeTenderRepo) GetTenderOverview(context.Context, string) (*repository.TenderOverviewRow, error) {
	panic("not used")
}
func (f *fakeTenderRepo) GetTenderByID(context.Context, string) (*repository.TenderRow, error) {
	panic("not used")
}
func (f *fakeTenderRepo) CreateTender(context.Context, repository.CreateTenderInput) (*repository.TenderRow, error) {
	panic("not used")
}
func (f *fakeTenderRepo) UpdateTender(_ context.Context, id string, _ repository.UpdateTenderInput) (*repository.TenderRow, error) {
	if f.updateErr != nil {
		return nil, f.updateErr
	}
	f.updated = true
	return &repository.TenderRow{ID: id}, nil
}
func (f *fakeTenderRepo) AdminPatchTender(context.Context, string, repository.AdminTenderPatch) error {
	if f.adminErr != nil {
		return f.adminErr
	}
	f.updated = true
	return nil
}
func (f *fakeTenderRepo) DeleteTender(context.Context, string) error { panic("not used") }
func (f *fakeTenderRepo) GetUserRoleCode(context.Context, string) (string, error) {
	panic("not used")
}
func (f *fakeTenderRepo) ApproveFinancial(context.Context, string, string) error {
	panic("not used")
}

type fakeEnqueuer struct{ enqueued []string }

func (f *fakeEnqueuer) Enqueue(tenderID string) { f.enqueued = append(f.enqueued, tenderID) }

func seedTenderCaches(c *cache.InMem, tenderID string) {
	c.Set("tender:overview:"+tenderID, "ov", time.Minute)
	c.Set("positions:with_costs:"+tenderID, "pos", time.Minute)
	c.Set(tenderListKeyPrefix+"u1|arch=", "list", time.Minute)
}

func f64(v float64) *float64 { return &v }

func TestUpdateTender_RateChangeInvalidatesCachesAfterCommit(t *testing.T) {
	c := cache.New()
	q := &fakeEnqueuer{}
	repo := &fakeTenderRepo{}
	svc := &TenderService{repo: repo, cache: c, recalc: q}
	seedTenderCaches(c, "t1")

	if _, err := svc.UpdateTender(context.Background(), "t1",
		repository.UpdateTenderInput{USDRate: f64(100)}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, ok := c.Get("tender:overview:t1"); ok {
		t.Fatal("overview cache must be invalidated")
	}
	if _, ok := c.Get("positions:with_costs:t1"); ok {
		t.Fatal("positions cache must be invalidated on a rate change")
	}
	if len(q.enqueued) != 1 || q.enqueued[0] != "t1" {
		t.Fatalf("idempotent extra recalc pass expected, got %v", q.enqueued)
	}
}

func TestUpdateTender_NonRatePatchKeepsPositionsCache(t *testing.T) {
	c := cache.New()
	q := &fakeEnqueuer{}
	svc := &TenderService{repo: &fakeTenderRepo{}, cache: c, recalc: q}
	seedTenderCaches(c, "t1")

	title := "новый заголовок"
	if _, err := svc.UpdateTender(context.Background(), "t1",
		repository.UpdateTenderInput{Title: &title}); err != nil {
		t.Fatalf("update: %v", err)
	}
	if _, ok := c.Get("positions:with_costs:t1"); !ok {
		t.Fatal("non-rate patch must not evict the positions cache")
	}
	if len(q.enqueued) != 0 {
		t.Fatalf("non-rate patch must not enqueue a recalc, got %v", q.enqueued)
	}
}

func TestUpdateTender_FailClosedNoCacheEvictionNoEnqueue(t *testing.T) {
	c := cache.New()
	q := &fakeEnqueuer{}
	repo := &fakeTenderRepo{updateErr: errors.New("MISSING_FX_RATE: USD")}
	svc := &TenderService{repo: repo, cache: c, recalc: q}
	seedTenderCaches(c, "t1")

	if _, err := svc.UpdateTender(context.Background(), "t1",
		repository.UpdateTenderInput{USDRate: f64(0)}); err == nil {
		t.Fatal("repo error must propagate")
	}
	if _, ok := c.Get("tender:overview:t1"); !ok {
		t.Fatal("failed rate change must NOT invalidate the overview cache")
	}
	if _, ok := c.Get("positions:with_costs:t1"); !ok {
		t.Fatal("failed rate change must NOT invalidate the positions cache")
	}
	if len(q.enqueued) != 0 {
		t.Fatalf("failed rate change must not enqueue, got %v", q.enqueued)
	}
	if repo.updated {
		t.Fatal("sanity: repo must not have applied the update")
	}
}

func TestAdminPatchTender_SameRateSemantics(t *testing.T) {
	c := cache.New()
	q := &fakeEnqueuer{}
	svc := &TenderService{repo: &fakeTenderRepo{}, cache: c, recalc: q}
	seedTenderCaches(c, "t1")

	if err := svc.AdminPatchTender(context.Background(), "t1",
		repository.AdminTenderPatch{EURRate: f64(105)}); err != nil {
		t.Fatalf("admin patch: %v", err)
	}
	if _, ok := c.Get("positions:with_costs:t1"); ok {
		t.Fatal("admin rate change must invalidate the positions cache")
	}
	if len(q.enqueued) != 1 {
		t.Fatalf("admin rate change must enqueue the idempotent pass, got %v", q.enqueued)
	}

	// Fail-closed admin path: nothing invalidated, nothing enqueued.
	c2 := cache.New()
	q2 := &fakeEnqueuer{}
	svc2 := &TenderService{repo: &fakeTenderRepo{adminErr: errors.New("boom")}, cache: c2, recalc: q2}
	seedTenderCaches(c2, "t2")
	if err := svc2.AdminPatchTender(context.Background(), "t2",
		repository.AdminTenderPatch{USDRate: f64(1)}); err == nil {
		t.Fatal("admin repo error must propagate")
	}
	if _, ok := c2.Get("tender:overview:t2"); !ok {
		t.Fatal("failed admin rate change must NOT invalidate caches")
	}
	if len(q2.enqueued) != 0 {
		t.Fatalf("failed admin rate change must not enqueue, got %v", q2.enqueued)
	}
}
