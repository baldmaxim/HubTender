package handlers

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0.1.2.4a: an invalid user insurance configuration is a typed RFC 7807
// 400 (INVALID_INSURANCE_CONFIGURATION), never a generic 500. The synchronous
// grand-total recalc failure path stays fail-closed inside the repo tx.

type stubInsuranceSvc struct {
	err error
	row *repository.InsuranceRow
}

func (s *stubInsuranceSvc) Get(context.Context, string) (*repository.InsuranceRow, error) {
	return s.row, nil
}

func (s *stubInsuranceSvc) Upsert(context.Context, string, repository.InsuranceRow) (*repository.InsuranceRow, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.row, nil
}

func TestInsurancePut_InvalidConfiguration400(t *testing.T) {
	svc := &stubInsuranceSvc{err: fmt.Errorf("insuranceService.Upsert: %w",
		fmt.Errorf("insuranceRepo.Upsert: %w", &calc.InvalidInsuranceConfigurationError{
			Field: "judicial_pct", Reason: "percentage out of range [0,100]",
		}))}
	h := NewInsuranceHandler(svc)

	r := chi.NewRouter()
	r.Put("/api/v1/tenders/{id}/insurance", h.Put)
	req := httptest.NewRequest("PUT",
		"/api/v1/tenders/11111111-1111-1111-1111-111111111111/insurance",
		strings.NewReader(`{"judicial_pct":150,"total_pct":100,"apt_price_m2":10,"apt_area":10}`))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
	m := decodeProblem(t, w)
	if m["code"] != "INVALID_INSURANCE_CONFIGURATION" || m["field"] != "judicial_pct" {
		t.Fatalf("code/field = %v/%v", m["code"], m["field"])
	}
}
