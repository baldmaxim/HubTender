package cache

import (
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// entry holds a cached value and its expiry timestamp.
type entry struct {
	val any
	exp time.Time
}

// InMem is a simple in-process cache backed by sync.RWMutex.
// It is goroutine-safe and uses TTL-based expiry checked lazily on Get.
//
// Phase 3 will replace this with Redis / ristretto — the service layer
// depends only on Get/Set/Delete so the swap is a one-line injection.
type InMem struct {
	mu     sync.RWMutex
	items  map[string]entry
	hits   atomic.Int64
	misses atomic.Int64
}

// New creates an empty InMem cache.
func New() *InMem {
	return &InMem{
		items: make(map[string]entry),
	}
}

// Get returns the cached value for key. The second return value is false if
// the key is absent or the entry has expired (expired entries are deleted
// lazily).
func (c *InMem) Get(key string) (any, bool) {
	c.mu.RLock()
	e, ok := c.items[key]
	c.mu.RUnlock()

	if !ok {
		c.misses.Add(1)
		return nil, false
	}

	if time.Now().After(e.exp) {
		// Expired — delete lazily under write lock.
		c.Delete(key)
		c.misses.Add(1)
		return nil, false
	}

	c.hits.Add(1)
	return e.val, true
}

// Set stores val under key with a TTL. Overwrites any existing entry.
func (c *InMem) Set(key string, val any, ttl time.Duration) {
	c.mu.Lock()
	c.items[key] = entry{
		val: val,
		exp: time.Now().Add(ttl),
	}
	c.mu.Unlock()
}

// Delete removes an entry from the cache. No-op if the key does not exist.
func (c *InMem) Delete(key string) {
	c.mu.Lock()
	delete(c.items, key)
	c.mu.Unlock()
}

// DeleteByPrefix removes every entry whose key starts with the given prefix.
// Returns the number of entries removed.
func (c *InMem) DeleteByPrefix(prefix string) int {
	if prefix == "" {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for k := range c.items {
		if strings.HasPrefix(k, prefix) {
			delete(c.items, k)
			n++
		}
	}
	return n
}

// Flush removes all entries. Useful in tests.
func (c *InMem) Flush() {
	c.mu.Lock()
	c.items = make(map[string]entry)
	c.mu.Unlock()
	c.hits.Store(0)
	c.misses.Store(0)
}

// Stats is a snapshot of cache counters and size.
type Stats struct {
	Hits    int64 `json:"hits"`
	Misses  int64 `json:"misses"`
	Entries int   `json:"entries"`
}

// Stats returns a snapshot of hit/miss counters and current entry count.
// Expired entries are included in Entries until the next Get sweeps them.
func (c *InMem) Stats() Stats {
	c.mu.RLock()
	n := len(c.items)
	c.mu.RUnlock()
	return Stats{
		Hits:    c.hits.Load(),
		Misses:  c.misses.Load(),
		Entries: n,
	}
}
