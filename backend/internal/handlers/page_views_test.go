package handlers

import (
	"strings"
	"testing"
)

func TestValidatePageViewPath(t *testing.T) {
	tests := []struct {
		name    string
		page    string
		wantErr bool
	}{
		{"root", "/", false},
		{"template", "/analytics/quality", false},
		{"param template", "/positions/:id", false},
		{"empty", "", true},
		{"no leading slash", "analytics/quality", true},
		{"query", "/positions?tenderId=1", true},
		{"fragment", "/positions#top", true},
		{"max length", "/" + strings.Repeat("a", 199), false},
		{"too long", "/" + strings.Repeat("a", 200), true},
		{"cyrillic max length", "/" + strings.Repeat("ж", 199), false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePageViewPath(tc.page)
			if (err != nil) != tc.wantErr {
				t.Fatalf("page %q: wantErr=%v, got %v", tc.page, tc.wantErr, err)
			}
		})
	}
}

func TestParsePageStatsDays(t *testing.T) {
	tests := []struct {
		raw     string
		want    int
		wantErr bool
	}{
		{"", 30, false},
		{"1", 1, false},
		{"90", 90, false},
		{"180", 180, false},
		{"0", 0, true},
		{"181", 0, true},
		{"-5", 0, true},
		{"abc", 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.raw, func(t *testing.T) {
			got, err := parsePageStatsDays(tc.raw)
			if (err != nil) != tc.wantErr || got != tc.want {
				t.Fatalf("raw %q: got (%d, %v), want (%d, err=%v)", tc.raw, got, err, tc.want, tc.wantErr)
			}
		})
	}
}
