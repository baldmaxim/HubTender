package repository

import (
	"errors"
	"strings"
	"testing"
	"time"
)

// Дата цены в массовом импорте — metadata-only: проверяется по тем же правилам,
// что и при создании одной строки, ошибка — 400 с номером строки.

func TestImportQuotePriceDate_Valid(t *testing.T) {
	cases := []struct {
		name string
		in   *string
		want any
	}{
		{"не передана", nil, nil},
		{"пустая строка → NULL", strPtr("  "), nil},
		{"дата 1С", strPtr("2025-06-26"), "2025-06-26"},
	}
	for _, c := range cases {
		got, err := importQuotePriceDate(ImportBoqItem{QuotePriceDate: c.in}, "5")
		if err != nil {
			t.Fatalf("%s: неожиданная ошибка %v", c.name, err)
		}
		if got != c.want {
			t.Fatalf("%s: получили %v, ждали %v", c.name, got, c.want)
		}
	}
}

func TestImportQuotePriceDate_Invalid(t *testing.T) {
	future := time.Now().UTC().AddDate(0, 0, 3).Format("2006-01-02")
	cases := map[string]string{
		"26.06.2025": "ожидается дата в формате ГГГГ-ММ-ДД",
		future:       "не может быть в будущем",
	}
	for in, wantReason := range cases {
		_, err := importQuotePriceDate(ImportBoqItem{QuotePriceDate: strPtr(in)}, "7")
		var bulk *ErrBulkImport
		if !errors.As(err, &bulk) {
			t.Fatalf("%q: ждали ErrBulkImport (400), получили %v", in, err)
		}
		if !strings.HasPrefix(bulk.Message, "Строка 7: ") || !strings.Contains(bulk.Message, wantReason) {
			t.Fatalf("%q: сообщение %q", in, bulk.Message)
		}
	}
}
