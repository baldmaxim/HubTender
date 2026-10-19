package repository

import (
	"encoding/json"
	"reflect"
	"testing"
)

// PATCH /tender-registry/{id}/fields: карточка тендера отправляет только
// изменённые поля, очищенное поле — явным null.

func decodeRegistryPatch(t *testing.T, body string) TenderRegistryPatch {
	t.Helper()
	var p TenderRegistryPatch
	if err := json.Unmarshal([]byte(body), &p); err != nil {
		t.Fatalf("unmarshal %s: %v", body, err)
	}
	return p
}

// derefPatchArgs разворачивает указатели в аргументах: nil-указатель → nil (pgx пишет NULL).
func derefPatchArgs(args []any) []any {
	out := make([]any, len(args))
	for i, a := range args {
		v := reflect.ValueOf(a)
		switch {
		case v.Kind() != reflect.Pointer:
			out[i] = a
		case v.IsNil():
			out[i] = nil
		default:
			out[i] = v.Elem().Interface()
		}
	}
	return out
}

func TestTenderRegistryPatchSQLSet(t *testing.T) {
	cases := []struct {
		name     string
		body     string
		wantSet  string
		wantArgs []any
	}{
		{
			name:     "explicit null clears nullable columns",
			body:     `{"object_address":null,"area":null,"submission_date":null,"construction_scope_id":null,"manual_total_cost":null}`,
			wantSet:  "object_address = $1, construction_scope_id = $2, area = $3, submission_date = $4, manual_total_cost = $5",
			wantArgs: []any{nil, nil, nil, nil, nil},
		},
		{
			name:     "absent keys stay untouched",
			body:     `{"title":"ЖК Ода"}`,
			wantSet:  "title = $1",
			wantArgs: []any{"ЖК Ода"},
		},
		{
			name:    "null on NOT NULL columns and lists is ignored",
			body:    `{"title":null,"client_name":null,"is_archived":null,"sort_order":null,"dashboard_status":null,"chronology_items":null}`,
			wantSet: "",
		},
		{
			name:     "values are written",
			body:     `{"tender_number":"330","area":12.5,"commission_date":"2027-01-10T00:00:00Z"}`,
			wantSet:  "tender_number = $1, area = $2, commission_date = $3",
			wantArgs: []any{"330", 12.5, "2027-01-10T00:00:00Z"},
		},
		{
			name:     "status null still means «Направлено»",
			body:     `{"status_id":null,"dashboard_status":"sent","is_archived":false}`,
			wantSet:  "status_id = $1, dashboard_status = $2, is_archived = $3",
			wantArgs: []any{nil, "sent", false},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			set, args := decodeRegistryPatch(t, tc.body).sqlSet()
			if set != tc.wantSet {
				t.Fatalf("set = %q, want %q", set, tc.wantSet)
			}
			if len(tc.wantArgs) == 0 && len(args) == 0 {
				return
			}
			if got := derefPatchArgs(args); !reflect.DeepEqual(got, tc.wantArgs) {
				t.Fatalf("args = %#v, want %#v", got, tc.wantArgs)
			}
		})
	}
}

// Патч, собранный в Go без JSON (present пуст), пишет только непустые поля.
func TestTenderRegistryPatchSQLSetWithoutJSON(t *testing.T) {
	addr := "Москва"
	set, args := TenderRegistryPatch{ObjectAddress: &addr}.sqlSet()
	if set != "object_address = $1" || !reflect.DeepEqual(derefPatchArgs(args), []any{"Москва"}) {
		t.Fatalf("set = %q, args = %#v", set, derefPatchArgs(args))
	}
}
