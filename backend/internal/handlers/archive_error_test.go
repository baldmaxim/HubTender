package handlers

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

// Доменные ошибки сборки из архива — типизированные RFC 7807, а не общий 500.
// Каждая 4xx означает полный откат транзакции: частичной сборки не бывает.

type stubArchiveSvc struct {
	err error
	res *repository.ComposeResult
}

func (s *stubArchiveSvc) Search(context.Context, services.ArchiveSearchRequest) ([]services.ArchiveSearchHit, error) {
	return nil, nil
}

func (s *stubArchiveSvc) Suggest(context.Context, services.SuggestRequest) ([]services.SuggestResult, error) {
	return nil, nil
}

func (s *stubArchiveSvc) GetPosition(context.Context, string) (*repository.ArchivePositionDetail, error) {
	return nil, repository.ErrArchivePositionNotFound
}

func (s *stubArchiveSvc) Compose(context.Context, repository.ComposeInput) (*repository.ComposeResult, error) {
	if s.err != nil {
		return nil, s.err
	}
	return s.res, nil
}

const composeBody = `{
  "target_tender_id": "11111111-1111-1111-1111-111111111111",
  "groups": [{
    "temp_id": "g1",
    "target": {"position_id": "22222222-2222-2222-2222-222222222222"},
    "sources": [{"source_position_id": "33333333-3333-3333-3333-333333333333"}]
  }]
}`

func composeRequest(t *testing.T, svc archiveServicer) *httptest.ResponseRecorder {
	t.Helper()
	h := NewArchiveHandler(svc)
	r := chi.NewRouter()
	r.Post("/api/v1/archive/compose", h.Compose)

	req := httptest.NewRequest("POST", "/api/v1/archive/compose", strings.NewReader(composeBody))
	req = req.WithContext(context.WithValue(
		req.Context(), middleware.CtxUser,
		&middleware.AuthUser{ID: "44444444-4444-4444-4444-444444444444"},
	))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestComposeErrorMapping(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
	}{
		{
			name:       "нет курса валюты в целевом тендере",
			err:        fmt.Errorf("compose: %w", &calc.MissingFXRateError{Currency: "USD"}),
			wantStatus: 400,
			wantCode:   "MISSING_FX_RATE",
		},
		{
			name: "родитель вне копируемого набора",
			err: fmt.Errorf("compose: %w", &repository.InvalidBoqParentError{
				ItemID: "i1", ParentItemID: "p1", Reason: repository.BoqParentNotCopied,
			}),
			wantStatus: 400,
			wantCode:   "INVALID_BOQ_PARENT",
		},
		{
			name:       "цель задана неверно",
			err:        &repository.ArchiveTargetSpecError{GroupTempID: "g1", Reason: "оба ключа"},
			wantStatus: 400,
			wantCode:   "ARCHIVE_TARGET_SPEC_INVALID",
		},
		{
			name:       "дубль цели",
			err:        &repository.ArchiveDuplicateTargetError{PositionID: "p1"},
			wantStatus: 409,
			wantCode:   "ARCHIVE_DUPLICATE_TARGET",
		},
		{
			name:       "целевой позиции нет",
			err:        &repository.ArchiveTargetNotFoundError{PositionID: "p1"},
			wantStatus: 404,
			wantCode:   "ARCHIVE_TARGET_POSITION_NOT_FOUND",
		},
		{
			name: "целевая позиция из другого тендера",
			err: &repository.ArchiveTargetScopeError{
				PositionID: "p1", ExpectedTenderID: "t1", ActualTenderID: "t2",
			},
			wantStatus: 409,
			wantCode:   "ARCHIVE_TARGET_TENDER_MISMATCH",
		},
		{
			name:       "нет позиции-источника",
			err:        &repository.ArchiveSourceNotFoundError{PositionID: "p1"},
			wantStatus: 404,
			wantCode:   "ARCHIVE_SOURCE_POSITION_NOT_FOUND",
		},
		{
			name:       "нет строки источника",
			err:        &repository.ArchiveSourceNotFoundError{PositionID: "p1", ItemID: "i1"},
			wantStatus: 404,
			wantCode:   "ARCHIVE_SOURCE_ITEM_NOT_FOUND",
		},
		{
			name:       "копировать нечего",
			err:        &repository.ArchiveNothingToComposeError{},
			wantStatus: 400,
			wantCode:   "ARCHIVE_NOTHING_TO_COMPOSE",
		},
		{
			name:       "объём для volume_ratio не задан",
			err:        &repository.ArchiveScaleError{GroupTempID: "g1", Undefined: true, Reason: "нет объёма"},
			wantStatus: 400,
			wantCode:   "ARCHIVE_SCALE_UNDEFINED",
		},
		{
			name:       "недопустимый коэффициент",
			err:        &repository.ArchiveScaleError{GroupTempID: "g1", Reason: "factor <= 0"},
			wantStatus: 400,
			wantCode:   "ARCHIVE_SCALE_INVALID",
		},
		{
			name: "количество обнулилось",
			err: &repository.ArchiveQuantityUnderflowError{
				GroupTempID: "g1", SourceItemID: "i1", Factor: 0.0001,
			},
			wantStatus: 400,
			wantCode:   "ARCHIVE_QUANTITY_UNDERFLOW",
		},
		{
			name: "параллельная правка тендера",
			err: fmt.Errorf("compose: %w", &repository.StaleCalculationResultError{
				TenderID: "11111111-1111-1111-1111-111111111111",
			}),
			wantStatus: 409,
			wantCode:   "ARCHIVE_CONCURRENT_MODIFICATION",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := composeRequest(t, &stubArchiveSvc{err: c.err})
			if w.Code != c.wantStatus {
				t.Fatalf("status = %d, want %d (body %s)", w.Code, c.wantStatus, w.Body.String())
			}
			m := decodeProblem(t, w)
			if m["code"] != c.wantCode {
				t.Fatalf("code = %v, want %s", m["code"], c.wantCode)
			}
		})
	}
}

func TestComposeUnknownErrorIs500(t *testing.T) {
	w := composeRequest(t, &stubArchiveSvc{err: fmt.Errorf("внезапная ошибка БД")})
	if w.Code != 500 {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}

func TestComposeWithoutAuthIs401(t *testing.T) {
	h := NewArchiveHandler(&stubArchiveSvc{})
	r := chi.NewRouter()
	r.Post("/api/v1/archive/compose", h.Compose)

	req := httptest.NewRequest("POST", "/api/v1/archive/compose", strings.NewReader(composeBody))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 401 {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestComposeRejectsMalformedBody(t *testing.T) {
	h := NewArchiveHandler(&stubArchiveSvc{})
	r := chi.NewRouter()
	r.Post("/api/v1/archive/compose", h.Compose)

	req := httptest.NewRequest("POST", "/api/v1/archive/compose", strings.NewReader(`{"groups":[]}`))
	req = req.WithContext(context.WithValue(
		req.Context(), middleware.CtxUser,
		&middleware.AuthUser{ID: "44444444-4444-4444-4444-444444444444"},
	))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}

func TestGetArchivePositionNotFound(t *testing.T) {
	h := NewArchiveHandler(&stubArchiveSvc{})
	r := chi.NewRouter()
	r.Get("/api/v1/archive/positions/{id}", h.GetPosition)

	req := httptest.NewRequest("GET",
		"/api/v1/archive/positions/55555555-5555-5555-5555-555555555555", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 404 {
		t.Fatalf("status = %d, want 404 (body %s)", w.Code, w.Body.String())
	}
	if m := decodeProblem(t, w); m["code"] != "ARCHIVE_SOURCE_POSITION_NOT_FOUND" {
		t.Fatalf("code = %v", m["code"])
	}
}

func TestSearchRequiresQuery(t *testing.T) {
	h := NewArchiveHandler(&stubArchiveSvc{})
	r := chi.NewRouter()
	r.Get("/api/v1/archive/positions/search", h.SearchPositions)

	req := httptest.NewRequest("GET", "/api/v1/archive/positions/search", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	if w.Code != 400 {
		t.Fatalf("status = %d, want 400", w.Code)
	}
}
