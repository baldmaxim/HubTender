package cache

import (
	"sync"
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
	mu    sync.RWMutex
	items map[string]entry
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
		return nil, false
	}

	if time.Now().After(e.exp) {
		// Expired — delete lazily under write lock.
		c.Delete(key)
		return nil, false
	}

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

// Flush removes all entries. Useful in tests.
func (c *InMem) Flush() {
	c.mu.Lock()
	c.items = make(map[string]entry)
	c.mu.Unlock()
}
