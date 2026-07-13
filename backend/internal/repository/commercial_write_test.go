package repository

import (
	"errors"
	"math"
	"reflect"
	"testing"
)

func row(id string, markup, mat, work float64) CalculatedCommercialCostRow {
	return CalculatedCommercialCostRow{
		ID:                          id,
		CommercialMarkup:            markup,
		TotalCommercialMaterialCost: mat,
		TotalCommercialWorkCost:     work,
	}
}

// 1. A valid calculated result passes validation.
func TestValidateCalculatedCommercialRows_Valid(t *testing.T) {
	rows := []CalculatedCommercialCostRow{
		row("11111111-1111-1111-1111-111111111111", 1.15, 100, 200),
		row("22222222-2222-2222-2222-222222222222", 0, 0, 0), // zeros are legal
		row("33333333-3333-3333-3333-333333333333", 12345.678, 1e12, 9e9),
	}
	if err := validateCalculatedCommercialRows(rows); err != nil {
		t.Fatalf("valid rows rejected: %v", err)
	}
}

// 2/3/4/5/6. NaN, ±Inf and negatives are rejected in EVERY money field.
func TestValidateCalculatedCommercialRows_InvalidNumbers(t *testing.T) {
	fields := []string{"commercial_markup", "total_commercial_material_cost", "total_commercial_work_cost"}
	bad := map[string]float64{
		"NaN":  math.NaN(),
		"+Inf": math.Inf(1),
		"-Inf": math.Inf(-1),
		"neg":  -0.01,
	}

	for _, field := range fields {
		for label, v := range bad {
			t.Run(field+"/"+label, func(t *testing.T) {
				r := row("11111111-1111-1111-1111-111111111111", 1, 1, 1)
				switch field {
				case "commercial_markup":
					r.CommercialMarkup = v
				case "total_commercial_material_cost":
					r.TotalCommercialMaterialCost = v
				case "total_commercial_work_cost":
					r.TotalCommercialWorkCost = v
				}

				err := validateCalculatedCommercialRows([]CalculatedCommercialCostRow{r})
				var ie *InvalidCommercialCalculationResultError
				if !errors.As(err, &ie) {
					t.Fatalf("expected InvalidCommercialCalculationResultError, got %v", err)
				}
				if ie.Field != field {
					t.Fatalf("Field = %q, want %q", ie.Field, field)
				}
				if ie.Code() != "INVALID_COMMERCIAL_CALCULATION_RESULT" {
					t.Fatalf("Code() = %q", ie.Code())
				}
			})
		}
	}
}

// No arbitrary upper bound is imposed — a huge but finite value is fine.
func TestValidateCalculatedCommercialRows_NoUpperBound(t *testing.T) {
	r := row("11111111-1111-1111-1111-111111111111", math.MaxFloat64/4, math.MaxFloat64/4, math.MaxFloat64/4)
	if err := validateCalculatedCommercialRows([]CalculatedCommercialCostRow{r}); err != nil {
		t.Fatalf("finite huge values must be accepted, got %v", err)
	}
}

// 7. Duplicate item ID is rejected.
func TestValidateCalculatedCommercialRows_DuplicateID(t *testing.T) {
	id := "11111111-1111-1111-1111-111111111111"
	err := validateCalculatedCommercialRows([]CalculatedCommercialCostRow{
		row(id, 1, 1, 1),
		row(id, 2, 2, 2),
	})
	var ie *InvalidCommercialCalculationResultError
	if !errors.As(err, &ie) {
		t.Fatalf("expected InvalidCommercialCalculationResultError, got %v", err)
	}
	if ie.Field != "id" || ie.ItemID != id {
		t.Fatalf("unexpected payload: %+v", ie)
	}
}

// 8. Empty item ID is rejected.
func TestValidateCalculatedCommercialRows_EmptyID(t *testing.T) {
	err := validateCalculatedCommercialRows([]CalculatedCommercialCostRow{row("", 1, 1, 1)})
	var ie *InvalidCommercialCalculationResultError
	if !errors.As(err, &ie) {
		t.Fatalf("expected InvalidCommercialCalculationResultError, got %v", err)
	}
	if ie.Field != "id" {
		t.Fatalf("Field = %q, want id", ie.Field)
	}
}

// 9. An empty result set validates trivially (the writer treats it as a no-op).
func TestValidateCalculatedCommercialRows_EmptySet(t *testing.T) {
	if err := validateCalculatedCommercialRows(nil); err != nil {
		t.Fatalf("empty set must validate (no-op), got %v", err)
	}
	if err := validateCalculatedCommercialRows([]CalculatedCommercialCostRow{}); err != nil {
		t.Fatalf("empty set must validate (no-op), got %v", err)
	}
}

// 10. The internal result struct is NOT a JSON/validator DTO: it must carry no
// json or validate tags, so it can never be bound from an HTTP request body.
func TestCalculatedCommercialCostRow_IsNotAClientDTO(t *testing.T) {
	typ := reflect.TypeOf(CalculatedCommercialCostRow{})
	for i := 0; i < typ.NumField(); i++ {
		f := typ.Field(i)
		if tag, ok := f.Tag.Lookup("json"); ok {
			t.Errorf("field %s has a json tag (%q) — this is a server-generated "+
				"calculation result and must never be an HTTP DTO", f.Name, tag)
		}
		if tag, ok := f.Tag.Lookup("validate"); ok {
			t.Errorf("field %s has a validate tag (%q) — client validation tags "+
				"do not belong on a server-generated result", f.Name, tag)
		}
	}
}

// The mismatch error carries the tender + expected/updated counts.
func TestCommercialResultSetMismatchError_Payload(t *testing.T) {
	e := &CommercialResultSetMismatchError{TenderID: "t1", Expected: 3, Updated: 2}
	if e.Code() != "COMMERCIAL_RESULT_SET_MISMATCH" {
		t.Fatalf("Code() = %q", e.Code())
	}
	var target *CommercialResultSetMismatchError
	if !errors.As(error(e), &target) || target.Expected != 3 || target.Updated != 2 {
		t.Fatalf("errors.As lost the payload: %+v", target)
	}
}
