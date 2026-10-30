package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

const (
	anPos = "33333333-3333-4333-8333-333333333333"
	anSrc = "44444444-4444-4444-8444-444444444444"
	anKey = "55555555-5555-4555-8555-555555555555"
	anTok = "0123456789abcdef0123456789abcdef.fedcba9876543210fedcba9876543210"
)

type fakeAnalog struct {
	err    error
	called string
	in     repository.AnalogExecuteInput
	replay bool
	limit  int
	query  string
}

func (f *fakeAnalog) Search(_ context.Context, _, q string, limit int) (*services.AnalogSearchResponse, error) {
	f.called, f.query, f.limit = "search", q, limit
	return &services.AnalogSearchResponse{Hits: []services.AnalogHit{}}, f.err
}
func (f *fakeAnalog) GetSource(context.Context, string) (*repository.AnalogSource, error) {
	f.called = "source"
	return &repository.AnalogSource{Items: []repository.AnalogRow{}}, f.err
}
func (f *fakeAnalog) Preview(_ context.Context, in repository.AnalogExecuteInput) (*repository.AnalogPreview, error) {
	f.called, f.in = "preview", in
	return &repository.AnalogPreview{PreviewToken: anTok}, f.err
}
func (f *fakeAnalog) Apply(_ context.Context, in repository.AnalogExecuteInput) (*repository.AnalogApplyResult, error) {
	f.called, f.in = "apply", in
	return &repository.AnalogApplyResult{Replayed: f.replay, RunID: "run"}, f.err
}
func (f *fakeAnalog) ListApplications(context.Context, string) ([]repository.AnalogApplication, error) {
	f.called = "list"
	return []repository.AnalogApplication{}, f.err
}
func (f *fakeAnalog) Revert(context.Context, string, string) (*repository.AnalogApplication, error) {
	f.called = "revert"
	return &repository.AnalogApplication{ID: "a"}, f.err
}
func (f *fakeAnalog) Next(context.Context, string) (*repository.AnalogNext, error) {
	f.called = "next"
	return nil, f.err
}

func doAnalog(t *testing.T, f *fakeAnalog, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	h := NewAnalogHandler(f)
	r := chi.NewRouter()
	r.Get("/positions/{id}/analogs", h.Search)
	r.Get("/analogs/sources/{srcId}", h.GetSource)
	r.Post("/positions/{id}/analog:preview", h.Preview)
	r.Post("/positions/{id}/analog:apply", h.Apply)
	r.Get("/positions/{id}/analog-applications", h.ListApplications)
	r.Post("/analog-applications/{id}/revert", h.Revert)
	r.Get("/positions/{id}/analog-next", h.Next)
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.CtxUser, &middleware.AuthUser{ID: "u-1", Role: "engineer"}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return w, m
}

func analogBodyJSON(extra string) string {
	return `{"source_position_id":"` + anSrc + `","scale":{"mode":"volume_ratio"},"copy_prices":true` + extra + `}`
}

func TestParseAnalogBody_Validation(t *testing.T) {
	apply := `,"preview_token":"` + anTok + `","idempotency_key":"` + anKey + `"`
	cases := []struct {
		name, body string
		apply      bool
		wantMsg    string // подстрока ошибки; "" — без ошибки
		wantCode   string // код AnalogError, если ошибка контракта
	}{
		{"предпросмотр ок", analogBodyJSON(""), false, "", ""},
		{"apply ок", analogBodyJSON(apply), true, "", ""},
		{"битый JSON", `{`, false, "JSON", ""},
		{"source не uuid", `{"source_position_id":"x","scale":{"mode":"none"},"copy_prices":true}`, false, "source_position_id", ""},
		{"нет scale", `{"source_position_id":"` + anSrc + `","copy_prices":true}`, false, "scale.mode", ""},
		{"пустой mode", `{"source_position_id":"` + anSrc + `","scale":{"mode":""},"copy_prices":true}`, false, "scale.mode", ""},
		{"нет copy_prices", `{"source_position_id":"` + anSrc + `","scale":{"mode":"none"}}`, false, "copy_prices", ""},
		{"factor ≤ 0", `{"source_position_id":"` + anSrc + `","scale":{"mode":"factor","factor":0},"copy_prices":true}`, false, "", repository.AnalogCodeScaleInvalid},
		{"factor отсутствует", `{"source_position_id":"` + anSrc + `","scale":{"mode":"factor"},"copy_prices":true}`, false, "", repository.AnalogCodeScaleInvalid},
		{"неизвестный режим", `{"source_position_id":"` + anSrc + `","scale":{"mode":"auto"},"copy_prices":true}`, false, "", repository.AnalogCodeScaleInvalid},
		{"apply без токена", analogBodyJSON(`,"idempotency_key":"` + anKey + `"`), true, "preview_token", ""},
		{"apply с битым токеном", analogBodyJSON(`,"preview_token":"abc","idempotency_key":"` + anKey + `"`), true, "preview_token", ""},
		{"apply без ключа", analogBodyJSON(`,"preview_token":"` + anTok + `"`), true, "idempotency_key", ""},
		{"apply ключ не uuid", analogBodyJSON(`,"preview_token":"` + anTok + `","idempotency_key":"1"`), true, "idempotency_key", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, token, key, err := parseAnalogBody([]byte(tc.body), tc.apply)
			if tc.wantMsg == "" && tc.wantCode == "" {
				if err != nil {
					t.Fatalf("неожиданная ошибка: %v", err)
				}
				if req.SourcePositionID != anSrc || !req.CopyPrices || (tc.apply && (token != anTok || key != anKey)) {
					t.Fatalf("разбор: %+v token=%q key=%q", req, token, key)
				}
				return
			}
			if err == nil {
				t.Fatal("ожидалась ошибка")
			}
			var ae *repository.AnalogError
			if tc.wantCode != "" {
				if !errors.As(err, &ae) || ae.Code != tc.wantCode {
					t.Fatalf("err = %v, want код %s", err, tc.wantCode)
				}
				return
			}
			if !strings.Contains(err.Error(), tc.wantMsg) {
				t.Fatalf("err = %q, want подстроку %q", err, tc.wantMsg)
			}
		})
	}
}

func TestAnalogHandler_ErrorFormat(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{&repository.AnalogError{Code: repository.AnalogCodeTargetNotFound, Message: "нет"}, 404, "ANALOG_TARGET_NOT_FOUND"},
		{&repository.AnalogError{Code: repository.AnalogCodeSourceNotFound, Message: "нет"}, 404, "ANALOG_SOURCE_NOT_FOUND"},
		{&repository.AnalogError{Code: repository.AnalogCodeStale, Message: "устарело", Extras: map[string]any{"changed": "source"}}, 409, "ANALOG_STALE"},
		{&repository.AnalogError{Code: repository.AnalogCodeTargetLocked, Message: "x"}, 409, "ANALOG_TARGET_LOCKED"},
		{&repository.AnalogError{Code: repository.AnalogCodeTargetHasRows, Message: "x"}, 409, "ANALOG_TARGET_HAS_ROWS"},
		{&repository.AnalogError{Code: repository.AnalogCodeIdempotencyClash, Message: "x"}, 409, "ANALOG_IDEMPOTENCY_CONFLICT"},
		{&repository.AnalogError{Code: repository.AnalogCodeForeignChildren, Message: "x"}, 409, "ANALOG_FOREIGN_CHILDREN"},
		{&repository.AnalogError{Code: repository.AnalogCodeNotActive, Message: "x"}, 409, "ANALOG_NOT_ACTIVE"},
		{&repository.AnalogError{Code: repository.AnalogCodeScaleNeedsChoice, Message: "x"}, 400, "ANALOG_SCALE_NEEDS_DECISION"},
		{&repository.AnalogError{Code: repository.AnalogCodeVolumeUnknown, Message: "x"}, 400, "ANALOG_VOLUME_UNKNOWN"},
		{&repository.AnalogError{Code: repository.AnalogCodeScaleInvalid, Message: "x"}, 400, "ANALOG_SCALE_INVALID"},
		{&calc.MissingFXRateError{Currency: "USD"}, 400, "MISSING_FX_RATE"},
		{&repository.InvalidBoqParentError{ItemID: "i", ParentItemID: "p"}, 422, "INVALID_BOQ_PARENT"},
		{repository.ErrAutopriceRunCancelled, 409, "run_cancelled"},
	}
	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			w, m := doAnalog(t, &fakeAnalog{err: tc.err}, http.MethodPost, "/positions/"+anPos+"/analog:preview", analogBodyJSON(""))
			if w.Code != tc.status || m["error"] != tc.code {
				t.Fatalf("status=%d body=%v, want %d %s", w.Code, m, tc.status, tc.code)
			}
			if msg, _ := m["message"].(string); msg == "" {
				t.Fatalf("нет message: %v", m)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control = %q", w.Header().Get("Cache-Control"))
			}
		})
	}

	_, m := doAnalog(t, &fakeAnalog{err: &repository.AnalogError{Code: repository.AnalogCodeStale, Message: "x", Extras: map[string]any{"changed": "target"}}},
		http.MethodPost, "/positions/"+anPos+"/analog:preview", analogBodyJSON(""))
	if m["changed"] != "target" {
		t.Fatalf("extras должны попасть в тело: %v", m)
	}
}

func TestAnalogHandler_PreviewApplyEnvelope(t *testing.T) {
	f := &fakeAnalog{}
	w, m := doAnalog(t, f, http.MethodPost, "/positions/"+anPos+"/analog:preview", analogBodyJSON(""))
	if w.Code != 200 || f.called != "preview" || f.in.UserID != "u-1" || f.in.PositionID != anPos || f.in.Request.ScaleMode != "volume_ratio" {
		t.Fatalf("preview: %d %+v %v", w.Code, f.in, m)
	}
	if _, ok := m["data"].(map[string]any); !ok {
		t.Fatalf("ответ должен быть {data: ...}: %v", m)
	}

	f = &fakeAnalog{replay: true}
	w, m = doAnalog(t, f, http.MethodPost, "/positions/"+anPos+"/analog:apply",
		analogBodyJSON(`,"preview_token":"`+anTok+`","idempotency_key":"`+anKey+`"`))
	data, _ := m["data"].(map[string]any)
	if w.Code != 200 || f.called != "apply" || data["replayed"] != true || data["run_id"] != "run" || data["application"] == nil {
		t.Fatalf("apply: %d %v", w.Code, m)
	}
	if f.in.IdempotencyKey != anKey || f.in.PreviewToken != anTok {
		t.Fatalf("вход apply: %+v", f.in)
	}

	// apply без токена не доходит до сервиса
	f = &fakeAnalog{}
	w, m = doAnalog(t, f, http.MethodPost, "/positions/"+anPos+"/analog:apply", analogBodyJSON(""))
	if w.Code != 400 || m["error"] != "ANALOG_BAD_REQUEST" || f.called != "" {
		t.Fatalf("apply без токена: %d %v called=%q", w.Code, m, f.called)
	}
}

func TestAnalogHandler_ReadRoutes(t *testing.T) {
	f := &fakeAnalog{}
	if w, _ := doAnalog(t, f, http.MethodGet, "/positions/"+anPos+"/analogs?q=бетон&limit=5", ""); w.Code != 200 || f.query != "бетон" || f.limit != 5 {
		t.Fatalf("search: %d q=%q limit=%d", w.Code, f.query, f.limit)
	}
	if w, m := doAnalog(t, &fakeAnalog{}, http.MethodGet, "/positions/"+anPos+"/analogs?limit=abc", ""); w.Code != 400 || m["error"] != "ANALOG_BAD_REQUEST" {
		t.Fatalf("limit=abc: %d %v", w.Code, m)
	}
	if w, m := doAnalog(t, &fakeAnalog{}, http.MethodGet, "/positions/не-uuid/analogs", ""); w.Code != 400 || m["error"] != "bad_request" {
		t.Fatalf("не uuid: %d %v", w.Code, m)
	}
	w, m := doAnalog(t, &fakeAnalog{}, http.MethodGet, "/positions/"+anPos+"/analog-next", "")
	if v, ok := m["data"]; w.Code != 200 || !ok || v != nil {
		t.Fatalf("next без результата должен быть {data:null}: %d %v", w.Code, m)
	}
	if w, _ := doAnalog(t, &fakeAnalog{}, http.MethodGet, "/analogs/sources/"+anSrc, ""); w.Code != 200 {
		t.Fatalf("source: %d", w.Code)
	}
	if w, _ := doAnalog(t, &fakeAnalog{}, http.MethodGet, "/positions/"+anPos+"/analog-applications", ""); w.Code != 200 {
		t.Fatalf("list: %d", w.Code)
	}
	f = &fakeAnalog{}
	if w, _ := doAnalog(t, f, http.MethodPost, "/analog-applications/"+anKey+"/revert", ""); w.Code != 200 || f.called != "revert" {
		t.Fatalf("revert: %d", w.Code)
	}
}
