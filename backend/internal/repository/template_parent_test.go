package repository

import (
	"errors"
	"fmt"
	"testing"

	"github.com/su10/hubtender/backend/internal/calc"
)

// ─── helpers ────────────────────────────────────────────────────────────────

func sp(s string) *string { return &s }

// workRow builds a template work row of the given BOQ type.
func workRow(id, itemType string) tmplItemRow {
	return tmplItemRow{ID: id, Kind: "work", HasWL: true, WItemType: sp(itemType)}
}

// matRow builds a template material row, optionally referencing a parent.
func matRow(id, itemType string, parentTID *string) tmplItemRow {
	return tmplItemRow{ID: id, Kind: "material", HasML: true, MItemType: sp(itemType), ParentTID: parentTID}
}

func indexOf(items []tmplItemRow) map[string]int {
	m := make(map[string]int, len(items))
	for i, t := range items {
		m[t.ID] = i
	}
	return m
}

// assertParentErr asserts err is an InvalidTemplateParentError with the reason.
func assertParentErr(t *testing.T, err error, reason TemplateParentReason) *InvalidTemplateParentError {
	t.Helper()
	var pe *InvalidTemplateParentError
	if !errors.As(err, &pe) {
		t.Fatalf("expected InvalidTemplateParentError, got %v", err)
	}
	if pe.Reason != reason {
		t.Fatalf("reason = %q, want %q", pe.Reason, reason)
	}
	return pe
}

// ─── 1. Standalone material (no ParentTID) ──────────────────────────────────

func TestResolveTemplateParent_NoParent_Standalone(t *testing.T) {
	items := []tmplItemRow{matRow("m1", calc.BoqMat, nil)}

	pIdx, err := resolveTemplateParent(0, items, indexOf(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if pIdx != -1 {
		t.Fatalf("parentIdx = %d, want -1 (standalone)", pIdx)
	}

	// consumption IS applied for a standalone material: 10 × 1.2 × 100 = 1200
	p, err := planTemplateRow(
		tmplItemRow{Kind: "material", HasML: true, MItemType: sp(calc.BoqMat),
			MUnitRate: fp(100), MConsCoef: fp(1.2), MDPT: sp(calc.DeliveryInPrice)},
		pIdx, nil, calc.CurrencyRates{},
	)
	if err != nil {
		t.Fatalf("plan error: %v", err)
	}
	// quantity stays 1 (no conv coeff) ⇒ 1 × 1.2 × 100 = 120
	if !eq(p.TotalAmount, 120) {
		t.Fatalf("standalone total = %v, want 120 (consumption applied)", p.TotalAmount)
	}
}

// ─── 2. Valid work parent → child, consumption NOT re-applied ───────────────

func TestResolveTemplateParent_ValidWorkParent_Child(t *testing.T) {
	items := []tmplItemRow{
		workRow("w1", calc.BoqRab),
		matRow("m1", calc.BoqMat, sp("w1")),
	}

	pIdx, err := resolveTemplateParent(1, items, indexOf(items))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if pIdx != 0 {
		t.Fatalf("parentIdx = %d, want 0", pIdx)
	}

	p, err := planTemplateRow(
		tmplItemRow{Kind: "material", HasML: true, MItemType: sp(calc.BoqMat),
			MUnitRate: fp(100), MConsCoef: fp(1.2), MDPT: sp(calc.DeliveryInPrice)},
		pIdx, nil, calc.CurrencyRates{},
	)
	if err != nil {
		t.Fatalf("plan error: %v", err)
	}
	// child ⇒ consumption forced to 1: 1 × 1 × 100 = 100 (NOT 120)
	if !eq(p.TotalAmount, 100) {
		t.Fatalf("child total = %v, want 100 (consumption forced to 1)", p.TotalAmount)
	}
	if p.ParentIdx != 0 {
		t.Fatalf("plan.ParentIdx = %d, want 0", p.ParentIdx)
	}
	// calc must receive a NON-NIL parent marker.
	in := tmplAmountFields{HasEffectiveParent: p.ParentIdx >= 0}.amountInput()
	if in.ParentWorkItemID == nil {
		t.Fatal("calc must receive a non-nil parent marker for a child row")
	}
}

// ─── 3. Parent not in the insertion set ─────────────────────────────────────

func TestResolveTemplateParent_ParentNotFound(t *testing.T) {
	items := []tmplItemRow{matRow("m1", calc.BoqMat, sp("ghost"))}

	_, err := resolveTemplateParent(0, items, indexOf(items))
	pe := assertParentErr(t, err, ParentNotFound)
	if pe.TemplateItemID != "m1" || pe.ParentTemplateItemID != "ghost" {
		t.Fatalf("unexpected error payload: %+v", pe)
	}
}

// ─── 4. Parent is a material ────────────────────────────────────────────────

func TestResolveTemplateParent_ParentNotWorkItem(t *testing.T) {
	items := []tmplItemRow{
		matRow("m0", calc.BoqMat, nil),      // parent candidate — a MATERIAL
		matRow("m1", calc.BoqMat, sp("m0")), // child pointing at it
	}

	_, err := resolveTemplateParent(1, items, indexOf(items))
	pe := assertParentErr(t, err, ParentNotWorkItem)
	if pe.ParentItemType != calc.BoqMat {
		t.Fatalf("ParentItemType = %q, want %q", pe.ParentItemType, calc.BoqMat)
	}
}

// ─── 5. Self-reference ──────────────────────────────────────────────────────

func TestResolveTemplateParent_SelfReference(t *testing.T) {
	items := []tmplItemRow{matRow("m1", calc.BoqMat, sp("m1"))}

	_, err := resolveTemplateParent(0, items, indexOf(items))
	assertParentErr(t, err, SelfParentReference)
}

// ─── 6. Unknown parent type is NOT a work item ──────────────────────────────

func TestResolveTemplateParent_UnknownParentType_Rejected(t *testing.T) {
	items := []tmplItemRow{
		// a "work"-kind row whose library item_type is garbage
		{ID: "w1", Kind: "work", HasWL: true, WItemType: sp("unknown-type")},
		matRow("m1", calc.BoqMat, sp("w1")),
	}

	_, err := resolveTemplateParent(1, items, indexOf(items))
	pe := assertParentErr(t, err, ParentNotWorkItem)
	if pe.ParentItemType != "unknown-type" {
		t.Fatalf("ParentItemType = %q", pe.ParentItemType)
	}
}

// Empty parent item type is likewise not a work item.
func TestResolveTemplateParent_EmptyParentType_Rejected(t *testing.T) {
	items := []tmplItemRow{
		{ID: "w1", Kind: "work", HasWL: true, WItemType: nil},
		matRow("m1", calc.BoqMat, sp("w1")),
	}
	_, err := resolveTemplateParent(1, items, indexOf(items))
	assertParentErr(t, err, ParentNotWorkItem)
}

// All work subtypes are accepted as parents.
func TestResolveTemplateParent_AllWorkSubtypesAccepted(t *testing.T) {
	for _, wt := range []string{calc.BoqRab, calc.BoqSubRab, calc.BoqRabKomp} {
		items := []tmplItemRow{workRow("w1", wt), matRow("m1", calc.BoqMat, sp("w1"))}
		pIdx, err := resolveTemplateParent(1, items, indexOf(items))
		if err != nil || pIdx != 0 {
			t.Fatalf("work parent %q rejected: idx=%d err=%v", wt, pIdx, err)
		}
	}
}

// ─── 7. errors.As survives the repository → service %w wrapping ─────────────

func TestInvalidTemplateParent_SurvivesWrapping(t *testing.T) {
	inner := &InvalidTemplateParentError{
		TemplateItemID: "m1", ParentTemplateItemID: "m0",
		Reason: ParentNotWorkItem, ParentItemType: calc.BoqMat,
	}
	repoErr := fmt.Errorf("boqRepo.InsertTemplateItems: item #2: %w", inner)
	svcErr := fmt.Errorf("boqService.InsertTemplateItems: %w", repoErr)

	var pe *InvalidTemplateParentError
	if !errors.As(svcErr, &pe) {
		t.Fatal("errors.As must find InvalidTemplateParentError through the %w chain")
	}
	if pe.Reason != ParentNotWorkItem || pe.ParentItemType != calc.BoqMat {
		t.Fatalf("payload lost through wrapping: %+v", pe)
	}
	if pe.Code() != "INVALID_TEMPLATE_PARENT" {
		t.Fatalf("Code() = %q", pe.Code())
	}
}

// ─── 10. A successful plan prices the row for its FINAL parent state ────────

func TestPlanTemplateRow_MatchesCalcForFinalParentState(t *testing.T) {
	rates := calc.CurrencyRates{}
	row := tmplItemRow{
		Kind: "material", HasML: true, MItemType: sp(calc.BoqMat),
		MUnitRate: fp(100), MConsCoef: fp(1.2), MDPT: sp(calc.DeliveryInPrice),
	}

	// standalone (parentIdx = -1)
	standalone, err := planTemplateRow(row, -1, nil, rates)
	if err != nil {
		t.Fatalf("plan error: %v", err)
	}
	wantStandalone := oracle(t, tmplAmountFields{
		ItemType: calc.BoqMat, Currency: calc.CurrencyRUB, Quantity: 1, UnitRate: 100,
		DeliveryPriceType: calc.DeliveryInPrice, ConsumptionCoeff: fp(1.2),
		HasEffectiveParent: false,
	}.amountInput(), rates)
	if !eq(standalone.TotalAmount, wantStandalone) {
		t.Fatalf("standalone plan = %v, calc = %v", standalone.TotalAmount, wantStandalone)
	}

	// child (parentIdx = 0)
	child, err := planTemplateRow(row, 0, nil, rates)
	if err != nil {
		t.Fatalf("plan error: %v", err)
	}
	wantChild := oracle(t, tmplAmountFields{
		ItemType: calc.BoqMat, Currency: calc.CurrencyRUB, Quantity: 1, UnitRate: 100,
		DeliveryPriceType: calc.DeliveryInPrice, ConsumptionCoeff: fp(1.2),
		HasEffectiveParent: true,
	}.amountInput(), rates)
	if !eq(child.TotalAmount, wantChild) {
		t.Fatalf("child plan = %v, calc = %v", child.TotalAmount, wantChild)
	}

	if eq(standalone.TotalAmount, child.TotalAmount) {
		t.Fatal("standalone and child must differ (consumption applied vs forced to 1)")
	}
}
