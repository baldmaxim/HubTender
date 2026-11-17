package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/handlers"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
)

const exportPath = "/api/v1/tender-registry/export"

// fakeRegistryList — сервис перечня: отдаёт заданные строки (или ошибку).
// Остальные методы нужны только для интерфейса веб-хендлера и не вызываются.
type fakeRegistryList struct {
	rows []repository.TenderRegistryRow
	err  error
}

func (f *fakeRegistryList) List(context.Context) ([]repository.TenderRegistryRow, error) {
	return f.rows, f.err
}
func (f *fakeRegistryList) NextSortOrder(context.Context) (int, error) {
	panic("не используется")
}
func (f *fakeRegistryList) Autocomplete(context.Context) ([]repository.AutocompleteRow, error) {
	panic("не используется")
}
func (f *fakeRegistryList) Create(context.Context, repository.TenderRegistryCreateInput) error {
	panic("не используется")
}
func (f *fakeRegistryList) Update(context.Context, string, repository.TenderRegistryUpdateInput) error {
	panic("не используется")
}
func (f *fakeRegistryList) PatchFields(context.Context, string, repository.TenderRegistryPatch) error {
	panic("не используется")
}
func (f *fakeRegistryList) DeleteMany(context.Context, []string) ([]repository.DeletedRegistryRow, error) {
	panic("не используется")
}
func (f *fakeRegistryList) ListTenderStatuses(context.Context) ([]repository.NamedRefRow, error) {
	panic("не используется")
}
func (f *fakeRegistryList) ListConstructionScopes(context.Context) ([]repository.NamedRefRow, error) {
	panic("не используется")
}
func (f *fakeRegistryList) TenderNumbers(context.Context) ([]string, error) {
	panic("не используется")
}
func (f *fakeRegistryList) RelatedTendersByNumbers(context.Context, []string) ([]repository.RelatedTenderRow, error) {
	panic("не используется")
}

func strp(s string) *string { return &s }

// exportRows — строки вперемешку: архивная, «без расчёта» (почти всё null) и
// две с одинаковым sort_order (порядок решает id).
func exportRows() []repository.TenderRegistryRow {
	area := 1234.5
	return []repository.TenderRegistryRow{
		{ID: "bbbbbbbb-0000-0000-0000-000000000002", SortOrder: 5, Title: "Б", ClientName: "К2",
			IsArchived: true, TenderNumber: strp("201"), Area: &area, DashboardStatus: strp("won"),
			Status:            &repository.NamedRefRow{ID: "s1", Name: "Выигран"},
			ConstructionScope: &repository.NamedRefRow{ID: "c1", Name: "Монолит"},
			SubmissionDate:    strp("2026-01-02T00:00:00Z"), UpdatedAt: strp("2026-02-03T04:05:06Z"),
			ObjectCoordinates: strp("1,2"), ManualTotalCost: &area},
		{ID: "cccccccc-0000-0000-0000-000000000003", SortOrder: 1, Title: "В", ClientName: "К3"},
		{ID: "aaaaaaaa-0000-0000-0000-000000000001", SortOrder: 5, Title: "А", ClientName: "К1", ObjectAddress: strp("Алматы")},
	}
}

// exportRouter собирает маршрут как в проде: JWTOrAPIKey с проверкой ключей
// по таблице keys (секрет → принципал), затем гейт маршрута.
func exportRouter(rows []repository.TenderRegistryRow, keys map[string]*middleware.APIKeyPrincipal) *chi.Mux {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.JWTOrAPIKey(middleware.VerifyConfig{}, fakeKeyVerifier(keys)))
		registerRegistryExportRoute(r, handlers.NewTenderRegistryExportHandler(&fakeRegistryList{rows: rows}))
	})
	return r
}

type fakeKeyVerifier map[string]*middleware.APIKeyPrincipal

func (f fakeKeyVerifier) VerifyAPIKey(_ context.Context, secret string) (*middleware.APIKeyPrincipal, *middleware.AuthUser, error) {
	p, ok := f[secret]
	if !ok {
		return nil, nil, errors.New("неизвестный ключ")
	}
	return p, &middleware.AuthUser{ID: "u-1", Role: "engineer"}, nil
}

func callExport(r http.Handler, path, apiKey string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", path, nil)
	if apiKey != "" {
		req.Header.Set(middleware.APIKeyHeader, apiKey)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func TestRegistryExportResponse(t *testing.T) {
	keys := map[string]*middleware.APIKeyPrincipal{
		"read": {ID: "k", Scopes: []string{"registry:read"}},
	}
	rows := exportRows()
	w := callExport(exportRouter(rows, keys), exportPath, "read")
	if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("status %d cache %q: %s", w.Code, w.Header().Get("Cache-Control"), w.Body.String())
	}
	m := decodeMap(t, w)
	data, _ := m["data"].([]any)
	if len(data) != len(rows) {
		t.Fatalf("строк %d, ожидалось %d", len(data), len(rows))
	}

	// порядок: sort_order, затем id
	var gotIDs []string
	for _, d := range data {
		gotIDs = append(gotIDs, d.(map[string]any)["id"].(string))
	}
	wantIDs := []string{rows[1].ID, rows[2].ID, rows[0].ID}
	if gotIDs[0] != wantIDs[0] || gotIDs[1] != wantIDs[1] || gotIDs[2] != wantIDs[2] {
		t.Fatalf("порядок %v, ожидался %v", gotIDs, wantIDs)
	}
	if rows[0].ID != "bbbbbbbb-0000-0000-0000-000000000002" {
		t.Fatal("исходный срез не должен переупорядочиваться")
	}

	wantKeys := []string{"id", "tender_number", "title", "client_name", "object_address", "dashboard_status",
		"status", "is_archived", "construction_scope", "area", "submission_date", "updated_at"}
	for _, d := range data {
		obj := d.(map[string]any)
		if len(obj) != len(wantKeys) {
			t.Fatalf("ключей %d, ожидалось %d: %v", len(obj), len(wantKeys), obj)
		}
		for _, k := range wantKeys {
			if _, ok := obj[k]; !ok {
				t.Fatalf("нет ключа %q: %v", k, obj)
			}
		}
	}

	// «без расчёта»: всё необязательное — null
	bare := data[0].(map[string]any)
	for _, k := range []string{"tender_number", "object_address", "dashboard_status", "status", "construction_scope", "area", "submission_date", "updated_at"} {
		if bare[k] != nil {
			t.Fatalf("%s: ожидался null, получено %v", k, bare[k])
		}
	}
	// архивная строка включена, вложенные status/scope — с id и name
	arch := data[2].(map[string]any)
	status, _ := arch["status"].(map[string]any)
	scope, _ := arch["construction_scope"].(map[string]any)
	if arch["is_archived"] != true || arch["area"] != 1234.5 || status["name"] != "Выигран" || status["id"] != "s1" || scope["name"] != "Монолит" {
		t.Fatalf("архивная строка: %v", arch)
	}
}

func TestRegistryExportEmptyAndError(t *testing.T) {
	keys := map[string]*middleware.APIKeyPrincipal{"read": {ID: "k", Scopes: []string{"registry:read"}}}
	w := callExport(exportRouter(nil, keys), exportPath, "read")
	if w.Code != 200 || w.Body.String() != `{"data":[]}` {
		t.Fatalf("пустой перечень: %d %s", w.Code, w.Body.String())
	}

	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.JWTOrAPIKey(middleware.VerifyConfig{}, fakeKeyVerifier(keys)))
		registerRegistryExportRoute(r, handlers.NewTenderRegistryExportHandler(&fakeRegistryList{err: errors.New("бд недоступна")}))
	})
	if w := callExport(r, exportPath, "read"); w.Code != 500 {
		t.Fatalf("ошибка сервиса: %d %s", w.Code, w.Body.String())
	}
}

func TestRegistryExportGate(t *testing.T) {
	keys := map[string]*middleware.APIKeyPrincipal{
		"read":       {ID: "k", Scopes: []string{"registry:read"}},
		"tendersKey": {ID: "k", Scopes: []string{"tenders:read"}},
		"restricted": {ID: "k", Scopes: []string{"registry:read"},
			AllowedTenderIDs: []string{"11111111-1111-1111-1111-111111111111"}},
	}
	cases := []struct {
		name   string
		key    string
		status int
		code   string
	}{
		{"ключ с registry:read", "read", 200, ""},
		{"без ключа и без JWT", "", 401, ""},
		{"неверный ключ", "wrong", 401, ""},
		{"ключ без registry:read", "tendersKey", 403, "API_KEY_SCOPE_DENIED"},
		{"ключ со списком тендеров", "restricted", 403, "API_KEY_TENDER_DENIED"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := callExport(exportRouter(exportRows(), keys), exportPath, c.key)
			if w.Code != c.status {
				t.Fatalf("status %d, ожидалось %d: %s", w.Code, c.status, w.Body.String())
			}
			if c.code != "" {
				if m := decodeMap(t, w); m["code"] != c.code {
					t.Fatalf("code %v, ожидалось %s: %s", m["code"], c.code, w.Body.String())
				}
			}
		})
	}
}

// Человек с JWT (principal ключа в контексте нет) получает 403 API_KEY_REQUIRED.
func TestRegistryExportRequiresKeyForJWTUser(t *testing.T) {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := context.WithValue(req.Context(), middleware.CtxUser, &middleware.AuthUser{ID: "u-1", Role: "engineer"})
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	registerRegistryExportRoute(r, handlers.NewTenderRegistryExportHandler(&fakeRegistryList{rows: exportRows()}))
	w := callExport(r, exportPath, "")
	if m := decodeMap(t, w); w.Code != 403 || m["code"] != "API_KEY_REQUIRED" {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

// Веб-маршрут перечня и карточка бота живут рядом с /export и не затронуты им.
func TestRegistryExportDoesNotShadowOtherRoutes(t *testing.T) {
	key := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"registry:read", "registry:write"}}
	svc := &fakeRegistryList{rows: exportRows()}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(context.WithValue(req.Context(), middleware.CtxAPIKey, key)))
		})
	})
	r.Get("/api/v1/tender-registry", handlers.NewTenderRegistryHandler(svc).List)
	registerRegistryBotRoutes(r, handlers.NewTenderRegistryBotHandler(&fakeRegistryBot{}))
	registerRegistryExportRoute(r, handlers.NewTenderRegistryExportHandler(svc))

	// веб-список: полная форма строки (есть sort_order, которого нет в выгрузке)
	w := callExport(r, "/api/v1/tender-registry", "")
	data, _ := decodeMap(t, w)["data"].([]any)
	if w.Code != 200 || len(data) != 3 {
		t.Fatalf("веб-список: %d %s", w.Code, w.Body.String())
	}
	if _, ok := data[0].(map[string]any)["sort_order"]; !ok {
		t.Fatalf("в веб-списке нет sort_order: %v", data[0])
	}

	// карточка бота — по-прежнему карточка (message), а не выгрузка
	w = callExport(r, "/api/v1/tender-registry/"+regID+"/card", "")
	card, _ := decodeMap(t, w)["data"].(map[string]any)
	if w.Code != 200 || card["message"] == nil {
		t.Fatalf("карточка: %d %s", w.Code, w.Body.String())
	}

	// выгрузка — именно выгрузка
	w = callExport(r, exportPath, "")
	data, _ = decodeMap(t, w)["data"].([]any)
	if w.Code != 200 || len(data) != 3 {
		t.Fatalf("выгрузка: %d %s", w.Code, w.Body.String())
	}
	if _, ok := data[0].(map[string]any)["sort_order"]; ok {
		t.Fatal("в выгрузке не должно быть sort_order")
	}
}

func decodeMap(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("не JSON: %v: %s", err, w.Body.String())
	}
	return m
}
