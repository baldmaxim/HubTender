package repository

import (
	"encoding/json"
	"fmt"
	"regexp"

	"github.com/su10/hubtender/backend/internal/calc"
)

// ─── Stage 0.1.2.2b — audit rollback snapshot: explicit allowlist ────────────
//
// An audit snapshot (boq_items_audit.old_data) may only restore USER INPUTS.
// Derived money (total_amount / commercial_*) is NEVER read into the plan: after
// the inputs are restored, the authoritative values are recomputed by
// backend/internal/calc from the CURRENT tender FX/configuration, in the same
// transaction. Identity/scope fields are verified, not blindly applied.

// ─── typed domain errors ─────────────────────────────────────────────────────

// BoqAuditSnapshotReason is the machine-readable reason of a snapshot rejection.
type BoqAuditSnapshotReason string

const (
	// SnapshotMissing — the audit row has no snapshot to restore from.
	SnapshotMissing BoqAuditSnapshotReason = "SNAPSHOT_MISSING"
	// RequiredFieldMissing — a required input (boq_item_type, or identity for a
	// DELETE restore) is absent or null in the snapshot.
	RequiredFieldMissing BoqAuditSnapshotReason = "REQUIRED_FIELD_MISSING"
	// InvalidFieldType — a snapshot value has the wrong JSON type (e.g. quantity
	// as a string).
	InvalidFieldType BoqAuditSnapshotReason = "INVALID_FIELD_TYPE"
	// InvalidEnumValue — an enum value the current domain model does not know.
	// It is NEVER silently coerced (no unknown→RUB, no unknown→мат).
	InvalidEnumValue BoqAuditSnapshotReason = "INVALID_ENUM_VALUE"
	// InvalidRelationReference — a restored FK reference (nomenclature, cost
	// category, position) does not resolve.
	InvalidRelationReference BoqAuditSnapshotReason = "INVALID_RELATION_REFERENCE"
)

// InvalidBoqAuditSnapshotError is a blocking domain error: the audit snapshot
// cannot be safely interpreted, so NOTHING is restored (no partial rollback).
type InvalidBoqAuditSnapshotError struct {
	AuditID string
	ItemID  string
	Field   string
	Reason  BoqAuditSnapshotReason
}

func (e *InvalidBoqAuditSnapshotError) Error() string {
	return fmt.Sprintf("INVALID_BOQ_AUDIT_SNAPSHOT: %s (audit %s, item %s, field %q)",
		e.Reason, e.AuditID, e.ItemID, e.Field)
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *InvalidBoqAuditSnapshotError) Code() string { return "INVALID_BOQ_AUDIT_SNAPSHOT" }

// BoqAuditTargetMismatchError is a blocking domain error: the audit record does
// not belong to the item/tender the rollback would mutate. An audit row of one
// item/tender can never be applied to another.
type BoqAuditTargetMismatchError struct {
	AuditID          string
	ExpectedItemID   string
	ActualItemID     string
	ExpectedTenderID string
	ActualTenderID   string
}

func (e *BoqAuditTargetMismatchError) Error() string {
	return fmt.Sprintf("BOQ_AUDIT_TARGET_MISMATCH: audit %s (item %s≠%s / tender %s≠%s)",
		e.AuditID, e.ExpectedItemID, e.ActualItemID, e.ExpectedTenderID, e.ActualTenderID)
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *BoqAuditTargetMismatchError) Code() string { return "BOQ_AUDIT_TARGET_MISMATCH" }

// UnsupportedBoqAuditRollbackError is a blocking domain error: the audit
// operation type has no rollback semantics (e.g. INSERT undo is not supported).
type UnsupportedBoqAuditRollbackError struct {
	AuditID   string
	Operation string
}

func (e *UnsupportedBoqAuditRollbackError) Error() string {
	return fmt.Sprintf("UNSUPPORTED_BOQ_AUDIT_ROLLBACK: audit %s, operation %q",
		e.AuditID, e.Operation)
}

// Code returns the stable machine-readable error code for API envelopes.
func (e *UnsupportedBoqAuditRollbackError) Code() string { return "UNSUPPORTED_BOQ_AUDIT_ROLLBACK" }

// ─── field classification ────────────────────────────────────────────────────

// boqAuditInputAllowlist is the EXPLICIT set of user-editable inputs a rollback
// may restore from a server-side audit snapshot (class A + validated relations,
// class D). A column not listed here is NEVER applied — a new column does not
// become rollback-able just because it appears in a snapshot. This is an
// allowlist, not "whole JSON minus known derived fields".
var boqAuditInputAllowlist = map[string]bool{
	"boq_item_type":           true,
	"material_type":           true,
	"description":             true,
	"unit_code":               true,
	"quantity":                true,
	"base_quantity":           true,
	"conversion_coefficient":  true,
	"unit_rate":               true,
	"currency_type":           true,
	"delivery_price_type":     true,
	"delivery_amount":         true,
	"consumption_coefficient": true,
	"detail_cost_category_id": true,
	"material_name_id":        true,
	"work_name_id":            true,
	"parent_work_item_id":     true,
	"sort_number":             true,
	"quote_link":              true,
}

// boqAuditDerivedFields — class B: calculated money. Present in historical
// snapshots for forensic display, but NEVER restored as authoritative values.
var boqAuditDerivedFields = map[string]bool{
	"total_amount":                   true,
	"commercial_markup":              true,
	"total_commercial_material_cost": true,
	"total_commercial_work_cost":     true,
}

// boqAuditIdentityFields — class C: identity/system metadata. Never restored on
// an UPDATE rollback; on a DELETE restore, id/tender_id/client_position_id are
// applied only under the documented contract (original id preserved so child
// parent links survive) after explicit verification. Timestamps get fresh
// defaults; import_session_id is import-run metadata, not a user input.
var boqAuditIdentityFields = map[string]bool{
	"id":                 true,
	"tender_id":          true,
	"client_position_id": true,
	"created_at":         true,
	"updated_at":         true,
	"import_session_id":  true,
}

// enum vocabularies of the CURRENT domain model. An unknown value is a blocking
// InvalidEnumValue — never a silent coercion.
var (
	validBoqItemTypes = map[string]bool{
		calc.BoqRab: true, calc.BoqSubRab: true, calc.BoqRabKomp: true,
		calc.BoqMat: true, calc.BoqSubMat: true, calc.BoqMatKomp: true,
	}
	validMaterialTypes = map[string]bool{"основн.": true, "вспомогат.": true}
	validCurrencies    = map[string]bool{
		calc.CurrencyRUB: true, calc.CurrencyUSD: true,
		calc.CurrencyEUR: true, calc.CurrencyCNY: true,
	}
	validDeliveryTypes = map[string]bool{
		calc.DeliveryInPrice: true, calc.DeliveryNotInPrice: true, calc.DeliveryAmount: true,
	}
)

// boqAuditSnapshot is the PLANNED restore: only allowlisted inputs plus the
// identity fields read for verification. There are deliberately NO fields for
// total_amount / commercial values — they cannot even be represented here.
type boqAuditSnapshot struct {
	// identity — read for verification / DELETE-restore contract only
	ID               *string
	TenderID         *string
	ClientPositionID *string

	// class A — user inputs (nil = restore NULL; see present-tracking below)
	BoqItemType            string // required
	MaterialType           *string
	Description            *string
	UnitCode               *string
	Quantity               *float64
	BaseQuantity           *float64
	ConversionCoefficient  *float64
	UnitRate               *float64
	CurrencyType           *string
	DeliveryPriceType      *string
	DeliveryAmount         *float64
	ConsumptionCoefficient *float64
	DetailCostCategoryID   *string
	MaterialNameID         *string
	WorkNameID             *string
	ParentWorkItemID       *string
	SortNumber             *int
	QuoteLink              *string

	// present[key] — the key existed in the snapshot JSON (even as null). An
	// UPDATE rollback only touches columns that were actually captured; a
	// DELETE restore uses the current model's canonical defaults (DB defaults /
	// NULL) for absent optional keys.
	present map[string]bool
}

// Present reports whether the snapshot JSON contained the given column key.
func (s *boqAuditSnapshot) Present(key string) bool { return s.present[key] }

// ─── parsing helpers (strict JSON types, no coercion) ────────────────────────

var boqAuditUUIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// snapUUID reads a UUID reference. A non-UUID string is InvalidFieldType so it
// can never reach SQL and surface as a cryptic 22P02.
func snapUUID(auditID, itemID, field string, raw json.RawMessage) (*string, error) {
	s, err := snapString(auditID, itemID, field, raw)
	if err != nil || s == nil {
		return nil, err
	}
	if !boqAuditUUIDRe.MatchString(*s) {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: field, Reason: InvalidFieldType}
	}
	return s, nil
}

func snapString(auditID, itemID, field string, raw json.RawMessage) (*string, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var v string
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: field, Reason: InvalidFieldType}
	}
	return &v, nil
}

func snapNumber(auditID, itemID, field string, raw json.RawMessage) (*float64, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	var v float64
	if err := json.Unmarshal(raw, &v); err != nil {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: field, Reason: InvalidFieldType}
	}
	return &v, nil
}

func snapInt(auditID, itemID, field string, raw json.RawMessage) (*int, error) {
	f, err := snapNumber(auditID, itemID, field, raw)
	if err != nil || f == nil {
		return nil, err
	}
	i := int(*f)
	if float64(i) != *f {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: field, Reason: InvalidFieldType}
	}
	return &i, nil
}

func snapEnum(auditID, itemID, field string, raw json.RawMessage, valid map[string]bool) (*string, error) {
	s, err := snapString(auditID, itemID, field, raw)
	if err != nil || s == nil {
		return nil, err
	}
	if !valid[*s] {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: field, Reason: InvalidEnumValue}
	}
	return s, nil
}

// parseBoqAuditSnapshot interprets a boq_items_audit snapshot (old_data) through
// the explicit allowlist. Historical shapes covered: the DB trigger
// log_boq_items_changes writes to_jsonb(OLD.*) — the full row with DB column
// names; the Go writer (insertAudit ← boqRowJSON) marshals BoqItemRow with the
// same snake_case keys. Unknown keys (including any future column) are ignored
// and can never reach SQL. Derived keys are ignored for inputs by construction.
func parseBoqAuditSnapshot(auditID, itemID string, raw []byte) (*boqAuditSnapshot, error) {
	if len(raw) == 0 {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Reason: SnapshotMissing}
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Reason: InvalidFieldType}
	}

	s := &boqAuditSnapshot{present: make(map[string]bool, len(m))}
	for k := range m {
		if boqAuditInputAllowlist[k] || boqAuditIdentityFields[k] {
			s.present[k] = true
		}
	}

	var err error
	get := func(k string) json.RawMessage { return m[k] }

	// identity (verification only — never blindly applied)
	if s.present["id"] {
		if s.ID, err = snapUUID(auditID, itemID, "id", get("id")); err != nil {
			return nil, err
		}
	}
	if s.present["tender_id"] {
		if s.TenderID, err = snapUUID(auditID, itemID, "tender_id", get("tender_id")); err != nil {
			return nil, err
		}
	}
	if s.present["client_position_id"] {
		if s.ClientPositionID, err = snapUUID(auditID, itemID, "client_position_id", get("client_position_id")); err != nil {
			return nil, err
		}
	}

	// required input: boq_item_type
	if !s.present["boq_item_type"] {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: "boq_item_type", Reason: RequiredFieldMissing}
	}
	bt, err := snapEnum(auditID, itemID, "boq_item_type", get("boq_item_type"), validBoqItemTypes)
	if err != nil {
		return nil, err
	}
	if bt == nil {
		return nil, &InvalidBoqAuditSnapshotError{AuditID: auditID, ItemID: itemID, Field: "boq_item_type", Reason: RequiredFieldMissing}
	}
	s.BoqItemType = *bt

	// optional enums — unknown value blocks, absent key stays canonical (NULL)
	if s.present["material_type"] {
		if s.MaterialType, err = snapEnum(auditID, itemID, "material_type", get("material_type"), validMaterialTypes); err != nil {
			return nil, err
		}
	}
	if s.present["currency_type"] {
		if s.CurrencyType, err = snapEnum(auditID, itemID, "currency_type", get("currency_type"), validCurrencies); err != nil {
			return nil, err
		}
	}
	if s.present["delivery_price_type"] {
		if s.DeliveryPriceType, err = snapEnum(auditID, itemID, "delivery_price_type", get("delivery_price_type"), validDeliveryTypes); err != nil {
			return nil, err
		}
	}

	// optional strings
	for field, dst := range map[string]**string{
		"description": &s.Description, "unit_code": &s.UnitCode, "quote_link": &s.QuoteLink,
	} {
		if s.present[field] {
			if *dst, err = snapString(auditID, itemID, field, get(field)); err != nil {
				return nil, err
			}
		}
	}

	// relation references — must be well-formed UUIDs (resolvability is verified
	// against the DB later, inside the transaction)
	for field, dst := range map[string]**string{
		"detail_cost_category_id": &s.DetailCostCategoryID,
		"material_name_id":        &s.MaterialNameID,
		"work_name_id":            &s.WorkNameID,
		"parent_work_item_id":     &s.ParentWorkItemID,
	} {
		if s.present[field] {
			if *dst, err = snapUUID(auditID, itemID, field, get(field)); err != nil {
				return nil, err
			}
		}
	}

	// optional numbers
	for field, dst := range map[string]**float64{
		"quantity": &s.Quantity, "base_quantity": &s.BaseQuantity,
		"conversion_coefficient": &s.ConversionCoefficient, "unit_rate": &s.UnitRate,
		"delivery_amount": &s.DeliveryAmount, "consumption_coefficient": &s.ConsumptionCoefficient,
	} {
		if s.present[field] {
			if *dst, err = snapNumber(auditID, itemID, field, get(field)); err != nil {
				return nil, err
			}
		}
	}

	if s.present["sort_number"] {
		if s.SortNumber, err = snapInt(auditID, itemID, "sort_number", get("sort_number")); err != nil {
			return nil, err
		}
	}

	return s, nil
}
