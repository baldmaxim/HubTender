package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/su10/hubtender/backend/internal/calc"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

const (
	abPos2   = "33333333-3333-4333-8333-333333333333"
	abWorkNm = "44444444-4444-4444-8444-444444444444"
	abMatNm  = "55555555-5555-4555-8555-555555555555"
	abPath   = "/runs/" + apSID + "/items:bulk"
)

type fakeBulk struct {
	err   error
	calls int
	got   []repository.AutopriceBulkPosition
}

func (f *fakeBulk) BulkWrite(_ context.Context, _, _ string, positions []repository.AutopriceBulkPosition) (*repository.AutopriceBulkResult, error) {
	f.calls++
	f.got = positions
	if f.err != nil {
		return nil, f.err
	}
	res := &repository.AutopriceBulkResult{TenderID: "t-1"}
	for _, p := range positions {
		pr := repository.AutopriceBulkPositionResult{PositionID: p.PositionID, Items: []repository.AutopriceBulkItemResult{}}
		for i, it := range p.Items {
			pr.Items = append(pr.Items, repository.AutopriceBulkItemResult{
				Ref: it.Ref, ID: fmt.Sprintf("id-%d", i), UpdatedAt: time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC),
			})
		}
		if p.Review != nil {
			pr.Review = &repository.AutopriceReview{ClientPositionID: p.PositionID, Status: "pending"}
		}
		res.Positions = append(res.Positions, pr)
	}
	return res, nil
}

func doBulk(t *testing.T, f *fakeBulk, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	h := NewAutopriceBulkHandler(f)
	r := chi.NewRouter()
	r.Post("/runs/{sid}/items:bulk", h.PostBulk)
	req := httptest.NewRequest("POST", abPath, strings.NewReader(body))
	req = req.WithContext(context.WithValue(req.Context(), middleware.CtxUser,
		&middleware.AuthUser{ID: "u-1", Role: "engineer"}))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return w, m
}

func abWork(ref string) string {
	return `{"ref":"` + ref + `","boq_item_type":"раб","work_name_id":"` + abWorkNm + `","quantity":2,"unit_rate":10}`
}

func abMat(ref, parent string) string {
	p := ""
	if parent != "" {
		p = `,"parent_ref":"` + parent + `"`
	}
	return `{"ref":"` + ref + `"` + p + `,"boq_item_type":"мат","material_name_id":"` + abMatNm + `","quantity":1,"unit_rate":5}`
}

func abBody(pos string, items ...string) string {
	return `{"positions":[{"position_id":"` + pos + `","items":[` + strings.Join(items, ",") + `]}]}`
}

func TestAutopriceBulk_TooLargeByPositions(t *testing.T) {
	f := &fakeBulk{}
	var ps []string
	for i := 0; i < 51; i++ {
		ps = append(ps, fmt.Sprintf(`{"position_id":"00000000-0000-4000-8000-%012d","items":[%s]}`, i, abWork("a")))
	}
	w, m := doBulk(t, f, `{"positions":[`+strings.Join(ps, ",")+`]}`)
	want := "не больше 50 позиций и 2000 строк на запрос: получено 51 позиций, 51 строк"
	if w.Code != http.StatusRequestEntityTooLarge || m["error"] != "too_large" || m["message"] != want || f.calls != 0 {
		t.Fatalf("status %d body %v calls=%d", w.Code, m, f.calls)
	}
}

func TestAutopriceBulk_TooLargeByItems(t *testing.T) {
	f := &fakeBulk{}
	var ps []string
	for i := 0; i < 5; i++ {
		items := make([]string, 401)
		for j := range items {
			items[j] = abWork(fmt.Sprintf("r%d", j))
		}
		ps = append(ps, fmt.Sprintf(`{"position_id":"00000000-0000-4000-8000-%012d","items":[%s]}`, i, strings.Join(items, ",")))
	}
	w, m := doBulk(t, f, `{"positions":[`+strings.Join(ps, ",")+`]}`)
	want := "не больше 50 позиций и 2000 строк на запрос: получено 5 позиций, 2005 строк"
	if w.Code != http.StatusRequestEntityTooLarge || m["error"] != "too_large" || m["message"] != want || f.calls != 0 {
		t.Fatalf("status %d body %v calls=%d", w.Code, m, f.calls)
	}
}

func TestAutopriceBulk_TooLargeBody(t *testing.T) {
	f := &fakeBulk{}
	w, m := doBulk(t, f, `{"positions":[{"position_id":"`+strings.Repeat("a", 9<<20)+`"}]}`)
	if w.Code != http.StatusRequestEntityTooLarge || m["error"] != "too_large" || f.calls != 0 {
		t.Fatalf("status %d body %v", w.Code, m)
	}
}

func TestAutopriceBulk_BadJSONAndEmpty(t *testing.T) {
	f := &fakeBulk{}
	if w, m := doBulk(t, f, `{"positions":`); w.Code != http.StatusBadRequest || m["error"] != "bad_request" {
		t.Fatalf("bad json: %d %v", w.Code, m)
	}
	if w, m := doBulk(t, f, `{"positions":[]}`); w.Code != http.StatusBadRequest || m["error"] != "bad_request" {
		t.Fatalf("empty: %d %v", w.Code, m)
	}
	if f.calls != 0 {
		t.Fatal("store must not be called")
	}
}

func TestAutopriceBulk_Invalid422(t *testing.T) {
	two := func(a, b string) string {
		return `{"positions":[{"position_id":"` + apPos + `","items":[` + abWork("w1") + `]},{"position_id":"` + b + `","items":[` + a + `]}]}`
	}
	cases := []struct {
		name, body, pos, ref, field string
	}{
		{"дубль ref", abBody(apPos, abWork("w1"), abWork("w1")), apPos, "w1", "ref"},
		{"пустой ref", abBody(apPos, abWork("")), apPos, "", "ref"},
		{"неизвестный parent_ref", abBody(apPos, abWork("w1"), abMat("m1", "nope")), apPos, "m1", "parent_ref"},
		{"parent_ref на материал", abBody(apPos, abWork("w1"), abMat("m1", ""), abMat("m2", "m1")), apPos, "m2", "parent_ref"},
		{"parent_ref на себя", abBody(apPos, abMat("m1", "m1")), apPos, "m1", "parent_ref"},
		{"работа с parent_ref", `{"positions":[{"position_id":"` + apPos + `","items":[` + abWork("w1") + `,{"ref":"w2","parent_ref":"w1","boq_item_type":"раб","work_name_id":"` + abWorkNm + `"}]}]}`, apPos, "w2", "parent_ref"},
		{"parent_work_item_id", abBody(apPos, abWork("w1"), `{"ref":"m1","boq_item_type":"мат","material_name_id":"`+abMatNm+`","parent_work_item_id":"`+apPos+`"}`), apPos, "m1", "parent_work_item_id"},
		{"validate-тег", abBody(apPos, `{"ref":"w1","boq_item_type":"раб","work_name_id":"`+abWorkNm+`","unit_rate":-1}`), apPos, "w1", "unit_rate"},
		{"не uuid в поле", abBody(apPos, `{"ref":"w1","boq_item_type":"раб","work_name_id":"zzz"}`), apPos, "w1", "work_name_id"},
		{"неизвестный тип", abBody(apPos, `{"ref":"w1","boq_item_type":"прочее","work_name_id":"`+abWorkNm+`"}`), apPos, "w1", "boq_item_type"},
		{"работа без work_name_id", abBody(apPos, `{"ref":"w1","boq_item_type":"раб"}`), apPos, "w1", "work_name_id"},
		{"материал с work_name_id", abBody(apPos, `{"ref":"m1","boq_item_type":"мат","material_name_id":"`+abMatNm+`","work_name_id":"`+abWorkNm+`"}`), apPos, "m1", "work_name_id"},
		{"позиция повторяется", two(abWork("a"), apPos), apPos, "", "position_id"},
		{"position_id не uuid", abBody("123", abWork("w1")), "123", "", "position_id"},
		{"review.basis", `{"positions":[{"position_id":"` + apPos + `","items":[],"review":{"basis":"X"}}]}`, apPos, "", "review.basis"},
		{"review.findings", `{"positions":[{"position_id":"` + apPos + `","review":{"findings":[{"kind":"k"}]}}]}`, apPos, "", "review.findings"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := &fakeBulk{}
			w, m := doBulk(t, f, c.body)
			if w.Code != http.StatusUnprocessableEntity || m["error"] != "invalid_item" ||
				m["position_id"] != c.pos || m["ref"] != c.ref || m["field"] != c.field || m["message"] == "" {
				t.Fatalf("status %d body %v", w.Code, m)
			}
			if f.calls != 0 {
				t.Fatal("store must not be called on invalid body")
			}
		})
	}
}

func TestAutopriceBulk_ErrorMapping(t *testing.T) {
	pgErr := func(code, constraint string) error {
		return &repository.AutopriceBulkError{PositionID: apPos, Ref: "m1",
			Err: fmt.Errorf("wrap: %w", &pgconn.PgError{Code: code, ConstraintName: constraint, Detail: "Key (x)=(y) is not present"})}
	}
	cases := []struct {
		name   string
		err    error
		status int
		code   string // error (или code для RFC 7807)
		field  string
	}{
		{"approved", &repository.AutopriceBulkError{PositionID: apPos, Err: repository.ErrAutopriceApproved}, 409, "approved", ""},
		{"run_cancelled", repository.ErrAutopriceRunCancelled, 409, "run_cancelled", ""},
		{"run_not_found", repository.ErrAutopriceRunNotFound, 404, "run_not_found", ""},
		{"position_not_found", &repository.AutopriceBulkError{PositionID: abPos2, Err: repository.ErrAutopricePositionNotFound}, 404, "position_not_found", ""},
		{"foreign_children", &repository.AutopriceBulkError{PositionID: apPos, Err: repository.ErrAutopriceForeignChildren}, 409, "foreign_children", ""},
		{"даты источника", &repository.AutopriceBulkError{PositionID: apPos, Ref: "m1", Err: &repository.InvalidQuoteDatesError{Reason: "дата цены не может быть в будущем"}}, 422, "invalid_item", "quote_price_date"},
		{"FK справочника", pgErr("23503", "boq_items_work_name_id_fkey"), 422, "invalid_item", "work_name_id"},
		{"CHECK количества", pgErr("23514", "boq_items_quantity_positive"), 422, "invalid_item", "quantity"},
		{"parent_ref на уровне репо", &repository.AutopriceBulkError{PositionID: apPos, Ref: "m1", Field: "parent_ref", Err: errors.New("parent_ref не найден")}, 422, "invalid_item", "parent_ref"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, m := doBulk(t, &fakeBulk{err: c.err}, abBody(apPos, abWork("w1")))
			if w.Code != c.status || m["error"] != c.code {
				t.Fatalf("status %d body %v", w.Code, m)
			}
			var be *repository.AutopriceBulkError
			if errors.As(c.err, &be) && m["position_id"] != be.PositionID {
				t.Fatalf("position_id %v, want %s: %v", m["position_id"], be.PositionID, m)
			}
			if c.field != "" && m["field"] != c.field {
				t.Fatalf("field %v, want %s: %v", m["field"], c.field, m)
			}
		})
	}

	// MissingFXRate: как у одиночной записи (400, MISSING_FX_RATE), плюс position_id/ref.
	w, m := doBulk(t, &fakeBulk{err: &repository.AutopriceBulkError{PositionID: apPos, Ref: "m1",
		Err: &calc.MissingFXRateError{Currency: "USD"}}}, abBody(apPos, abWork("w1")))
	if w.Code != http.StatusBadRequest || m["code"] != "MISSING_FX_RATE" || m["position_id"] != apPos || m["ref"] != "m1" {
		t.Fatalf("fx: status %d body %v", w.Code, m)
	}
}

func TestAutopriceBulk_OKResponseAndMapping(t *testing.T) {
	f := &fakeBulk{}
	body := `{"positions":[
		{"position_id":"` + apPos + `","replace":true,"items":[` + abWork("w1") + `,` + abMat("m1", "w1") + `],
		 "review":{"basis":"ASSUMED","pd_refs":["лист 1"],"pd_note":"н"}},
		{"position_id":"` + abPos2 + `","review":null}]}`
	w, m := doBulk(t, f, body)
	if w.Code != http.StatusOK {
		t.Fatalf("status %d body %v", w.Code, m)
	}
	if w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("ответ должен быть no-store")
	}
	data, _ := m["data"].([]any)
	if len(data) != 2 {
		t.Fatalf("data: %v", m)
	}
	p0 := data[0].(map[string]any)
	items := p0["items"].([]any)
	if p0["position_id"] != apPos || len(items) != 2 || items[0].(map[string]any)["ref"] != "w1" ||
		items[1].(map[string]any)["ref"] != "m1" || p0["review"] == nil {
		t.Fatalf("позиция 1: %v", p0)
	}
	for _, k := range []string{"ref", "id", "parent_work_item_id", "quantity", "unit_rate", "total_amount", "updated_at"} {
		if _, ok := items[0].(map[string]any)[k]; !ok {
			t.Fatalf("в строке нет поля %s: %v", k, items[0])
		}
	}
	p1 := data[1].(map[string]any)
	if p1["position_id"] != abPos2 || p1["review"] != nil || len(p1["items"].([]any)) != 0 {
		t.Fatalf("позиция 2: %v", p1)
	}

	// Вход репозитория: порядок, replace, parent_ref, поля, карточка.
	if len(f.got) != 2 || !f.got[0].Replace || f.got[1].Replace || f.got[0].Review == nil || f.got[1].Review != nil {
		t.Fatalf("вход: %+v", f.got)
	}
	got := f.got[0].Items
	if got[0].Ref != "w1" || got[1].ParentRef != "w1" || got[1].Item.BoqItemType != "мат" ||
		got[1].Item.MaterialNameID == nil || *got[1].Item.MaterialNameID != abMatNm ||
		got[0].Item.Quantity == nil || *got[0].Item.Quantity != 2 || got[1].Item.ParentWorkItemID != nil ||
		got[0].Item.ImportSessionID != nil {
		t.Fatalf("строки: %+v", got)
	}
	if rv := f.got[0].Review; rv.Basis == nil || *rv.Basis != "ASSUMED" || string(rv.PdRefs) != `["лист 1"]` {
		t.Fatalf("карточка: %+v", rv)
	}
}
