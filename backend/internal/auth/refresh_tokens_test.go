package auth

import (
	"regexp"
	"testing"
)

func TestHashRefreshToken_Deterministic(t *testing.T) {
	a := HashRefreshToken("opaque-refresh-token-abc")
	b := HashRefreshToken("opaque-refresh-token-abc")
	if a != b {
		t.Fatalf("expected deterministic hash, got %q vs %q", a, b)
	}
}

func TestHashRefreshToken_DifferentInputsDiverge(t *testing.T) {
	if HashRefreshToken("a") == HashRefreshToken("b") {
		t.Fatalf("expected different hashes for different inputs")
	}
}

func TestHashRefreshToken_Hex64(t *testing.T) {
	h := HashRefreshToken("anything")
	if len(h) != 64 {
		t.Fatalf("expected 64-char hex SHA-256, got %d", len(h))
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(h) {
		t.Fatalf("expected lowercase hex, got %q", h)
	}
}

func TestNewFamilyID_UUIDv4(t *testing.T) {
	id, err := NewFamilyID()
	if err != nil {
		t.Fatalf("NewFamilyID: %v", err)
	}
	// canonical UUIDv4: 8-4-4-4-12 lowercase hex; version=4, variant=10.
	rx := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	if !rx.MatchString(id) {
		t.Fatalf("not a UUIDv4: %q", id)
	}
}

func TestNewFamilyID_Unique(t *testing.T) {
	seen := make(map[string]struct{}, 64)
	for range 64 {
		id, err := NewFamilyID()
		if err != nil {
			t.Fatalf("NewFamilyID: %v", err)
		}
		if _, dup := seen[id]; dup {
			t.Fatalf("collision: %q", id)
		}
		seen[id] = struct{}{}
	}
}
