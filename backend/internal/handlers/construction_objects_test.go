package handlers

import (
	"strings"
	"testing"
)

func fptr(v float64) *float64 { return &v }
func sptr(v string) *string   { return &v }

func validConstructionObjectReq() constructionObjectReq {
	return constructionObjectReq{
		Name:      "  Школа на 825 мест  ",
		Area:      fptr(19592.2),
		Address:   " Москва, ул. Михневская, д. 8 ",
		Latitude:  fptr(55.577515),
		Longitude: fptr(37.671546),
		Status:    "archive",
	}
}

func TestValidateConstructionObjectInput(t *testing.T) {
	const uuid = "0b4c9b1e-5c1a-4b52-9d36-2f1a8e0c7a11"
	tests := []struct {
		name    string
		mutate  func(r *constructionObjectReq)
		wantErr string // подстрока ошибки; "" — без ошибки
	}{
		{"valid", func(r *constructionObjectReq) {}, ""},
		{"empty name", func(r *constructionObjectReq) { r.Name = "   " }, "name"},
		{"empty address", func(r *constructionObjectReq) { r.Address = "" }, "address"},
		{"bad status", func(r *constructionObjectReq) { r.Status = "done" }, "status"},
		{"empty status", func(r *constructionObjectReq) { r.Status = "" }, "status"},
		{"current status", func(r *constructionObjectReq) { r.Status = "current" }, ""},
		{"nil area", func(r *constructionObjectReq) { r.Area = nil }, ""},
		{"zero area", func(r *constructionObjectReq) { r.Area = fptr(0) }, ""},
		{"negative area", func(r *constructionObjectReq) { r.Area = fptr(-1) }, "area"},
		{"no coords", func(r *constructionObjectReq) { r.Latitude, r.Longitude = nil, nil }, ""},
		{"only latitude", func(r *constructionObjectReq) { r.Longitude = nil }, "together"},
		{"only longitude", func(r *constructionObjectReq) { r.Latitude = nil }, "together"},
		{"latitude too big", func(r *constructionObjectReq) { r.Latitude = fptr(90.5) }, "latitude"},
		{"latitude too small", func(r *constructionObjectReq) { r.Latitude = fptr(-91) }, "latitude"},
		{"longitude too big", func(r *constructionObjectReq) { r.Longitude = fptr(180.1) }, "longitude"},
		{"longitude too small", func(r *constructionObjectReq) { r.Longitude = fptr(-181) }, "longitude"},
		{"border coords", func(r *constructionObjectReq) { r.Latitude, r.Longitude = fptr(-90), fptr(180) }, ""},
		{"valid project", func(r *constructionObjectReq) { r.ProjectID = sptr(uuid) }, ""},
		{"bad project", func(r *constructionObjectReq) { r.ProjectID = sptr("123") }, "project_id"},
		{"empty project", func(r *constructionObjectReq) { r.ProjectID = sptr("") }, "project_id"},
		{"valid date", func(r *constructionObjectReq) { r.CommissioningDate = sptr("2024-02-29") }, ""},
		{"bad date format", func(r *constructionObjectReq) { r.CommissioningDate = sptr("29.02.2024") }, "commissioning_date"},
		{"impossible date", func(r *constructionObjectReq) { r.CommissioningDate = sptr("2023-02-29") }, "commissioning_date"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := validConstructionObjectReq()
			tc.mutate(&req)
			_, err := validateConstructionObjectInput(req)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("want error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}

func TestValidateConstructionObjectInput_Trims(t *testing.T) {
	in, err := validateConstructionObjectInput(validConstructionObjectReq())
	if err != nil {
		t.Fatal(err)
	}
	if in.Name != "Школа на 825 мест" || in.Address != "Москва, ул. Михневская, д. 8" {
		t.Fatalf("not trimmed: %q / %q", in.Name, in.Address)
	}
}
