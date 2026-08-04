// Package keycrypt шифрует UI-заданный OpenRouter API-ключ для хранения в БД.
//
// Схема: AES-256-GCM; ключ шифрования = SHA-256 от байтов серверного
// JWT-private-key (APP_JWT_PRIVATE_KEY_PATH / _B64 — он существует только на
// сервере и никогда не попадает в БД/бэкапы/фронт). Восстановленный в другом
// окружении дамп БД содержит бесполезный шифротекст: без JWT-ключа этого
// сервера расшифровка невозможна.
//
// Plaintext-ключ НИКОГДА не логируется и не возвращается наружу; наружу — только
// суффикс (последние 4 символа) и признак источника.
package keycrypt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
)

// Cipher — материализованный AEAD поверх производного ключа.
type Cipher struct {
	aead cipher.AEAD
}

var (
	// ErrEmptyMaster — не передан материал для производного ключа.
	ErrEmptyMaster = errors.New("keycrypt: пустой master-материал (JWT private key)")
	// ErrCiphertext — повреждённый/чужой шифротекст (в т.ч. восстановленный
	// в окружении с другим JWT-ключом) — fail-closed.
	ErrCiphertext = errors.New("keycrypt: шифротекст не расшифровывается этим сервером")
)

// New строит Cipher из master-материала (байты PEM JWT-private-key).
func New(master []byte) (*Cipher, error) {
	if len(master) == 0 {
		return nil, ErrEmptyMaster
	}
	sum := sha256.Sum256(master)
	block, err := aes.NewCipher(sum[:])
	if err != nil {
		return nil, fmt.Errorf("keycrypt: %w", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("keycrypt: %w", err)
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt возвращает nonce||ciphertext.
func (c *Cipher) Encrypt(plaintext string) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("keycrypt: nonce: %w", err)
	}
	return append(nonce, c.aead.Seal(nil, nonce, []byte(plaintext), nil)...), nil
}

// Decrypt принимает nonce||ciphertext.
func (c *Cipher) Decrypt(blob []byte) (string, error) {
	ns := c.aead.NonceSize()
	if len(blob) <= ns {
		return "", ErrCiphertext
	}
	out, err := c.aead.Open(nil, blob[:ns], blob[ns:], nil)
	if err != nil {
		return "", ErrCiphertext
	}
	return string(out), nil
}

// Suffix — безопасная для отображения часть ключа (последние 4 символа).
func Suffix(key string) string {
	if len(key) <= 4 {
		return "****"
	}
	return "…" + key[len(key)-4:]
}
