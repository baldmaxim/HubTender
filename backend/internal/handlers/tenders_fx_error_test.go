package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

// Stage 0-F1 §H: a fail-closed rate change (the new rates make an existing BOQ
// row uncalculable) must surface as RFC 7807 400 MISSING_FX_RATE on BOTH the
// regular PATCH and the admin patch — never a generic 500 and never a success.

type stubTenderWriteSvc struct {
	current   *repository.TenderRow
	updateErr error
	adminErr  error
}

func (s *stubTenderWriteSvc) ListTenders(context.Context, string, repository.TenderListParams) ([]repository.TenderRow, error) {
	panic("not used")
}
func (s *stubTenderWriteSvc) GetTenderOverview(context.Context, string) (*repository.TenderOverviewRow, error) {
	panic("not used")
}
func (s *stubTenderWriteSvc) GetTenderByID(context.Context, string) (*repository.TenderRow, error) {
	return s.current, nil
}
func (s *stubTenderWriteSvc) CreateTender(context.Context, repository.CreateTenderInput) (*repository.TenderRow, error) {
	panic("not used")
}
func (s *stubTenderWriteSvc) UpdateTender(context.Context, string, repository.UpdateTenderInput) (*repository.TenderRow, error) {
	return nil, s.updateErr
}
func (s *stubTenderWriteSvc) AdminPatchTender(context.Context, string, repository.AdminTenderPatch) error {
	return s.adminErr
}
func (s *stubTenderWriteSvc) DeleteTender(context.Context, string) error { panic("not used") }
func (s *stubTenderWriteSvc) ApproveFinancial(context.Context, string, string) error {
	panic("not used")
}

func authedTenderReq(t *testing.T, method, target, body string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, target, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	ctx := context.WithValue(r.Context(), middleware.CtxUser, &middleware.AuthUser{ID: "11111111-1111-1111-1111-111111111111"})
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", "22222222-2222-2222-2222-222222222222")
	ctx = context.WithValue(ctx, chi.RouteCtxKey, rctx)
	return r.WithContext(ctx)
}

func TestUpdateTender_MissingFXRateIs400(t *testing.T) {
	wrapped := fmt.Errorf("tenderService.UpdateTender: %w",
		fmt.Errorf("tenderRepo.UpdateTender: %w",
			fmt.Errorf("repriceTenderAfterRateChangeTx: %w", &calc.MissingFXRateError{Currency: "USD"})))
	svc := &stubTenderWriteSvc{
		current:   &repository.TenderRow{ID: "22222222-2222-2222-2222-222222222222", UpdatedAt: time.Unix(1700000000, 0)},
		updateErr: wrapped,
	}
	h := NewTenderWriteHandler(svc)

	r := authedTenderReq(t, http.MethodPatch, "/api/v1/tenders/22222222-2222-2222-2222-222222222222",
		`{"usd_rate": 95.5}`)
	r.Header.Set("If-Match", "*")
	w := httptest.NewRecorder()
	h.UpdateTender(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400\n%s", w.Code, w.Body.String())
	}
	m := decodeProblem(t, w)
	if m["code"] != "MISSING_FX_RATE" || m["currency"] != "USD" {
		t.Fatalf("problem = %v, want MISSING_FX_RATE/USD", m)
	}
}

func TestAdminPatchTender_MissingFXRateIs400(t *testing.T) {
	wrapped := fmt.Errorf("tenderService.AdminPatchTender: %w",
		fmt.Errorf("tenderRepo.AdminPatchTender: %w", &calc.MissingFXRateError{Currency: "EUR"}))
	svc := &stubTenderWriteSvc{adminErr: wrapped}
	h := NewTenderWriteHandler(svc)

	r := authedTenderReq(t, http.MethodPatch, "/api/v1/tenders/22222222-2222-2222-2222-222222222222/admin-fields",
		`{"eur_rate": 0}`)
	w := httptest.NewRecorder()
	h.AdminPatchTender(w, r)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (same fail-closed semantics as the regular PATCH)\n%s",
			w.Code, w.Body.String())
	}
	m := decodeProblem(t, w)
	if m["code"] != "MISSING_FX_RATE" || m["currency"] != "EUR" {
		t.Fatalf("problem = %v, want MISSING_FX_RATE/EUR", m)
	}
}

// ─── Import mismatch report serialization ────────────────────────────────────

type stubImportSvc struct {
	res *repository.ImportResult
	err error
}

func (s *stubImportSvc) BulkImport(context.Context, repository.ImportInput) (*repository.ImportResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.res, nil
}

// G.8 — a missing FX rate during the server-side recompute is a 400
// MISSING_FX_RATE (the import already rolled back), never a generic 500.
func TestImportBoq_MissingFXRateIs400(t *testing.T) {
	svc := &stubImportSvc{err: fmt.Errorf("importBoqService.BulkImport: %w",
		fmt.Errorf("importRepo.BulkImport: recompute totals: %w", &calc.MissingFXRateError{Currency: "USD"}))}
	h := NewImportBoqHandler(svc)
	r := authedTenderReq(t, http.MethodPost, "/api/v1/imports/boq",
		`{"tender_id":"22222222-2222-2222-2222-222222222222","file_name":"boq.xlsx","items":[]}`)
	w := httptest.NewRecorder()
	h.BulkImport(w, r)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400\n%s", w.Code, w.Body.String())
	}
	m := decodeProblem(t, w)
	if m["code"] != "MISSING_FX_RATE" {
		t.Fatalf("problem = %v", m)
	}
}

func TestImportBoq_MismatchReportSerialized(t *testing.T) {
	svc := &stubImportSvc{res: &repository.ImportResult{
		InsertedItemsCount: 2,
		TotalMismatchCount: 1,
		TotalMismatches: []repository.ImportTotalMismatch{{
			RowNumber: 5, ItemName: "бетон",
			ClientTotalAmount: 1, ServerTotalAmount: 50000,
			AbsoluteDifference: 49999, RelativeDifferencePercent: 99.998,
		}},
	}}
	h := NewImportBoqHandler(svc)

	r := authedTenderReq(t, http.MethodPost, "/api/v1/imports/boq",
		`{"tender_id":"22222222-2222-2222-2222-222222222222","file_name":"boq.xlsx","items":[]}`)
	w := httptest.NewRecorder()
	h.BulkImport(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d\n%s", w.Code, w.Body.String())
	}
	var resp struct {
		TotalMismatchCount int `json:"total_mismatch_count"`
		TotalMismatches    []struct {
			RowNumber         int     `json:"row_number"`
			ItemName          string  `json:"item_name"`
			ServerTotalAmount float64 `json:"server_total_amount"`
		} `json:"total_mismatches"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	if resp.TotalMismatchCount != 1 || len(resp.TotalMismatches) != 1 {
		t.Fatalf("mismatch report lost: %s", w.Body.String())
	}
	if resp.TotalMismatches[0].ServerTotalAmount != 50000 || resp.TotalMismatches[0].RowNumber != 5 {
		t.Fatalf("mismatch row mangled: %s", w.Body.String())
	}
}

// Empty mismatch list must serialize as [] (not null) so old and new frontends
// can iterate it unconditionally.
func TestImportBoq_EmptyMismatchesIsArray(t *testing.T) {
	svc := &stubImportSvc{res: &repository.ImportResult{InsertedItemsCount: 1}}
	h := NewImportBoqHandler(svc)
	r := authedTenderReq(t, http.MethodPost, "/api/v1/imports/boq",
		`{"tender_id":"22222222-2222-2222-2222-222222222222","file_name":"boq.xlsx","items":[]}`)
	w := httptest.NewRecorder()
	h.BulkImport(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d\n%s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"total_mismatches":[]`) {
		t.Fatalf("nil slice must render as []: %s", w.Body.String())
	}
}
