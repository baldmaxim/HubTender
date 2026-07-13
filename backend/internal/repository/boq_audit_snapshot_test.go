package repository

import (
	"errors"
	"fmt"
	"testing"
)

// Stage 0.1.2.2b unit tests: the audit-rollback snapshot parser restores ONLY
// explicitly allowlisted user inputs. Derived money, identity and unknown keys
// can never become planned inputs, and malformed/legacy shapes fail closed with
// typed errors that survive %w wrapping.

const (
	tstAuditID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	tstItemID  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
)

// fullTriggerSnapshot mimics to_jsonb(OLD.*) written by log_boq_items_changes —
// the real production shape: every column present, DB snake_case names, numbers
// as JSON numbers. Derived values are deliberately corrupted.
func fullTriggerSnapshot() string {
	return `{
		"id": "` + tstItemID + `",
		"tender_id": "cccccccc-cccc-cccc-cccc-cccccccccccc",
		"client_position_id": "dddddddd-dddd-dddd-dddd-dddddddddddd",
		"sort_number": 3,
		"boq_item_type": "мат",
		"material_type": "основн.",
		"material_name_id": null,
		"work_name_id": null,
		"unit_code": "м2",
		"quantity": 10,
		"base_quantity": null,
		"consumption_coefficient": 1.2,
		"conversion_coefficient": null,
		"delivery_price_type": "в цене",
		"delivery_amount": 0,
		"currency_type": "USD",
		"total_amount": 999999,
		"detail_cost_category_id": null,
		"quote_link": null,
		"commercial_markup": 777,
		"total_commercial_material_cost": 888888,
		"total_commercial_work_cost": 999999,
		"created_at": "2026-01-01T00:00:00+00:00",
		"updated_at": "2026-01-02T00:00:00+00:00",
		"parent_work_item_id": null,
		"description": "истор. описание",
		"unit_rate": 100,
		"import_session_id": null
	}`
}

// ─── §13.1–5: allowlist contents ─────────────────────────────────────────────

func TestBoqAuditAllowlist_ContainsOnlyUserInputs(t *testing.T) {
	for _, want := range []string{
		"boq_item_type", "material_type", "description", "unit_code",
		"quantity", "base_quantity", "conversion_coefficient", "unit_rate",
		"currency_type", "delivery_price_type", "delivery_amount",
		"consumption_coefficient", "detail_cost_category_id",
		"material_name_id", "work_name_id", "parent_work_item_id",
		"sort_number", "quote_link",
	} {
		if !boqAuditInputAllowlist[want] {
			t.Errorf("allowlist must contain user input %q", want)
		}
	}
	// §13.2–5: derived money must NOT be restorable.
	for _, forbidden := range []string{
		"total_amount", "commercial_markup",
		"total_commercial_material_cost", "total_commercial_work_cost",
	} {
		if boqAuditInputAllowlist[forbidden] {
			t.Errorf("allowlist must NOT contain derived column %q", forbidden)
		}
		if !boqAuditDerivedFields[forbidden] {
			t.Errorf("derived-field set must classify %q", forbidden)
		}
	}
	// §13.6: identity/system fields are not inputs.
	for _, forbidden := range []string{"id", "tender_id", "client_position_id", "created_at", "updated_at", "import_session_id"} {
		if boqAuditInputAllowlist[forbidden] {
			t.Errorf("allowlist must NOT contain identity field %q", forbidden)
		}
		if !boqAuditIdentityFields[forbidden] {
			t.Errorf("identity-field set must classify %q", forbidden)
		}
	}
}

// ─── §13.13 / §14 A: corrupted derived values never reach the planned inputs ─

func TestParseSnapshot_DerivedValuesIgnored(t *testing.T) {
	s, err := parseBoqAuditSnapshot(tstAuditID, tstItemID, []byte(fullTriggerSnapshot()))
	if err != nil {
		t.Fatalf("parse full trigger snapshot: %v", err)
	}
	// Planned inputs come from the snapshot…
	if s.Quantity == nil || *s.Quantity != 10 {
		t.Fatalf("quantity = %v, want 10", s.Quantity)
	}
	if s.UnitRate == nil || *s.UnitRate != 100 {
		t.Fatalf("unit_rate = %v, want 100", s.UnitRate)
	}
	if s.BoqItemType != "мат" || s.CurrencyType == nil || *s.CurrencyType != "USD" {
		t.Fatalf("item type/currency wrong: %q %v", s.BoqItemType, s.CurrencyType)
	}
	// …while the derived keys are not even representable in the plan: the
	// snapshot struct has no total_amount/commercial fields, and Present() must
	// not track them.
	for _, k := range []string{"total_amount", "commercial_markup",
		"total_commercial_material_cost", "total_commercial_work_cost"} {
		if s.Present(k) {
			t.Errorf("derived key %q must not be tracked as restorable", k)
		}
	}
}

// ─── §13.7: unknown JSON keys never become SQL fields ────────────────────────

func TestParseSnapshot_UnknownKeysIgnored(t *testing.T) {
	raw := `{"boq_item_type":"раб","quantity":1,"evil_new_column":42,"cached_grand_total":100}`
	s, err := parseBoqAuditSnapshot(tstAuditID, tstItemID, []byte(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if s.Present("evil_new_column") || s.Present("cached_grand_total") {
		t.Fatal("unknown keys must never be tracked as restorable columns")
	}
}

// ─── §13.8–10, 12: malformed shapes fail closed with typed errors ────────────

func TestParseSnapshot_Rejections(t *testing.T) {
	cases := []struct {
		name   string
		raw    string
		field  string
		reason BoqAuditSnapshotReason
	}{
		{"quantity as string", `{"boq_item_type":"мат","quantity":"10"}`, "quantity", InvalidFieldType},
		{"unknown currency", `{"boq_item_type":"мат","currency_type":"KZT"}`, "currency_type", InvalidEnumValue},
		{"unknown boq_item_type", `{"boq_item_type":"чужой-тип"}`, "boq_item_type", InvalidEnumValue},
		{"missing boq_item_type", `{"quantity":5}`, "boq_item_type", RequiredFieldMissing},
		{"null boq_item_type", `{"boq_item_type":null}`, "boq_item_type", RequiredFieldMissing},
		{"unknown material_type", `{"boq_item_type":"мат","material_type":"другой"}`, "material_type", InvalidEnumValue},
		{"unknown delivery type", `{"boq_item_type":"мат","delivery_price_type":"бесплатно"}`, "delivery_price_type", InvalidEnumValue},
		{"non-uuid parent", `{"boq_item_type":"мат","parent_work_item_id":"not-a-uuid"}`, "parent_work_item_id", InvalidFieldType},
		{"non-uuid relation", `{"boq_item_type":"мат","detail_cost_category_id":"42"}`, "detail_cost_category_id", InvalidFieldType},
		{"fractional sort_number", `{"boq_item_type":"мат","sort_number":1.5}`, "sort_number", InvalidFieldType},
		{"snapshot not an object", `[1,2,3]`, "", InvalidFieldType},
		{"empty snapshot", ``, "", SnapshotMissing},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := parseBoqAuditSnapshot(tstAuditID, tstItemID, []byte(tc.raw))
			var snapErr *InvalidBoqAuditSnapshotError
			if !errors.As(err, &snapErr) {
				t.Fatalf("want InvalidBoqAuditSnapshotError, got %v", err)
			}
			if snapErr.Reason != tc.reason {
				t.Fatalf("reason = %s, want %s", snapErr.Reason, tc.reason)
			}
			if tc.field != "" && snapErr.Field != tc.field {
				t.Fatalf("field = %q, want %q", snapErr.Field, tc.field)
			}
			if snapErr.AuditID != tstAuditID {
				t.Fatalf("audit id not propagated: %q", snapErr.AuditID)
			}
		})
	}
}

// ─── §13.11: legacy optional field gets the canonical default ────────────────

func TestParseSnapshot_LegacyShapeOptionalDefaults(t *testing.T) {
	// A hypothetical legacy/partial shape: only the fields that existed. Absent
	// optional keys must stay untracked (⇒ UPDATE rollback keeps the current
	// value; DELETE restore uses the DB's canonical defaults / NULL). They must
	// NOT be coerced to zero or a guessed enum.
	raw := `{"boq_item_type":"раб","quantity":5,"unit_rate":100}`
	s, err := parseBoqAuditSnapshot(tstAuditID, tstItemID, []byte(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	for _, k := range []string{"currency_type", "delivery_price_type", "consumption_coefficient", "sort_number"} {
		if s.Present(k) {
			t.Errorf("absent optional key %q must not be marked present", k)
		}
	}
	if s.CurrencyType != nil {
		t.Fatal("absent currency must stay nil (canonical default), not be invented")
	}
	if s.Quantity == nil || *s.Quantity != 5 {
		t.Fatalf("quantity = %v, want 5", s.Quantity)
	}
}

// present-with-null ≠ absent: an explicit null restores NULL.
func TestParseSnapshot_ExplicitNullTracked(t *testing.T) {
	raw := `{"boq_item_type":"мат","consumption_coefficient":null}`
	s, err := parseBoqAuditSnapshot(tstAuditID, tstItemID, []byte(raw))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !s.Present("consumption_coefficient") {
		t.Fatal("explicit null must be tracked as present (restore NULL)")
	}
	if s.ConsumptionCoefficient != nil {
		t.Fatal("explicit null must parse to nil value")
	}
}

// ─── §13.15: errors.As works through %w chains ───────────────────────────────

func TestBoqAuditErrors_SurviveWrapping(t *testing.T) {
	snap := &InvalidBoqAuditSnapshotError{AuditID: tstAuditID, ItemID: tstItemID, Field: "quantity", Reason: InvalidFieldType}
	mismatch := &BoqAuditTargetMismatchError{AuditID: tstAuditID, ExpectedItemID: "a", ActualItemID: "b"}
	unsup := &UnsupportedBoqAuditRollbackError{AuditID: tstAuditID, Operation: "INSERT"}

	wrap := func(e error) error {
		return fmt.Errorf("boqAuditRollbackService.Rollback: %w",
			fmt.Errorf("boqAuditRollbackRepo: %w", e))
	}

	var gotSnap *InvalidBoqAuditSnapshotError
	if !errors.As(wrap(snap), &gotSnap) || gotSnap.Reason != InvalidFieldType {
		t.Fatal("InvalidBoqAuditSnapshotError lost through %w chain")
	}
	var gotTM *BoqAuditTargetMismatchError
	if !errors.As(wrap(mismatch), &gotTM) || gotTM.ExpectedItemID != "a" {
		t.Fatal("BoqAuditTargetMismatchError lost through %w chain")
	}
	var gotUn *UnsupportedBoqAuditRollbackError
	if !errors.As(wrap(unsup), &gotUn) || gotUn.Operation != "INSERT" {
		t.Fatal("UnsupportedBoqAuditRollbackError lost through %w chain")
	}
}

// Codes are the stable API identifiers.
func TestBoqAuditErrors_Codes(t *testing.T) {
	if c := (&InvalidBoqAuditSnapshotError{}).Code(); c != "INVALID_BOQ_AUDIT_SNAPSHOT" {
		t.Fatalf("code = %s", c)
	}
	if c := (&BoqAuditTargetMismatchError{}).Code(); c != "BOQ_AUDIT_TARGET_MISMATCH" {
		t.Fatalf("code = %s", c)
	}
	if c := (&UnsupportedBoqAuditRollbackError{}).Code(); c != "UNSUPPORTED_BOQ_AUDIT_ROLLBACK" {
		t.Fatalf("code = %s", c)
	}
}
