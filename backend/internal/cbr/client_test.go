package cbr

import (
	"math"
	"strings"
	"testing"
)

// sampleXML mirrors the real CBR daily feed: windows-1251 declared, comma
// decimals, and a non-unit nominal on CNY to exercise the division. Names use
// ASCII here so the literal stays valid UTF-8 source while still routing
// through the windows-1251 CharsetReader.
const sampleXML = `<?xml version="1.0" encoding="windows-1251"?>` +
	`<ValCurs Date="09.06.2026" name="Foreign Currency Market">` +
	`<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>USD</Name><Value>73,2644</Value><VunitRate>73,2644</VunitRate></Valute>` +
	`<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>EUR</Name><Value>85,2798</Value><VunitRate>85,2798</VunitRate></Valute>` +
	`<Valute ID="R01375"><NumCode>156</NumCode><CharCode>CNY</CharCode><Nominal>10</Nominal><Name>CNY</Name><Value>107,826</Value><VunitRate>10,7826</VunitRate></Valute>` +
	`</ValCurs>`

func almost(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func TestParseValCurs(t *testing.T) {
	r, err := parseValCurs(strings.NewReader(sampleXML))
	if err != nil {
		t.Fatalf("parseValCurs: %v", err)
	}
	if r.Date != "2026-06-09" {
		t.Errorf("Date = %q, want 2026-06-09", r.Date)
	}
	if !almost(r.USD, 73.26) {
		t.Errorf("USD = %v, want 73.26", r.USD)
	}
	if !almost(r.EUR, 85.28) {
		t.Errorf("EUR = %v, want 85.28", r.EUR)
	}
	// 107,826 quoted per nominal 10 → 10.7826 → rounded 10.78.
	if !almost(r.CNY, 10.78) {
		t.Errorf("CNY = %v, want 10.78", r.CNY)
	}
}

func TestParseValCurs_MissingCurrency(t *testing.T) {
	xml := `<?xml version="1.0" encoding="windows-1251"?>` +
		`<ValCurs Date="09.06.2026"><Valute ID="R01235"><CharCode>USD</CharCode><Nominal>1</Nominal><Value>73,2644</Value></Valute></ValCurs>`
	if _, err := parseValCurs(strings.NewReader(xml)); err == nil {
		t.Error("expected error when EUR/CNY are absent, got nil")
	}
}

func TestParseRate(t *testing.T) {
	got, err := parseRate("107,826", "10")
	if err != nil {
		t.Fatalf("parseRate: %v", err)
	}
	if !almost(got, 10.78) {
		t.Errorf("parseRate = %v, want 10.78", got)
	}
	// Empty / invalid nominal must default to 1, not divide by zero.
	got, err = parseRate("90,5", "")
	if err != nil {
		t.Fatalf("parseRate empty nominal: %v", err)
	}
	if !almost(got, 90.5) {
		t.Errorf("parseRate empty nominal = %v, want 90.5", got)
	}
}
