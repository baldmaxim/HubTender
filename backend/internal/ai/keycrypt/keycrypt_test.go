package keycrypt

import (
	"bytes"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	c, err := New([]byte("-----BEGIN PRIVATE KEY----- test material"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	blob, err := c.Encrypt("sk-or-v1-abcdef1234")
	if err != nil {
		t.Fatalf("Encrypt: %v", err)
	}
	if bytes.Contains(blob, []byte("sk-or-v1")) {
		t.Fatal("шифротекст содержит plaintext")
	}
	got, err := c.Decrypt(blob)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if got != "sk-or-v1-abcdef1234" {
		t.Fatalf("roundtrip mismatch")
	}
}

func TestForeignMasterFailsClosed(t *testing.T) {
	a, _ := New([]byte("master-A"))
	b, _ := New([]byte("master-B"))
	blob, _ := a.Encrypt("secret")
	if _, err := b.Decrypt(blob); err == nil {
		t.Fatal("чужой master обязан давать ошибку (бэкап в другом окружении)")
	}
}

func TestTamperedCiphertextFailsClosed(t *testing.T) {
	c, _ := New([]byte("master"))
	blob, _ := c.Encrypt("secret")
	blob[len(blob)-1] ^= 0xFF
	if _, err := c.Decrypt(blob); err == nil {
		t.Fatal("подделанный шифротекст обязан давать ошибку")
	}
}

func TestEmptyMaster(t *testing.T) {
	if _, err := New(nil); err == nil {
		t.Fatal("пустой master запрещён")
	}
}

func TestSuffix(t *testing.T) {
	if Suffix("sk-or-v1-abcd") != "…abcd" {
		t.Fatalf("suffix = %q", Suffix("sk-or-v1-abcd"))
	}
	if Suffix("ab") != "****" {
		t.Fatal("короткий ключ обязан маскироваться целиком")
	}
}
