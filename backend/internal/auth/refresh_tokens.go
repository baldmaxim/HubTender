package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// NewFamilyID generates a fresh UUIDv4 used as token_family_id for a brand
// new login. Done in Go (not SELECT gen_random_uuid()) so the service can
// thread the value into both the refresh-token INSERT and the auth_event
// metadata without an extra DB round-trip.
func NewFamilyID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("auth: family id: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%s-%s-%s-%s-%s",
		hex.EncodeToString(b[0:4]),
		hex.EncodeToString(b[4:6]),
		hex.EncodeToString(b[6:8]),
		hex.EncodeToString(b[8:10]),
		hex.EncodeToString(b[10:16]),
	), nil
}

// HashRefreshToken returns the lowercase hex SHA-256 of the plaintext refresh
// token. This is what gets persisted to app_auth.refresh_tokens.token_hash.
//
// Why SHA-256 (and not bcrypt/argon2)? Refresh tokens are 256 bits of
// CSPRNG entropy issued by the server — there's no precomputation /
// dictionary attack to defend against, only an unauthenticated DB-leak
// scenario. SHA-256 is fast, deterministic (we need O(1) lookup by hash
// on every /refresh call), and the unique-index constraint on token_hash
// gives us "token already exists" detection for free.
//
// Plaintext tokens never enter the database; nothing else in the codebase
// stores or logs them. See app_auth.refresh_tokens.token_hash COMMENT in
// db/yandex/incremental/2026_05_app_auth_runtime.sql.
func HashRefreshToken(plain string) string {
	sum := sha256.Sum256([]byte(plain))
	return hex.EncodeToString(sum[:])
}
