// Package auth implements the local JWT issuer that replaces Supabase Auth
// during phase B1 of the migration. Password hashing stays bcrypt-compatible
// with the legacy Supabase auth.users.encrypted_password format ($2a$10$…),
// so existing hashes can be ported byte-for-byte without forcing a reset.
package auth

import (
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

// HashCost is bcrypt's work factor for newly created passwords. Supabase
// historically uses 10; we keep parity to avoid noticeable re-hash latency
// when a freshly registered account logs in for the first time.
const HashCost = 10

// HashPassword returns a bcrypt $2a$ hash. Empty input is rejected — bcrypt
// would silently hash the empty string, masking caller bugs.
func HashPassword(plain string) (string, error) {
	if plain == "" {
		return "", errors.New("auth: password is empty")
	}
	out, err := bcrypt.GenerateFromPassword([]byte(plain), HashCost)
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(out), nil
}

// ComparePassword verifies a plaintext candidate against a stored hash.
// Returns nil on match, ErrPasswordMismatch on a wrong password, or another
// error if the stored hash is malformed (e.g. truncated, wrong prefix).
//
// Accepts every bcrypt prefix golang.org/x/crypto/bcrypt understands: $2a$,
// $2b$, $2y$. This is what makes the Supabase → local migration seamless.
func ComparePassword(hash, plain string) error {
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)); err != nil {
		if errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			return ErrPasswordMismatch
		}
		return fmt.Errorf("auth: compare password: %w", err)
	}
	return nil
}

// ErrPasswordMismatch is returned by ComparePassword when the stored hash
// does not match the provided plaintext. Callers should map this to a
// generic "invalid credentials" 401 — never expose the specific cause to
// the client (timing, account existence, hash corruption — all the same
// from the outside).
var ErrPasswordMismatch = errors.New("auth: password mismatch")
