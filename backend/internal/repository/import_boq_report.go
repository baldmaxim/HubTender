package repository

import (
	"math"
)

// Stage 0-F1: diagnostic import mismatch report helpers (pure functions).
// The client's total_amount is NEVER persisted — these only compare it with
// the authoritative server calculation for the warning report.

// derefIntOrZero — nil-safe *int → int (row_index is optional in the payload).
func derefIntOrZero(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

// importItemName picks a human-readable identifier for the mismatch report:
// the row description when present, otherwise the BOQ item type.
func importItemName(item ImportBoqItem) string {
	if item.Description != nil && *item.Description != "" {
		return *item.Description
	}
	return item.BoqItemType
}

// buildImportTotalMismatch compares the legacy client's diagnostic control
// value with the authoritative server total. Returns nil when they agree
// within ImportTotalMismatchTolerance (last-digit noise is not a warning).
// The comparison NEVER changes what is persisted.
func buildImportTotalMismatch(rowNumber int, itemName string, clientTotal, serverTotal float64) *ImportTotalMismatch {
	diff := math.Abs(clientTotal - serverTotal)
	// Compare in whole kopecks so binary float noise around the tolerance
	// boundary (e.g. 50000.01-50000 > 0.01 in float64) never flags a
	// last-digit-only difference. Diagnostic path — not authoritative money.
	if math.Round(diff*100) <= ImportTotalMismatchTolerance*100 {
		return nil
	}
	relPct := 0.0
	if serverTotal != 0 {
		relPct = diff / math.Abs(serverTotal) * 100
	} else {
		relPct = 100
	}
	return &ImportTotalMismatch{
		RowNumber:                 rowNumber,
		ItemName:                  itemName,
		ClientTotalAmount:         clientTotal,
		ServerTotalAmount:         serverTotal,
		AbsoluteDifference:        diff,
		RelativeDifferencePercent: relPct,
	}
}
