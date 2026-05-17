package auth

import (
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
)

// SigningKey holds the active RSA private key plus a stable JWKS-style kid
// computed once at load time. The kid is a JWK SHA-256 thumbprint (RFC 7638),
// so it follows the public key — rotating the private key produces a new
// kid and old tokens stay verifiable until they expire (multi-key JWKS).
type SigningKey struct {
	Private *rsa.PrivateKey
	KID     string
}

// LoadSigningKey parses a PEM-encoded RSA private key (PKCS#1 or PKCS#8).
// 4096-bit keys are recommended; 2048-bit are accepted for dev convenience.
// Anything weaker is rejected outright — JWKS publishes the public part, so
// short moduli leak signature security to the world.
func LoadSigningKey(pemBytes []byte) (*SigningKey, error) {
	block, _ := pem.Decode(pemBytes)
	if block == nil {
		return nil, errors.New("auth: PEM decode failed (no block)")
	}

	var priv *rsa.PrivateKey
	switch block.Type {
	case "RSA PRIVATE KEY":
		// PKCS#1
		k, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("auth: parse PKCS#1: %w", err)
		}
		priv = k
	case "PRIVATE KEY":
		// PKCS#8 — standard openssl genpkey output.
		k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("auth: parse PKCS#8: %w", err)
		}
		rsaKey, ok := k.(*rsa.PrivateKey)
		if !ok {
			return nil, fmt.Errorf("auth: PKCS#8 key is not RSA (%T)", k)
		}
		priv = rsaKey
	default:
		return nil, fmt.Errorf("auth: unexpected PEM block type %q", block.Type)
	}

	if priv.N.BitLen() < 2048 {
		return nil, fmt.Errorf("auth: RSA key too short (%d bits, need ≥ 2048)", priv.N.BitLen())
	}

	kid, err := jwkThumbprintRS256(&priv.PublicKey)
	if err != nil {
		return nil, fmt.Errorf("auth: compute kid: %w", err)
	}

	return &SigningKey{Private: priv, KID: kid}, nil
}

// JWK is the subset of fields published in /.well-known/jwks.json for an
// RS256 signing key. Field order in the struct does not matter — JSON output
// follows the json tags.
type JWK struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	Kid string `json:"kid"`
	N   string `json:"n"`
	E   string `json:"e"`
}

// JWKSet is the wire format returned by GET /.well-known/jwks.json.
type JWKSet struct {
	Keys []JWK `json:"keys"`
}

// PublicJWKS returns a JWKS containing only the public part of every active
// signing key. Today we expose one key; the slice shape leaves room for a
// rotation window where two keys are published simultaneously.
func (k *SigningKey) PublicJWKS() JWKSet {
	pub := k.Private.PublicKey
	return JWKSet{
		Keys: []JWK{{
			Kty: "RSA",
			Use: "sig",
			Alg: "RS256",
			Kid: k.KID,
			N:   base64URL(pub.N.Bytes()),
			E:   base64URL(big.NewInt(int64(pub.E)).Bytes()),
		}},
	}
}

// jwkThumbprintRS256 implements RFC 7638 for an RS256 RSA key. The thumbprint
// is the SHA-256 of the JSON {"e":...,"kty":"RSA","n":...} with members in
// lexicographic order, base64url-encoded. Stable across processes — same
// public key always yields the same kid.
func jwkThumbprintRS256(pub *rsa.PublicKey) (string, error) {
	canonical := fmt.Sprintf(
		`{"e":"%s","kty":"RSA","n":"%s"}`,
		base64URL(big.NewInt(int64(pub.E)).Bytes()),
		base64URL(pub.N.Bytes()),
	)
	sum := sha256.Sum256([]byte(canonical))
	return base64URL(sum[:]), nil
}

// base64URL is RFC 4648 §5 (URL-safe, no padding) — the encoding required
// for every JWK numeric field and for the JWT header/payload/signature.
func base64URL(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}
