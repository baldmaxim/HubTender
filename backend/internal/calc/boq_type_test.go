package calc

import "testing"

// IsWorkBoqType / IsMaterialBoqType are the CANONICAL BOQ-type predicates. The
// template-insert parent validation (repository) relies on them, so their exact
// membership is pinned here.
func TestIsWorkBoqType(t *testing.T) {
	tests := []struct {
		itemType string
		want     bool
	}{
		// all work types → true
		{BoqRab, true},     // раб
		{BoqSubRab, true},  // суб-раб
		{BoqRabKomp, true}, // раб-комп.

		// material types → false
		{BoqMat, false},     // мат
		{BoqSubMat, false},  // суб-мат
		{BoqMatKomp, false}, // мат-комп.

		// empty / unknown → false
		{"", false},
		{"работа", false},
		{"unknown", false},
		{"РАБ", false}, // case-sensitive by design
	}
	for _, tt := range tests {
		if got := IsWorkBoqType(tt.itemType); got != tt.want {
			t.Errorf("IsWorkBoqType(%q) = %v, want %v", tt.itemType, got, tt.want)
		}
	}
}

func TestIsMaterialBoqType(t *testing.T) {
	tests := []struct {
		itemType string
		want     bool
	}{
		{BoqMat, true},
		{BoqSubMat, true},
		{BoqMatKomp, true},

		{BoqRab, false},
		{BoqSubRab, false},
		{BoqRabKomp, false},

		{"", false},
		{"материал", false},
		{"unknown", false},
	}
	for _, tt := range tests {
		if got := IsMaterialBoqType(tt.itemType); got != tt.want {
			t.Errorf("IsMaterialBoqType(%q) = %v, want %v", tt.itemType, got, tt.want)
		}
	}
}
