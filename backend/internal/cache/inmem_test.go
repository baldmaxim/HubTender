package cache

import (
	"testing"
	"time"
)

func TestInMemGetSetDelete(t *testing.T) {
	c := New()
	c.Set("k", 42, time.Minute)

	v, ok := c.Get("k")
	if !ok || v.(int) != 42 {
		t.Fatalf("expected hit with 42, got %v ok=%v", v, ok)
	}

	c.Delete("k")
	if _, ok := c.Get("k"); ok {
		t.Fatalf("expected miss after delete")
	}
}

func TestInMemExpiry(t *testing.T) {
	c := New()
	c.Set("k", "v", time.Nanosecond)
	time.Sleep(5 * time.Millisecond)

	if _, ok := c.Get("k"); ok {
		t.Fatalf("expected expired entry to be miss")
	}
}

func TestInMemDeleteByPrefix(t *testing.T) {
	c := New()
	c.Set("tenders:list:user-a:q1", 1, time.Minute)
	c.Set("tenders:list:user-a:q2", 2, time.Minute)
	c.Set("tenders:list:user-b:q1", 3, time.Minute)
	c.Set("tender:overview:t1", 99, time.Minute)

	removed := c.DeleteByPrefix("tenders:list:")
	if removed != 3 {
		t.Fatalf("expected 3 removed, got %d", removed)
	}

	if _, ok := c.Get("tender:overview:t1"); !ok {
		t.Fatalf("unrelated entry must survive prefix delete")
	}
	if _, ok := c.Get("tenders:list:user-a:q1"); ok {
		t.Fatalf("prefix entry must be gone")
	}

	// Empty prefix is a no-op, not a full wipe.
	if n := c.DeleteByPrefix(""); n != 0 {
		t.Fatalf("empty prefix should be no-op, got %d", n)
	}
	if _, ok := c.Get("tender:overview:t1"); !ok {
		t.Fatalf("empty prefix must not wipe the cache")
	}
}

func TestInMemStats(t *testing.T) {
	c := New()
	// Miss path.
	if _, ok := c.Get("absent"); ok {
		t.Fatal("expected miss")
	}
	c.Set("k", "v", time.Minute)
	// Hit path.
	if _, ok := c.Get("k"); !ok {
		t.Fatal("expected hit")
	}
	if _, ok := c.Get("k"); !ok {
		t.Fatal("expected hit")
	}

	s := c.Stats()
	if s.Hits != 2 {
		t.Errorf("hits: want 2 got %d", s.Hits)
	}
	if s.Misses != 1 {
		t.Errorf("misses: want 1 got %d", s.Misses)
	}
	if s.Entries != 1 {
		t.Errorf("entries: want 1 got %d", s.Entries)
	}

	c.Flush()
	s = c.Stats()
	if s.Hits != 0 || s.Misses != 0 || s.Entries != 0 {
		t.Errorf("flush did not reset stats: %+v", s)
	}
}
