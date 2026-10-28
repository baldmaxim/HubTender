package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeAutopriceBulkRepo struct {
	res *repository.AutopriceBulkResult
	err error
}

func (f *fakeAutopriceBulkRepo) BulkWrite(context.Context, string, string, []repository.AutopriceBulkPosition) (*repository.AutopriceBulkResult, error) {
	return f.res, f.err
}

// После успеха кэш тендера сбрасывается, пересчёт ставится один раз; при ошибке
// побочных эффектов нет.
func TestAutopriceBulkService_SideEffects(t *testing.T) {
	const tenderID = "tender-1"
	overviewKey := "tender:overview:" + tenderID
	newCache := func() *cache.InMem {
		c := cache.New()
		c.Set(overviewKey, "cached", time.Minute)
		c.Set(tenderListKeyPrefix+"all", "cached", time.Minute)
		return c
	}

	c, enq := newCache(), &countingEnqueuer{}
	svc := NewAutopriceBulkService(&fakeAutopriceBulkRepo{res: &repository.AutopriceBulkResult{TenderID: tenderID}}, c).WithRecalcQueue(enq)
	if _, err := svc.BulkWrite(context.Background(), "s", "u", nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Get(overviewKey); ok {
		t.Fatal("кэш обзора тендера должен быть сброшен")
	}
	if _, ok := c.Get(tenderListKeyPrefix + "all"); ok {
		t.Fatal("кэш списка тендеров должен быть сброшен")
	}
	if len(enq.enqueued) != 1 || enq.enqueued[0] != tenderID {
		t.Fatalf("пересчёт: %v", enq.enqueued)
	}

	boom := errors.New("boom")
	c, enq = newCache(), &countingEnqueuer{}
	svc = NewAutopriceBulkService(&fakeAutopriceBulkRepo{err: boom}, c).WithRecalcQueue(enq)
	res, err := svc.BulkWrite(context.Background(), "s", "u", nil)
	if res != nil || !errors.Is(err, boom) {
		t.Fatalf("res=%v err=%v", res, err)
	}
	if _, ok := c.Get(overviewKey); !ok || len(enq.enqueued) != 0 {
		t.Fatal("при ошибке кэш и очередь трогать нельзя")
	}
}
