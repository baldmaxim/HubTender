package services

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

type fakeRecalc struct{ err error }

func (f fakeRecalc) RecalcTender(context.Context, string) error { return f.err }

type recordingEnqueuer struct {
	mu  sync.Mutex
	ids []string
	hit chan struct{}
}

func (r *recordingEnqueuer) Enqueue(id string) {
	r.mu.Lock()
	r.ids = append(r.ids, id)
	r.mu.Unlock()
	r.hit <- struct{}{}
}

// Прогон проверки встаёт в очередь только после успешного пересчёта.
func TestRecalcQueue_AfterSuccessChain(t *testing.T) {
	for _, tc := range []struct {
		name  string
		err   error
		chain bool
	}{
		{"успех — цепочка", nil, true},
		{"ошибка — без цепочки", errors.New("boom"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := NewRecalcQueue(context.Background(), fakeRecalc{err: tc.err}, time.Millisecond, 1, zerolog.Nop())
			next := &recordingEnqueuer{hit: make(chan struct{}, 1)}
			q.SetAfterSuccess(next)
			q.Enqueue("t1")

			select {
			case <-next.hit:
				if !tc.chain {
					t.Fatal("после ошибки пересчёта прогон проверки поставлен")
				}
			case <-time.After(300 * time.Millisecond):
				if tc.chain {
					t.Fatal("после успешного пересчёта прогон проверки не поставлен")
				}
			}
			q.Close()
		})
	}
}
