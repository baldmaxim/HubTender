package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

const (
	apSID = "11111111-1111-4111-8111-111111111111"
	apPos = "22222222-2222-4222-8222-222222222222"
)

type fakeAutoprice struct {
	err        error
	actionCall string
	actionCmt  string
	upsertIn   repository.AutopriceReviewInput
	called     bool
	skippedIn  []repository.AutopriceSkippedInput
}

func (f *fakeAutoprice) CreateRun(context.Context, string, string, string, *string) (*repository.AutopriceRunCreated, error) {
	f.called = true
	return &repository.AutopriceRunCreated{ID: apSID, Label: "x"}, f.err
}
func (f *fakeAutoprice) ListRuns(context.Context, string) ([]repository.AutopriceRun, error) {
	return nil, f.err
}
func (f *fakeAutoprice) GetRun(context.Context, string) (*repository.AutopriceRun, error) {
	return &repository.AutopriceRun{}, f.err
}
func (f *fakeAutoprice) ListTenders(context.Context) ([]repository.AutopriceTender, error) {
	return nil, f.err
}
func (f *fakeAutoprice) ListReviews(context.Context, string) ([]repository.AutopriceReview, error) {
	return nil, f.err
}
func (f *fakeAutoprice) GetPositionDetail(context.Context, string, string) (*repository.AutopriceDetail, error) {
	return &repository.AutopriceDetail{}, f.err
}
func (f *fakeAutoprice) UpsertReview(_ context.Context, _, _, _ string, in repository.AutopriceReviewInput) (*repository.AutopriceReview, error) {
	f.called = true
	f.upsertIn = in
	return &repository.AutopriceReview{}, f.err
}
func (f *fakeAutoprice) PatchReview(context.Context, string, string, string, repository.AutopriceReviewPatch) (*repository.AutopriceReview, error) {
	f.called = true
	return &repository.AutopriceReview{}, f.err
}
func (f *fakeAutoprice) ApplyAction(_ context.Context, _, _, _, action, comment string) (*repository.AutopriceReview, error) {
	f.called = true
	f.actionCall, f.actionCmt = action, comment
	return &repository.AutopriceReview{}, f.err
}

func (f *fakeAutoprice) ReplaceSkipped(_ context.Context, _ string, items []repository.AutopriceSkippedInput) (int, error) {
	f.called = true
	f.skippedIn = items
	return len(items), f.err
}
func (f *fakeAutoprice) ListUnpriced(context.Context, string) ([]repository.AutopriceUnpriced, error) {
	return nil, f.err
}

func doAutoprice(t *testing.T, f *fakeAutoprice, role, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	h := NewAutopriceReviewHandler(f)
	r := chi.NewRouter()
	r.Post("/tenders/{id}/autoprice-runs", h.CreateRun)
	r.Put("/runs/{sid}/positions/{posId}/review", h.PutReview)
	r.Patch("/runs/{sid}/positions/{posId}/review", h.PatchReview)
	r.Post("/runs/{sid}/positions/{posId}/review/action", h.Action)
	r.Put("/runs/{sid}/skipped", h.PutSkipped)
	r.Get("/runs/{sid}/unpriced", h.ListUnpriced)
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.CtxUser,
		&middleware.AuthUser{ID: "u-1", Role: role}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return w, m
}

const apActionPath = "/runs/" + apSID + "/positions/" + apPos + "/review/action"

func TestAutopriceAction_ApproveRoles(t *testing.T) {
	for role, want := range map[string]int{
		"engineer": http.StatusForbidden, "senior_group": http.StatusForbidden,
		"veduschiy_inzhener": http.StatusOK, "administrator": http.StatusOK,
	} {
		f := &fakeAutoprice{}
		w, m := doAutoprice(t, f, role, "POST", apActionPath, `{"action":"approve"}`)
		if w.Code != want {
			t.Fatalf("role %s: status %d, want %d", role, w.Code, want)
		}
		if want == http.StatusForbidden && (m["error"] != "forbidden" || f.called) {
			t.Fatalf("role %s: body %v called=%v", role, m, f.called)
		}
	}
}

func TestAutopriceAction_ReopenNeedsApprover_OthersAnyUser(t *testing.T) {
	f := &fakeAutoprice{}
	if w, _ := doAutoprice(t, f, "engineer", "POST", apActionPath, `{"action":"reopen"}`); w.Code != http.StatusForbidden {
		t.Fatalf("reopen by engineer: %d", w.Code)
	}
	for _, a := range []string{"start", "needs_customer", "exclude"} {
		if w, _ := doAutoprice(t, f, "engineer", "POST", apActionPath, `{"action":"`+a+`"}`); w.Code != http.StatusOK {
			t.Fatalf("%s by engineer: %d", a, w.Code)
		}
	}
}

func TestAutopriceAction_ReturnNeedsComment(t *testing.T) {
	f := &fakeAutoprice{}
	w, m := doAutoprice(t, f, "engineer", "POST", apActionPath, `{"action":"return","comment":"  "}`)
	if w.Code != http.StatusBadRequest || m["error"] != "bad_request" || f.called {
		t.Fatalf("status %d body %v called=%v", w.Code, m, f.called)
	}
	w, _ = doAutoprice(t, f, "engineer", "POST", apActionPath, `{"action":"return","comment":"цена занижена"}`)
	if w.Code != http.StatusOK || f.actionCmt != "цена занижена" {
		t.Fatalf("status %d comment %q", w.Code, f.actionCmt)
	}
}

func TestAutopriceAction_UnknownAction400(t *testing.T) {
	w, _ := doAutoprice(t, &fakeAutoprice{}, "administrator", "POST", apActionPath, `{"action":"nuke"}`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status %d", w.Code)
	}
}

func TestAutopriceAction_ZeroPrice422(t *testing.T) {
	f := &fakeAutoprice{err: &repository.AutopriceZeroPriceError{Count: 3}}
	w, m := doAutoprice(t, f, "administrator", "POST", apActionPath, `{"action":"approve"}`)
	if w.Code != http.StatusUnprocessableEntity || m["error"] != "zero_price" || m["zero_price_count"] != float64(3) {
		t.Fatalf("status %d body %v", w.Code, m)
	}
	if m["message"] == "" {
		t.Fatal("message required")
	}
}

func TestAutopriceAction_InvalidTransition409(t *testing.T) {
	f := &fakeAutoprice{err: &repository.AutopriceTransitionError{Action: "start", From: "approved"}}
	w, m := doAutoprice(t, f, "engineer", "POST", apActionPath, `{"action":"start"}`)
	if w.Code != http.StatusConflict || m["error"] != "invalid_transition" {
		t.Fatalf("status %d body %v", w.Code, m)
	}
}

func TestAutopricePatch_Approved409(t *testing.T) {
	f := &fakeAutoprice{err: repository.ErrAutopriceApproved}
	w, m := doAutoprice(t, f, "engineer", "PATCH", "/runs/"+apSID+"/positions/"+apPos+"/review", `{"engineer_comment":"ок"}`)
	if w.Code != http.StatusConflict || m["error"] != "approved" {
		t.Fatalf("status %d body %v", w.Code, m)
	}
}

func TestAutopricePut_Approved409AndValidation(t *testing.T) {
	path := "/runs/" + apSID + "/positions/" + apPos + "/review"
	f := &fakeAutoprice{err: repository.ErrAutopriceApproved}
	w, m := doAutoprice(t, f, "engineer", "PUT", path, `{"basis":"ASSUMED","pd_refs":["лист 3"]}`)
	if w.Code != http.StatusConflict || m["error"] != "approved" {
		t.Fatalf("status %d body %v", w.Code, m)
	}
	for _, body := range []string{
		`{"basis":"WRONG"}`,
		`{"pd_refs":"x"}`,
		`{"questions":[{"text":""}]}`,
		`{"findings":[{"kind":"dup","severity":"huge","text":"t"}]}`,
		`{"findings":[{"kind":"dup","severity":"low","text":"t","resolution":"zzz"}]}`,
	} {
		f := &fakeAutoprice{}
		if w, _ := doAutoprice(t, f, "engineer", "PUT", path, body); w.Code != http.StatusBadRequest || f.called {
			t.Fatalf("body %s: status %d called=%v", body, w.Code, f.called)
		}
	}
	f = &fakeAutoprice{}
	body := `{"basis":"PD_CONFIRMED","pd_refs":["a"],"questions":[{"text":"q"}],"findings":[{"kind":"dup","severity":"high","text":"t","resolution":"fixed"}]}`
	if w, _ := doAutoprice(t, f, "engineer", "PUT", path, body); w.Code != http.StatusOK {
		t.Fatalf("valid body: %d", w.Code)
	}
	if string(f.upsertIn.PdRefs) != `["a"]` || f.upsertIn.Basis == nil {
		t.Fatalf("input not passed: %+v", f.upsertIn)
	}
}

func TestAutopriceCreateRun_Validation(t *testing.T) {
	path := "/tenders/" + apSID + "/autoprice-runs"
	if w, _ := doAutoprice(t, &fakeAutoprice{}, "engineer", "POST", path, `{"label":" "}`); w.Code != http.StatusBadRequest {
		t.Fatalf("empty label: %d", w.Code)
	}
	if w, _ := doAutoprice(t, &fakeAutoprice{}, "engineer", "POST", "/tenders/not-uuid/autoprice-runs", `{"label":"x"}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad id: %d", w.Code)
	}
	w, _ := doAutoprice(t, &fakeAutoprice{}, "engineer", "POST", path, `{"label":"прогон 1","source_ref":"run.json"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("ok: %d", w.Code)
	}
}

func TestAutoprice_PutSkipped_Validation(t *testing.T) {
	path := "/runs/" + apSID + "/skipped"
	long := strings.Repeat("я", 2001)
	tooMany := `{"items":[` + strings.Repeat(`{"position_id":"`+apPos+`","reason_code":"other"},`, 5000) + `{"position_id":"` + apPos + `","reason_code":"other"}]}`
	for name, body := range map[string]string{
		"битый JSON":          `x`,
		"не UUID":             `{"items":[{"position_id":"zzz","reason_code":"other"}]}`,
		"неизвестный код":     `{"items":[{"position_id":"` + apPos + `","reason_code":"bad"}]}`,
		"пустой код":          `{"items":[{"position_id":"` + apPos + `"}]}`,
		"длинная причина":     `{"items":[{"position_id":"` + apPos + `","reason_code":"other","reason":"` + long + `"}]}`,
		"дубль позиции":       `{"items":[{"position_id":"` + apPos + `","reason_code":"other"},{"position_id":"` + strings.ToUpper(apPos) + `","reason_code":"no_match"}]}`,
		"больше 5000 позиций": tooMany,
	} {
		f := &fakeAutoprice{}
		w, m := doAutoprice(t, f, "engineer", "PUT", path, body)
		if w.Code != http.StatusBadRequest || m["error"] != "bad_request" || f.called {
			t.Fatalf("%s: status %d body %v called=%v", name, w.Code, m, f.called)
		}
	}
	if w, _ := doAutoprice(t, &fakeAutoprice{}, "engineer", "PUT", "/runs/not-uuid/skipped", `{"items":[]}`); w.Code != http.StatusBadRequest {
		t.Fatalf("bad sid: %d", w.Code)
	}
}

func TestAutoprice_PutSkipped_OKAndErrors(t *testing.T) {
	path := "/runs/" + apSID + "/skipped"
	f := &fakeAutoprice{}
	body := `{"items":[{"position_id":"` + apPos + `","reason_code":"no_match","reason":"нет в базе"},{"position_id":"` + apSID + `","reason_code":"error"}]}`
	w, m := doAutoprice(t, f, "engineer", "PUT", path, body)
	if w.Code != http.StatusOK || m["count"] != float64(2) || len(f.skippedIn) != 2 ||
		f.skippedIn[0].ReasonCode != "no_match" || f.skippedIn[0].Reason == nil || f.skippedIn[1].Reason != nil {
		t.Fatalf("status %d body %v in %+v", w.Code, m, f.skippedIn)
	}
	// Пустой список — очистка.
	f = &fakeAutoprice{}
	if w, m := doAutoprice(t, f, "engineer", "PUT", path, `{"items":[]}`); w.Code != http.StatusOK || m["count"] != float64(0) || !f.called {
		t.Fatalf("clear: status %d body %v called=%v", w.Code, m, f.called)
	}
	// Позиции вне тендера прогона — 400 со списком id.
	f = &fakeAutoprice{err: &repository.MissingPositionsError{IDs: []string{apPos}}}
	w, m = doAutoprice(t, f, "engineer", "PUT", path, body)
	ids, _ := m["position_ids"].([]any)
	if w.Code != http.StatusBadRequest || m["error"] != "bad_request" || len(ids) != 1 || ids[0] != apPos {
		t.Fatalf("missing: status %d body %v", w.Code, m)
	}
	for err, want := range map[error]int{
		repository.ErrAutopriceRunNotFound:  http.StatusNotFound,
		repository.ErrAutopriceRunCancelled: http.StatusConflict,
	} {
		if w, _ := doAutoprice(t, &fakeAutoprice{err: err}, "engineer", "PUT", path, `{"items":[]}`); w.Code != want {
			t.Fatalf("%v: status %d, want %d", err, w.Code, want)
		}
	}
}

func TestAutoprice_ListUnpriced(t *testing.T) {
	path := "/runs/" + apSID + "/unpriced"
	w, _ := doAutoprice(t, &fakeAutoprice{}, "engineer", "GET", path, "")
	if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("empty: status %d body %q", w.Code, w.Body.String())
	}
	if w, _ := doAutoprice(t, &fakeAutoprice{err: repository.ErrAutopriceRunNotFound}, "engineer", "GET", path, ""); w.Code != http.StatusNotFound {
		t.Fatalf("not found: %d", w.Code)
	}
	if w, _ := doAutoprice(t, &fakeAutoprice{}, "engineer", "GET", "/runs/not-uuid/unpriced", ""); w.Code != http.StatusBadRequest {
		t.Fatalf("bad sid: %d", w.Code)
	}
}
