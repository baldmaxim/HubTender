package repository

import (
	"math"
	"testing"
)

// Stage 0-F1 §G: the pure mismatch-report helpers. The client total is
// diagnostic ONLY — these tests pin that it can flag a warning but can never
// change the persisted (server) value, which is passed in as-is.

func TestBuildImportTotalMismatch_AgreementWithinTolerance(t *testing.T) {
	// G.4 — client total matches the server calc → no warning.
	if m := buildImportTotalMismatch(3, "бетон", 50000, 50000); m != nil {
		t.Fatalf("exact match must produce no mismatch, got %+v", m)
	}
	// Last-money-digit noise (≤ ImportTotalMismatchTolerance) is not a warning.
	if m := buildImportTotalMismatch(3, "бетон", 50000.01, 50000); m != nil {
		t.Fatalf("one-kopeck noise must be silenced, got %+v", m)
	}
	if m := buildImportTotalMismatch(3, "бетон", 49999.99, 50000); m != nil {
		t.Fatalf("one-kopeck noise (down) must be silenced, got %+v", m)
	}
}

func TestBuildImportTotalMismatch_DivergenceReported(t *testing.T) {
	// G.5 — forged/broken client total → warning with the SERVER value intact.
	m := buildImportTotalMismatch(7, "арматура", 1, 50000)
	if m == nil {
		t.Fatal("client=1 vs server=50000 must be a mismatch")
	}
	if m.ServerTotalAmount != 50000 || m.ClientTotalAmount != 1 {
		t.Fatalf("values swapped or altered: %+v", m)
	}
	if m.RowNumber != 7 || m.ItemName != "арматура" {
		t.Fatalf("row identity lost: %+v", m)
	}
	if m.AbsoluteDifference != 49999 {
		t.Fatalf("abs diff = %v, want 49999", m.AbsoluteDifference)
	}
	if math.Abs(m.RelativeDifferencePercent-49999.0/50000*100) > 1e-9 {
		t.Fatalf("rel%% = %v", m.RelativeDifferencePercent)
	}
}

func TestBuildImportTotalMismatch_NegativeClientTotal(t *testing.T) {
	// G.6 — a negative client total is just a divergent diagnostic value; the
	// server total (authoritative) is reported unchanged.
	m := buildImportTotalMismatch(1, "мат", -100, 250)
	if m == nil || m.ServerTotalAmount != 250 {
		t.Fatalf("negative client total must not affect the server value: %+v", m)
	}
}

func TestBuildImportTotalMismatch_ZeroServerTotal(t *testing.T) {
	m := buildImportTotalMismatch(2, "раб", 10, 0)
	if m == nil || m.RelativeDifferencePercent != 100 {
		t.Fatalf("zero server total → 100%% marker, got %+v", m)
	}
}

func TestImportItemName(t *testing.T) {
	desc := "Кладка"
	if got := importItemName(ImportBoqItem{Description: &desc, BoqItemType: "раб"}); got != "Кладка" {
		t.Fatalf("description must win, got %q", got)
	}
	empty := ""
	if got := importItemName(ImportBoqItem{Description: &empty, BoqItemType: "мат"}); got != "мат" {
		t.Fatalf("empty description falls back to type, got %q", got)
	}
	if got := importItemName(ImportBoqItem{BoqItemType: "суб-раб"}); got != "суб-раб" {
		t.Fatalf("nil description falls back to type, got %q", got)
	}
}

func TestDerefIntOrZero(t *testing.T) {
	if derefIntOrZero(nil) != 0 {
		t.Fatal("nil → 0")
	}
	v := 42
	if derefIntOrZero(&v) != 42 {
		t.Fatal("deref lost the value")
	}
}
