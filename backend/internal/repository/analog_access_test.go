package repository

import (
	"testing"
	"time"
)

func TestDecideAnalogEditAccess(t *testing.T) {
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	past := now.Add(-48 * time.Hour)
	future := now.Add(48 * time.Hour)
	later := now.Add(24 * time.Hour)
	earlier := now.Add(-96 * time.Hour)
	withPositions := []byte(`["/tenders","/positions"]`)
	noPositions := []byte(`["/tenders","/library"]`)

	tests := []struct {
		name  string
		facts analogAccessFacts
		want  string
	}{
		{"администратор, дедлайн истёк", analogAccessFacts{RoleCode: "administrator", Deadline: &past}, ""},
		{"ведущий инженер, дедлайн истёк", analogAccessFacts{RoleCode: "veduschiy_inzhener", Deadline: &past}, ""},
		{"директор, дедлайн истёк", analogAccessFacts{RoleCode: "director", Deadline: &past}, ""},
		{"разработчик, дедлайн истёк", analogAccessFacts{RoleCode: "developer", Deadline: &past}, ""},
		{"инженер, дедлайн впереди", analogAccessFacts{RoleCode: "engineer", Deadline: &future}, ""},
		{"инженер, дедлайн истёк", analogAccessFacts{RoleCode: "engineer", Deadline: &past}, AnalogCodeDeadlinePassed},
		{"инженер, дедлайн истёк, продление позже now", analogAccessFacts{RoleCode: "engineer", Deadline: &past, Extension: &later}, ""},
		{"инженер, дедлайн истёк, продление тоже истекло", analogAccessFacts{RoleCode: "engineer", Deadline: &past, Extension: &earlier}, AnalogCodeDeadlinePassed},
		{"инженер, продление раньше дедлайна, дедлайн истёк", analogAccessFacts{RoleCode: "engineer", Deadline: &past, Extension: &earlier}, AnalogCodeDeadlinePassed},
		{"инженер, продление раньше дедлайна, дедлайн впереди", analogAccessFacts{RoleCode: "engineer", Deadline: &future, Extension: &later}, ""},
		{"инженер, продление есть, дедлайна нет", analogAccessFacts{RoleCode: "engineer", Extension: &earlier}, ""},
		{"инженер, дедлайн NULL", analogAccessFacts{RoleCode: "engineer"}, ""},
		{"ровно в момент дедлайна", analogAccessFacts{RoleCode: "engineer", Deadline: &now}, ""},
		{"страницы без /positions", analogAccessFacts{RoleCode: "engineer", AllowedPagesJSON: noPositions, Deadline: &future}, AnalogCodeForbidden},
		{"страницы без /positions, администратор", analogAccessFacts{RoleCode: "administrator", AllowedPagesJSON: noPositions}, ""},
		{"страницы без /positions, ведущий инженер", analogAccessFacts{RoleCode: "veduschiy_inzhener", AllowedPagesJSON: noPositions}, AnalogCodeForbidden},
		{"страницы без /positions и дедлайн истёк", analogAccessFacts{RoleCode: "engineer", AllowedPagesJSON: noPositions, Deadline: &past}, AnalogCodeForbidden},
		{"страницы с /positions", analogAccessFacts{RoleCode: "engineer", AllowedPagesJSON: withPositions, Deadline: &future}, ""},
		{"пустой список страниц", analogAccessFacts{RoleCode: "engineer", AllowedPagesJSON: []byte(`[]`), Deadline: &future}, ""},
		{"страницы не заданы (NULL)", analogAccessFacts{RoleCode: "engineer", Deadline: &future}, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			f := tc.facts
			f.Now = now
			if got := decideAnalogEditAccess(f); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestParseAnalogExtension(t *testing.T) {
	good := ptrS("2026-10-30T12:00:00.000Z")
	if got := parseAnalogExtension(good); got == nil || !got.Equal(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("ISO с миллисекундами: %v", got)
	}
	for _, raw := range []*string{nil, ptrS(""), ptrS("не дата")} {
		if got := parseAnalogExtension(raw); got != nil {
			t.Fatalf("%v: ожидался nil, получено %v", raw, got)
		}
	}
}
