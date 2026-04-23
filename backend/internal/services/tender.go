package services

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/cache"
	"github.com/su10/hubtender/backend/internal/repository"
)

const (
	tenderOverviewCacheTTL = 60 * time.Second
	tenderListCacheTTL     = 30 * time.Second
	tenderListKeyPrefix    = "tenders:list:"
)

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
	repo  tenderRepoer
	cache *cache.InMem
	// inflight serialises concurrent loads for the same tender ID.
	// Key: tender ID string, Value: *sync.Mutex.
	inflight sync.Map
}

// NewTenderService creates a TenderService.
func NewTenderService(repo *repository.TenderRepo, c *cache.InMem) *TenderService {
	return &TenderService{repo: repo, cache: c}
}

// ListTenders returns a paginated list of tenders, cached per-user-per-filters
// for 30s. Invalidated on any tender create/update and by other services that
// mutate tender-level aggregates (see DeleteByPrefix calls on tenderListKeyPrefix).
func (s *TenderService) ListTenders(
	ctx context.Context,
	userID string,
	p repository.TenderListParams,
) ([]repository.TenderRow, error) {
	key := tenderListCacheKey(userID, p)

	if v, ok := s.cache.Get(key); ok {
		if rows, ok := v.([]repository.TenderRow); ok {
			return rows, nil
		}
	}

	rows, err := s.repo.ListTenders(ctx, p)
	if err != nil {
		return nil, fmt.Errorf("tenderService.ListTenders: %w", err)
	}

	s.cache.Set(key, rows, tenderListCacheTTL)
	return rows, nil
}

// tenderListCacheKey builds a stable cache key from userID and list params.
// Different users get different entries (RLS may filter different rows);
// each (archived/housing_class/search/cursor/limit) tuple gets its own slot.
func tenderListCacheKey(userID string, p repository.TenderListParams) string {
	var b strings.Builder
	b.Grow(96)
	b.WriteString(tenderListKeyPrefix)
	b.WriteString(userID)
	b.WriteString("|arch=")
	if p.IsArchived != nil {
		b.WriteString(strconv.FormatBool(*p.IsArchived))
	}
	b.WriteString("|hc=")
	b.WriteString(p.HousingClass)
	b.WriteString("|q=")
	b.WriteString(p.Search)
	b.WriteString("|cu=")
	if p.CursorUpdatedAt != nil {
		b.WriteString(strconv.FormatInt(p.CursorUpdatedAt.UnixNano(), 10))
	}
	b.WriteString("|ci=")
	if p.CursorID != nil {
		b.WriteString(*p.CursorID)
	}
	b.WriteString("|lim=")
	b.WriteString(strconv.Itoa(p.Limit))
	return b.String()
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

// CreateTender inserts a new tender and invalidates affected caches.
func (s *TenderService) CreateTender(
	ctx context.Context,
	in repository.CreateTenderInput,
) (*repository.TenderRow, error) {
	t, err := s.repo.CreateTender(ctx, in)
	if err != nil {
		return nil, fmt.Errorf("tenderService.CreateTender: %w", err)
	}
	s.cache.Delete("tender:overview:" + t.ID)
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return t, nil
}

// UpdateTender patches a tender and invalidates affected caches.
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
	s.cache.DeleteByPrefix(tenderListKeyPrefix)
	return t, nil
}
