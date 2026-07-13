package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0.1.2.2b (§14 C): on ANY repository/domain error the rollback service
// must have NO side effects — cache stays intact, no success reaches the
// caller; the domain error stays reachable via errors.As. On success the cache
// is invalidated only AFTER the repository committed.

type fakeAuditRollbackRepo struct {
	res  *repository.BoqAuditRollbackResult
	err  error
	call int
}

func (f *fakeAuditRollbackRepo) Rollback(context.Context, string, string) (*repository.BoqAuditRollbackResult, error) {
	f.call++
	if f.err != nil {
		return nil, f.err
	}
	return f.res, nil
}

func (f *fakeAuditRollbackRepo) ListByPosition(context.Context, repository.BoqAuditListFilter) ([]repository.BoqAuditRow, error) {
	panic("not used")
}

func newRollbackSvc(repo boqAuditRollbackRepoer, c *cache.InMem) *BoqAuditRollbackService {
	return &BoqAuditRollbackService{repo: repo, cache: c}
}

func TestAuditRollback_ErrorHasNoSideEffects(t *testing.T) {
	domainErrs := []error{
		&repository.InvalidBoqAuditSnapshotError{AuditID: "a1", ItemID: "i1", Field: "quantity", Reason: repository.InvalidFieldType},
		&repository.BoqAuditTargetMismatchError{AuditID: "a1", ExpectedItemID: "i1", ActualItemID: "i2"},
		&repository.UnsupportedBoqAuditRollbackError{AuditID: "a1", Operation: "INSERT"},
		&calc.MissingFXRateError{Currency: "USD"},
		&repository.InvalidBoqParentError{ItemID: "i1", ParentItemID: "p1", Reason: repository.BoqParentNotFound},
	}
	for _, dErr := range domainErrs {
		t.Run(dErr.Error(), func(t *testing.T) {
			c := cache.New()
			c.Set(tenderListKeyPrefix+"all", "cached-list", time.Minute)

			repo := &fakeAuditRollbackRepo{err: dErr}
			svc := newRollbackSvc(repo, c)

			res, err := svc.Rollback(context.Background(), "a1", "user")
			if res != nil {
				t.Fatalf("result must be nil on error, got %+v", res)
			}
			if err == nil {
				t.Fatal("error must propagate")
			}
			// §16: cache must NOT be invalidated on error.
			if _, ok := c.Get(tenderListKeyPrefix + "all"); !ok {
				t.Fatal("cache.DeleteByPrefix must NOT be called on error")
			}
			// The concrete domain error survives the service's %w wrapping.
			if !errors.Is(err, dErr) {
				t.Fatalf("wrapped error must contain the domain error, got %v", err)
			}
		})
	}
}

func TestAuditRollback_SuccessInvalidatesCacheAfterRepo(t *testing.T) {
	c := cache.New()
	c.Set(tenderListKeyPrefix+"all", "cached-list", time.Minute)

	repo := &fakeAuditRollbackRepo{res: &repository.BoqAuditRollbackResult{
		ItemID: "i1", TenderID: "t1", Operation: "UPDATE",
	}}
	svc := newRollbackSvc(repo, c)

	res, err := svc.Rollback(context.Background(), "a1", "user")
	if err != nil || res == nil {
		t.Fatalf("unexpected failure: res=%v err=%v", res, err)
	}
	if repo.call != 1 {
		t.Fatalf("repo called %d times, want 1", repo.call)
	}
	if _, ok := c.Get(tenderListKeyPrefix + "all"); ok {
		t.Fatal("cache SHOULD be invalidated on success")
	}
	if res.TenderID != "t1" || res.Operation != "UPDATE" {
		t.Fatalf("result passthrough broken: %+v", res)
	}
}
