package apikey

import (
	"errors"
	"strings"
	"testing"
)

func TestGenerateProducesDistinctSecrets(t *testing.T) {
	a, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	b, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if a.Secret == b.Secret {
		t.Fatal("два выпуска дали одинаковый секрет")
	}
	if !strings.HasPrefix(a.Secret, Prefix) {
		t.Fatalf("секрет должен начинаться с %q, получили %q", Prefix, a.Secret)
	}
	if a.Hash == a.Secret {
		t.Fatal("хеш не должен совпадать с секретом")
	}
	if len(a.Hash) != 64 {
		t.Fatalf("SHA-256 hex = 64 символа, получили %d", len(a.Hash))
	}
}

func TestHashIsStableAndSecretNotRecoverable(t *testing.T) {
	g, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if Hash(g.Secret) != g.Hash {
		t.Fatal("повторное хеширование дало другой результат")
	}
	if strings.Contains(g.Hash, strings.TrimPrefix(g.Secret, Prefix)) {
		t.Fatal("хеш содержит секрет в открытом виде")
	}
}

func TestDisplayPrefixIsNotTheWholeSecret(t *testing.T) {
	g, err := Generate()
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if len([]rune(g.Prefix)) != DisplayPrefixLen {
		t.Fatalf("длина префикса = %d, want %d", len([]rune(g.Prefix)), DisplayPrefixLen)
	}
	if g.Prefix == g.Secret {
		t.Fatal("префикс не должен совпадать с полным секретом")
	}
	if !strings.HasPrefix(g.Secret, g.Prefix) {
		t.Fatal("префикс должен быть началом секрета")
	}
}

func TestEqualComparesHashes(t *testing.T) {
	if !Equal("abc", "abc") {
		t.Fatal("одинаковые строки должны совпадать")
	}
	if Equal("abc", "abd") {
		t.Fatal("разные строки не должны совпадать")
	}
	if Equal("abc", "abcd") {
		t.Fatal("строки разной длины не должны совпадать")
	}
}

func TestLooksLikeKey(t *testing.T) {
	g, _ := Generate()
	if !LooksLikeKey(g.Secret) {
		t.Fatal("настоящий ключ должен опознаваться")
	}
	for _, bad := range []string{"", "thk_", "thk_short", "Bearer eyJhb..."} {
		if LooksLikeKey(bad) {
			t.Fatalf("%q не должен опознаваться как ключ", bad)
		}
	}
}

func TestNormalizeScopes(t *testing.T) {
	got, err := NormalizeScopes([]string{ScopeArchiveWrite, " ", ScopeArchiveRead, ScopeArchiveWrite})
	if err != nil {
		t.Fatalf("NormalizeScopes: %v", err)
	}
	if len(got) != 2 || got[0] != ScopeArchiveRead || got[1] != ScopeArchiveWrite {
		t.Fatalf("ожидали отсортированный дедуплицированный набор, получили %v", got)
	}
}

func TestNormalizeScopesRejectsUnknownAndEmpty(t *testing.T) {
	if _, err := NormalizeScopes([]string{"archive:delete"}); !errors.Is(err, ErrUnknownScope) {
		t.Fatalf("неизвестная область → ErrUnknownScope, получили %v", err)
	}
	if _, err := NormalizeScopes(nil); !errors.Is(err, ErrNoScopes) {
		t.Fatalf("пустой набор → ErrNoScopes, получили %v", err)
	}
	if _, err := NormalizeScopes([]string{"  "}); !errors.Is(err, ErrNoScopes) {
		t.Fatalf("только пробелы → ErrNoScopes, получили %v", err)
	}
}

func TestHasScope(t *testing.T) {
	scopes := []string{ScopeArchiveRead}
	if !HasScope(scopes, ScopeArchiveRead) {
		t.Fatal("archive:read должен находиться")
	}
	if HasScope(scopes, ScopeArchiveWrite) {
		t.Fatal("archive:write выдавать нельзя")
	}
}
