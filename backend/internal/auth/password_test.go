package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestHashPassword_RoundTrip(t *testing.T) {
	hash, err := HashPassword("hunter2")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if err := ComparePassword(hash, "hunter2"); err != nil {
		t.Fatalf("round-trip: %v", err)
	}
	if err := ComparePassword(hash, "hunter3"); !errors.Is(err, ErrPasswordMismatch) {
		t.Fatalf("expected mismatch on different password, got %v", err)
	}
}

// TestHashPassword_ProducesSupabaseCompatiblePrefix locks in the assumption
// that powers the migration: hashes our issuer creates must be readable by
// the same bcrypt library that reads Supabase's $2a$10$ hashes (and vice
// versa). MCP check on 2026-05-06 confirmed all 32 prod users use exactly
// this prefix at cost 10.
func TestHashPassword_ProducesSupabaseCompatiblePrefix(t *testing.T) {
	hash, err := HashPassword("any-password")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$2a$10$") {
		t.Fatalf("expected $2a$10$ prefix (Supabase-compat), got %q", hash[:7])
	}
	if len(hash) != 60 {
		t.Fatalf("expected 60-char bcrypt hash, got %d", len(hash))
	}
}

func TestHashPassword_RejectsEmpty(t *testing.T) {
	if _, err := HashPassword(""); err == nil {
		t.Fatal("expected error for empty password")
	}
}
