package services

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

const tenderOverviewCacheTTL = 60 * time.Second

// tenderRepoer is the interface TenderService depends on.
type tenderRepoer interface {
	ListTenders(ctx context.Context, p repository.TenderListParams) ([]repository.TenderRow, error)
	GetTenderOverview(ctx context.Context, tenderID string) (*repository.TenderOverviewRow, error)
	GetTenderByID(ctx context.Context, id string) (*repository.TenderRow, error)
	CreateTender(ctx context.Context, in repository.CreateTenderInput) (*repository.TenderRow, error)
	UpdateTender(ctx context.Context, id string, in repository.UpdateTenderInput) (*repository.TenderRow, error)
}

// TenderService provides cached access to tender data.
// The overview endpoint uses per-tender-id mutex via sync.Map to avoid
// thundering-herd: concurrent requests for the same tender ID coalesce
// into a single DB hit.
type TenderService struct {
	repo    tenderRepoer
	cache   *cache.InMem
	// inflight serialises concurrent loads for the same tender ID.
	// Key: tender ID string, Value: *sync.Mutex.
	inflight sync.Map
}

// NewTenderService creates a TenderService.
func NewTenderService(repo *repository.TenderRepo, c *cache.InMem) *TenderService {
	return &TenderService{repo: repo, cache: c}
}

// ListTenders returns a paginated list of tenders. Results are not cached
// at the service layer because filters and cursors vary per request.
func (s *TenderService) ListTenders(
	ctx context.Context,
	p repository.TenderListParams,
) ([]repository.TenderRow, error) {
	rows, err := s.repo.ListTenders(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("tenderService.ListTenders: %w", err)
	}
	return rows, nil
}

// GetTenderOverview returns the aggregate overview for a tender, caching
// the result for 60 s. Concurrent calls for the same ID are serialised
// via a per-ID mutex stored in s.inflight so only one DB query runs.
func (s *TenderService) GetTenderOverview(
	ctx context.Context,
	tenderID string,
) (*repository.TenderOverviewRow, error) {
	cacheKey := "tender:overview:" + tenderID

	// Fast path — cached result.
	if v, ok := s.cache.Get(cacheKey); ok {
		if ov, ok := v.(*repository.TenderOverviewRow); ok {
			return ov, nil
		}
	}

	// Retrieve (or lazily create) a per-tender mutex.
	muVal, _ := s.inflight.LoadOrStore(tenderID, &sync.Mutex{})
	mu := muVal.(*sync.Mutex)
	mu.Lock()
	defer mu.Unlock()

	// Double-check cache after acquiring the lock — another goroutine may
	// have populated it while we were waiting.
	if v, ok := s.cache.Get(cacheKey); ok {
		if ov, ok := v.(*repository.TenderOverviewRow); ok {
			return ov, nil
		}
	}

	ov, err := s.repo.GetTenderOverview(ctx, tenderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("tenderService.GetTenderOverview: %w", err)
	}

	s.cache.Set(cacheKey, ov, tenderOverviewCacheTTL)
	return ov, nil
}

// GetTenderByID fetches a single tender row by ID (no cache — used for ETag checks).
func (s *TenderService) GetTenderByID(ctx context.Context, id string) (*repository.TenderRow, error) {
	t, err := s.repo.GetTenderByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("tenderService.GetTenderByID: %w", err)
	}
	return t, nil
}

// CreateTender inserts a new tender and invalidates any stale overview cache.
func (s *TenderService) CreateTender(
	ctx context.Context,
	in repository.CreateTenderInput,
) (*repository.TenderRow, error) {
	t, err := s.repo.CreateTender(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("tenderService.CreateTender: %w", err)
	}
	s.cache.Delete("tender:overview:" + t.ID)
	return t, nil
}

// UpdateTender patches a tender and invalidates the overview cache.
func (s *TenderService) UpdateTender(
	ctx context.Context,
	id string,
	in repository.UpdateTenderInput,
) (*repository.TenderRow, error) {
	t, err := s.repo.UpdateTender(ctx, id, in)
	if err != nil {
		return nil, fmt.Errorf("tenderService.UpdateTender: %w", err)
	}
	s.cache.Delete("tender:overview:" + id)
	return t, nil
}
