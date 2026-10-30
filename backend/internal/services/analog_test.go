package services

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

type fakeAnalogRepo struct {
	target *repository.AnalogTarget
	apply  *repository.AnalogApplyResult
	revert *repository.AnalogRevertResult
	err    error
}

func (f *fakeAnalogRepo) GetTarget(context.Context, string) (*repository.AnalogTarget, error) {
	return f.target, f.err
}
func (f *fakeAnalogRepo) LoadSourceRows(context.Context, string) ([]repository.AnalogRow, error) {
	return nil, f.err
}
func (f *fakeAnalogRepo) Preview(context.Context, repository.AnalogExecuteInput) (*repository.AnalogPreview, error) {
	return &repository.AnalogPreview{}, f.err
}
func (f *fakeAnalogRepo) Apply(context.Context, repository.AnalogExecuteInput) (*repository.AnalogApplyResult, error) {
	return f.apply, f.err
}
func (f *fakeAnalogRepo) ListApplications(context.Context, string) ([]repository.AnalogApplication, error) {
	return nil, f.err
}
func (f *fakeAnalogRepo) Revert(context.Context, string, string) (*repository.AnalogRevertResult, error) {
	return f.revert, f.err
}
func (f *fakeAnalogRepo) NextUnpriced(context.Context, string) (*repository.AnalogNext, error) {
	return nil, f.err
}

type fakeAnalogArchive struct {
	req  ArchiveSearchRequest
	hits []ArchiveSearchHit
}

func (f *fakeAnalogArchive) Search(_ context.Context, req ArchiveSearchRequest) ([]ArchiveSearchHit, error) {
	f.req = req
	return f.hits, nil
}
func (f *fakeAnalogArchive) GetPosition(context.Context, string) (*repository.ArchivePositionDetail, error) {
	return nil, repository.ErrArchivePositionNotFound
}

func analogHits(ids ...string) []ArchiveSearchHit {
	out := make([]ArchiveSearchHit, len(ids))
	for i, id := range ids {
		out[i] = ArchiveSearchHit{
			ArchivePositionRow: repository.ArchivePositionRow{PositionID: id, TenderID: "t-" + id, WorkName: "Бетон " + id, ItemsCount: 2},
			Score:              0.9 - float64(i)/10, UnitCompatibility: "exact",
		}
	}
	return out
}

func TestAnalogService_Search_LimitUnitAndExclusion(t *testing.T) {
	unit := "м3"
	vol := 12.5
	repo := &fakeAnalogRepo{target: &repository.AnalogTarget{
		PositionID: "target", TenderID: "t-target", WorkName: "Устройство плиты", UnitCode: &unit, Volume: &vol,
	}}
	arch := &fakeAnalogArchive{hits: analogHits("a", "target", "b", "c", "d")}
	svc := NewAnalogService(repo, arch, cache.New())

	resp, err := svc.Search(context.Background(), "target", "", 0)
	if err != nil {
		t.Fatal(err)
	}
	// Единица цели — только в скоринг; SQL-фильтра по ней нет.
	if arch.req.Filter.UnitCode != "" || arch.req.Query.UnitCode != "м3" || arch.req.Query.Volume == nil {
		t.Fatalf("единица должна идти в скоринг, не в фильтр: %+v", arch.req)
	}
	if arch.req.Filter.ExcludeTenderID != "t-target" || !arch.req.Filter.OnlyLatestVersion || !arch.req.Filter.WithBoqOnly {
		t.Fatalf("фильтр: %+v", arch.req.Filter)
	}
	if arch.req.Limit != DefaultAnalogLimit+1 {
		t.Fatalf("limit запроса = %d, want %d (limit+1)", arch.req.Limit, DefaultAnalogLimit+1)
	}
	if arch.req.Query.WorkName != "Устройство плиты" || resp.Query != "Устройство плиты" {
		t.Fatalf("пустой q → полное название цели: %q / %q", arch.req.Query.WorkName, resp.Query)
	}
	// целевая позиция исключена; после неё осталось 4 > 3 → has_more
	if len(resp.Hits) != 3 || !resp.HasMore || resp.Hits[0].PositionID != "a" || resp.Hits[1].PositionID != "b" {
		t.Fatalf("hits=%+v has_more=%v", resp.Hits, resp.HasMore)
	}

	arch.hits = analogHits("a", "b")
	resp, _ = svc.Search(context.Background(), "target", "  плита  ", 30)
	if resp.HasMore || len(resp.Hits) != 2 || arch.req.Query.WorkName != "плита" || arch.req.Limit != 31 {
		t.Fatalf("без has_more: %+v limit=%d q=%q", resp, arch.req.Limit, arch.req.Query.WorkName)
	}
	_, _ = svc.Search(context.Background(), "target", "x", 1000)
	if arch.req.Limit != MaxAnalogLimit+1 {
		t.Fatalf("потолок limit: %d", arch.req.Limit)
	}
}

func TestAnalogService_SideEffects(t *testing.T) {
	const tenderID = "tender-1"
	key := "tender:overview:" + tenderID
	newCache := func() *cache.InMem {
		c := cache.New()
		c.Set(key, "cached", time.Minute)
		c.Set(tenderListKeyPrefix+"all", "cached", time.Minute)
		return c
	}

	// Реальное применение: кэш сброшен, пересчёт поставлен один раз.
	c, enq := newCache(), &countingEnqueuer{}
	svc := NewAnalogService(&fakeAnalogRepo{apply: &repository.AnalogApplyResult{TenderID: tenderID}}, &fakeAnalogArchive{}, c).WithRecalcQueue(enq)
	if _, err := svc.Apply(context.Background(), repository.AnalogExecuteInput{}); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Get(key); ok || len(enq.enqueued) != 1 || enq.enqueued[0] != tenderID {
		t.Fatalf("apply: кэш должен быть сброшен, пересчёт один: %v", enq.enqueued)
	}

	// Повтор по ключу: ничего не менялось — побочных эффектов нет.
	c, enq = newCache(), &countingEnqueuer{}
	svc = NewAnalogService(&fakeAnalogRepo{apply: &repository.AnalogApplyResult{TenderID: tenderID, Replayed: true}}, &fakeAnalogArchive{}, c).WithRecalcQueue(enq)
	_, _ = svc.Apply(context.Background(), repository.AnalogExecuteInput{})
	if _, ok := c.Get(key); !ok || len(enq.enqueued) != 0 {
		t.Fatal("replay не должен сбрасывать кэш и ставить пересчёт")
	}

	// Ошибка: побочных эффектов нет.
	c, enq = newCache(), &countingEnqueuer{}
	boom := errors.New("boom")
	svc = NewAnalogService(&fakeAnalogRepo{err: boom}, &fakeAnalogArchive{}, c).WithRecalcQueue(enq)
	if _, err := svc.Apply(context.Background(), repository.AnalogExecuteInput{}); !errors.Is(err, boom) {
		t.Fatalf("err = %v", err)
	}
	if _, ok := c.Get(key); !ok || len(enq.enqueued) != 0 {
		t.Fatal("при ошибке побочных эффектов быть не должно")
	}

	// Отмена: пересчёт только если строки действительно удалены.
	c, enq = newCache(), &countingEnqueuer{}
	app := repository.AnalogApplication{TenderID: tenderID}
	svc = NewAnalogService(&fakeAnalogRepo{revert: &repository.AnalogRevertResult{Application: app, Changed: false}}, &fakeAnalogArchive{}, c).WithRecalcQueue(enq)
	_, _ = svc.Revert(context.Background(), "a", "u")
	if len(enq.enqueued) != 0 {
		t.Fatal("повтор отмены не должен ставить пересчёт")
	}
	svc = NewAnalogService(&fakeAnalogRepo{revert: &repository.AnalogRevertResult{Application: app, Changed: true}}, &fakeAnalogArchive{}, c).WithRecalcQueue(enq)
	_, _ = svc.Revert(context.Background(), "a", "u")
	if len(enq.enqueued) != 1 {
		t.Fatal("отмена со сменой данных должна ставить пересчёт")
	}
}

func TestAnalogService_GetSource_NotFound(t *testing.T) {
	svc := NewAnalogService(&fakeAnalogRepo{}, &fakeAnalogArchive{}, cache.New())
	_, err := svc.GetSource(context.Background(), "x")
	var ae *repository.AnalogError
	if !errors.As(err, &ae) || ae.Code != repository.AnalogCodeSourceNotFound {
		t.Fatalf("err = %v", err)
	}
}
