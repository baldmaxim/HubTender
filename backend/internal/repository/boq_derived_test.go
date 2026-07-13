package repository

import (
	"errors"
	"fmt"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

func pref(s string) *string { return &s }

func assertBoqParentErr(t *testing.T, err error, reason BoqParentReason) *InvalidBoqParentError {
	t.Helper()
	var pe *InvalidBoqParentError
	if !errors.As(err, &pe) {
		t.Fatalf("expected InvalidBoqParentError, got %v", err)
	}
	if pe.Reason != reason {
		t.Fatalf("reason = %q, want %q", pe.Reason, reason)
	}
	return pe
}

// D16/D17. Work + child material: the child is remapped onto the COPIED work.
func TestResolveCopiedParents_WorkAndChild(t *testing.T) {
	rows := []CopiedParentRef{
		{ID: "w1", ItemType: calc.BoqRab},
		{ID: "m1", ItemType: calc.BoqMat, ParentID: pref("w1")},
		{ID: "m2", ItemType: calc.BoqMat}, // standalone
	}
	idx, err := ResolveCopiedParents(rows)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if idx[0] != -1 {
		t.Fatalf("work must be standalone, got %d", idx[0])
	}
	if idx[1] != 0 {
		t.Fatalf("child must point at the copied work (index 0), got %d", idx[1])
	}
	if idx[2] != -1 {
		t.Fatalf("standalone material must have no parent, got %d", idx[2])
	}
}

// D19. Parent outside the copied set → blocking error (never a cleared link).
func TestResolveCopiedParents_ParentNotCopied(t *testing.T) {
	rows := []CopiedParentRef{
		{ID: "m1", ItemType: calc.BoqMat, ParentID: pref("w-elsewhere")},
	}
	_, err := ResolveCopiedParents(rows)
	pe := assertBoqParentErr(t, err, BoqParentNotCopied)
	if pe.ItemID != "m1" || pe.ParentItemID != "w-elsewhere" {
		t.Fatalf("unexpected payload: %+v", pe)
	}
}

// D19. Parent is a material → blocking error.
func TestResolveCopiedParents_ParentNotWorkItem(t *testing.T) {
	rows := []CopiedParentRef{
		{ID: "m0", ItemType: calc.BoqMat},
		{ID: "m1", ItemType: calc.BoqMat, ParentID: pref("m0")},
	}
	_, err := ResolveCopiedParents(rows)
	pe := assertBoqParentErr(t, err, BoqParentNotWorkItem)
	if pe.ParentItemType != calc.BoqMat {
		t.Fatalf("ParentItemType = %q", pe.ParentItemType)
	}
}

// Self-reference → blocking error.
func TestResolveCopiedParents_SelfReference(t *testing.T) {
	rows := []CopiedParentRef{{ID: "m1", ItemType: calc.BoqMat, ParentID: pref("m1")}}
	_, err := ResolveCopiedParents(rows)
	assertBoqParentErr(t, err, BoqSelfParentReference)
}

// All work subtypes are valid parents.
func TestResolveCopiedParents_AllWorkSubtypes(t *testing.T) {
	for _, wt := range []string{calc.BoqRab, calc.BoqSubRab, calc.BoqRabKomp} {
		rows := []CopiedParentRef{
			{ID: "w1", ItemType: wt},
			{ID: "m1", ItemType: calc.BoqMat, ParentID: pref("w1")},
		}
		idx, err := ResolveCopiedParents(rows)
		if err != nil || idx[1] != 0 {
			t.Fatalf("work parent %q rejected: idx=%v err=%v", wt, idx, err)
		}
	}
}

// The error survives the repository → service %w chain (errors.As).
func TestInvalidBoqParentError_SurvivesWrapping(t *testing.T) {
	inner := &InvalidBoqParentError{
		ItemID: "m1", ParentItemID: "m0",
		Reason: BoqParentNotWorkItem, ParentItemType: calc.BoqMat,
	}
	wrapped := fmt.Errorf("boqService.CopyPositionItems: %w",
		fmt.Errorf("boqRepo.CopyPositionItems: %w", inner))

	var pe *InvalidBoqParentError
	if !errors.As(wrapped, &pe) {
		t.Fatal("errors.As must find InvalidBoqParentError through the %w chain")
	}
	if pe.Code() != "INVALID_BOQ_PARENT" {
		t.Fatalf("Code() = %q", pe.Code())
	}
}
