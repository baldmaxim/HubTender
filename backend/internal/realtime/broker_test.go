package realtime

import (
	"testing"

	"github.com/rs/zerolog"
)

func TestTopicsFor(t *testing.T) {
	b := NewBroker(NewHub(zerolog.Nop()), 0, zerolog.Nop())

	tests := []struct {
		name string
		ev   Event
		want []string
	}{
		{"notifications with user", Event{Table: "notifications", UserID: "u1", ID: "n1"}, []string{"notifications:u1"}},
		{"notifications without user", Event{Table: "notifications", ID: "n1"}, nil},
		{"tenders", Event{Table: "tenders", ID: "t1"}, []string{"tenders", "tender:t1"}},

		// Global / reference tables → dedicated topics, regardless of tender_id.
		{"user_tasks", Event{Table: "user_tasks", ID: "x"}, []string{"tasks"}},
		{"users", Event{Table: "users", ID: "x"}, []string{"users", "user:x"}},
		{"users without id", Event{Table: "users"}, []string{"users"}},
		{"materials_library", Event{Table: "materials_library"}, []string{"references"}},
		{"works_library", Event{Table: "works_library"}, []string{"references"}},
		{"material_names", Event{Table: "material_names"}, []string{"references"}},
		{"work_names", Event{Table: "work_names"}, []string{"references"}},
		{"units", Event{Table: "units"}, []string{"references"}},
		{"templates", Event{Table: "templates"}, []string{"templates"}},
		{"template_items", Event{Table: "template_items"}, []string{"templates"}},
		{"markup_tactics", Event{Table: "markup_tactics"}, []string{"markup"}},
		{"markup_parameters", Event{Table: "markup_parameters"}, []string{"markup"}},
		{"import_sessions", Event{Table: "import_sessions"}, []string{"imports"}},
		{"projects", Event{Table: "projects"}, []string{"projects"}},
		{"project_additional_agreements", Event{Table: "project_additional_agreements"}, []string{"projects"}},
		{"project_monthly_completion", Event{Table: "project_monthly_completion"}, []string{"projects"}},
		{"tender_registry", Event{Table: "tender_registry"}, []string{"tenders"}},

		// Tender-scoped config tables fall through to the generic branch.
		{"tender_markup_percentage", Event{Table: "tender_markup_percentage", TenderID: "t9"}, []string{"tender:t9"}},
		{"tender_pricing_distribution", Event{Table: "tender_pricing_distribution", TenderID: "t9"}, []string{"tender:t9"}},
		{"tender_insurance", Event{Table: "tender_insurance", TenderID: "t9"}, []string{"tender:t9"}},
		{"boq_items with tender_id", Event{Table: "boq_items", TenderID: "t9"}, []string{"tender:t9"}},
		{"unknown without tender_id", Event{Table: "boq_items"}, nil},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := b.topicsFor(tt.ev)
			if !equalStrings(got, tt.want) {
				t.Errorf("topicsFor(%+v) = %v, want %v", tt.ev, got, tt.want)
			}
		})
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
