package services

import (
	"testing"
	"time"

	"github.com/su10/hubtender/backend/internal/repository"
)

func TestTenderListCacheKeyStability(t *testing.T) {
	p := repository.TenderListParams{
		HousingClass: "comfort",
		Search:       "foo",
		Limit:        50,
	}
	k1 := tenderListCacheKey("user-1", p)
	k2 := tenderListCacheKey("user-1", p)
	if k1 != k2 {
		t.Fatalf("identical inputs must produce the same key\n  k1=%q\n  k2=%q", k1, k2)
	}
	if k1[:len(tenderListKeyPrefix)] != tenderListKeyPrefix {
		t.Fatalf("key must start with prefix %q: got %q", tenderListKeyPrefix, k1)
	}
}

func TestTenderListCacheKeyVariesByUser(t *testing.T) {
	p := repository.TenderListParams{Limit: 50}
	if tenderListCacheKey("user-a", p) == tenderListCacheKey("user-b", p) {
		t.Fatal("different users must get different keys")
	}
}

func TestTenderListCacheKeyVariesByParams(t *testing.T) {
	archT := true
	archF := false
	ts := time.Unix(1_700_000_000, 0)
	id := "tender-xyz"

	cases := []repository.TenderListParams{
		{Limit: 50},
		{Limit: 100},
		{Limit: 50, HousingClass: "comfort"},
		{Limit: 50, Search: "q"},
		{Limit: 50, IsArchived: &archT},
		{Limit: 50, IsArchived: &archF},
		{Limit: 50, CursorUpdatedAt: &ts, CursorID: &id},
	}
	seen := make(map[string]struct{}, len(cases))
	for i, p := range cases {
		k := tenderListCacheKey("u", p)
		if _, dup := seen[k]; dup {
			t.Fatalf("case %d produced duplicate key %q", i, k)
		}
		seen[k] = struct{}{}
	}
}
