package repository

import (
	"fmt"

	"github.com/su10/hubtender/backend/internal/calc"
)

// TemplateParentReason enumerates why a template row's parent link is invalid.
type TemplateParentReason string

const (
	// ParentNotFound — the referenced template item does not exist in this template.
	ParentNotFound TemplateParentReason = "PARENT_NOT_FOUND"
	// ParentNotInserted — the referenced item exists but is not part of the actual
	// insertion set. In the current model the insertion set IS the full template
	// item set (tmplItemsQ selects every row of the template), so this reason is
	// not reachable today; it is kept so the distinction survives if the insertion
	// set ever becomes a subset.
	ParentNotInserted TemplateParentReason = "PARENT_NOT_INSERTED"
	// ParentNotWorkItem — the referenced parent resolves to a non-work BOQ type.
	ParentNotWorkItem TemplateParentReason = "PARENT_NOT_WORK_ITEM"
	// SelfParentReference — the row references itself as its own parent.
	SelfParentReference TemplateParentReason = "SELF_PARENT_REFERENCE"
)

// InvalidTemplateParentError is a blocking domain error: a template row declares a
// parent link that cannot resolve to a real, inserted WORK row.
//
// It is never downgraded to "standalone material" — silently dropping a declared
// parent would change the money (consumption would be applied to a row that is
// meant to inherit its parent's quantity semantics) and hide a corrupt template.
// The handler maps it to RFC 7807 400 with code INVALID_TEMPLATE_PARENT.
type InvalidTemplateParentError struct {
	TemplateItemID       string
	ParentTemplateItemID string
	Reason               TemplateParentReason
	// ParentItemType is the resolved boq_item_type of the parent, when known
	// (populated for PARENT_NOT_WORK_ITEM). Empty otherwise.
	ParentItemType string
}

func (e *InvalidTemplateParentError) Error() string {
	if e.ParentItemType != "" {
		return fmt.Sprintf("INVALID_TEMPLATE_PARENT: %s (template item %s → parent %s, тип родителя %q)",
			e.Reason, e.TemplateItemID, e.ParentTemplateItemID, e.ParentItemType)
	}
	return fmt.Sprintf("INVALID_TEMPLATE_PARENT: %s (template item %s → parent %s)",
		e.Reason, e.TemplateItemID, e.ParentTemplateItemID)
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *InvalidTemplateParentError) Code() string { return "INVALID_TEMPLATE_PARENT" }

// templateItemType returns the boq_item_type this template row will persist.
// Works take it from works_library, materials from materials_library.
func templateItemType(t tmplItemRow) string {
	if t.Kind == "work" {
		return strOrEmpty(t.WItemType)
	}
	return strOrEmpty(t.MItemType)
}

// resolveTemplateParent validates ONE row's parent link against the actual
// insertion set and returns the index of its effective parent, or -1 when the row
// is standalone (no parent declared).
//
// Invariant: a row is treated as a child for calculation purposes ONLY when, after
// a successful operation, its parent_work_item_id will point at a really-inserted
// BOQ row of a WORK type. Merely having a non-nil ParentTID is not enough.
//
// A declared-but-invalid link is a blocking error — never a silent standalone.
func resolveTemplateParent(i int, items []tmplItemRow, idxByTID map[string]int) (int, error) {
	t := items[i]
	if t.ParentTID == nil {
		return -1, nil // A. standalone
	}
	pid := *t.ParentTID

	// F. self-reference (checked before the map lookup — self IS in the map).
	if pid == t.ID {
		return -1, &InvalidTemplateParentError{
			TemplateItemID:       t.ID,
			ParentTemplateItemID: pid,
			Reason:               SelfParentReference,
		}
	}

	// C/D. parent absent from the insertion set.
	pIdx, ok := idxByTID[pid]
	if !ok {
		return -1, &InvalidTemplateParentError{
			TemplateItemID:       t.ID,
			ParentTemplateItemID: pid,
			Reason:               ParentNotFound,
		}
	}

	// E. parent must be a WORK item — canonical predicate from calc, no local list.
	pType := templateItemType(items[pIdx])
	if !calc.IsWorkBoqType(pType) {
		return -1, &InvalidTemplateParentError{
			TemplateItemID:       t.ID,
			ParentTemplateItemID: pid,
			Reason:               ParentNotWorkItem,
			ParentItemType:       pType,
		}
	}

	return pIdx, nil // B. valid child
}
