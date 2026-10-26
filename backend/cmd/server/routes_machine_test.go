package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/handlers"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/notify/telegram"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
)

const regID = "0f8fad5b-d9cb-469f-a165-70867728950e"

type fakeRegistryBot struct {
	appendErr error
	created   bool
}

func (f *fakeRegistryBot) Search(context.Context, string) (*services.RegistrySearchResult, error) {
	return &services.RegistrySearchResult{Query: "ода", Items: []services.RegistryTenderBrief{},
		Message: telegram.Payload("не нашёл", nil)}, nil
}
func (f *fakeRegistryBot) Card(_ context.Context, id string) (*services.RegistryCard, error) {
	if id != regID {
		return nil, repository.ErrTenderRegistryNotFound
	}
	return &services.RegistryCard{Tender: services.RegistryTenderBrief{ID: id},
		Message: telegram.Payload("карточка", [][]telegram.InlineButton{{{Text: "x", CallbackData: "tc:" + id}}})}, nil
}
func (f *fakeRegistryBot) ClaimReminders(_ context.Context, chatID int64) (*services.RegistryReminders, error) {
	if chatID == 0 {
		return nil, &services.RegistryInputError{Reason: "chat_id: нужен id чата"}
	}
	return &services.RegistryReminders{Items: []services.RegistryReminder{}}, nil
}
func (f *fakeRegistryBot) AppendChronology(context.Context, string, string, string, string) (*services.RegistryChronologyResult, error) {
	if f.appendErr != nil {
		return nil, f.appendErr
	}
	return &services.RegistryChronologyResult{Created: f.created, Title: "ЖК"}, nil
}

// registryRouter — маршруты перечня; principal — ключ запроса (nil — человек с JWT).
func registryRouter(bot *fakeRegistryBot, principal *middleware.APIKeyPrincipal) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if principal != nil {
				req = req.WithContext(context.WithValue(req.Context(), middleware.CtxAPIKey, principal))
			}
			next.ServeHTTP(w, req)
		})
	})
	registerRegistryBotRoutes(r, handlers.NewTenderRegistryBotHandler(bot))
	return r
}

func callRegistry(t *testing.T, r http.Handler, method, path, body string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var m map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &m)
	return w, m
}

func TestRegistryRoutesGate(t *testing.T) {
	both := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"registry:read", "registry:write"}}
	readOnly := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"registry:read"}}
	tendersOnly := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"tenders:read", "tenders:write"}}
	restricted := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"registry:read", "registry:write"},
		AllowedTenderIDs: []string{"11111111-1111-1111-1111-111111111111"}}
	search, claim := "/api/v1/tender-registry/search?q=ода", "/api/v1/tender-registry/reminders/claim"
	cases := []struct {
		name      string
		principal *middleware.APIKeyPrincipal
		method    string
		path      string
		status    int
		code      string
	}{
		{"человек с JWT", nil, "GET", search, 403, "API_KEY_REQUIRED"},
		{"ключ с обеими областями — поиск", both, "GET", search, 200, ""},
		{"ключ с обеими областями — выдача", both, "POST", claim, 200, ""},
		{"ключ на чтение — поиск", readOnly, "GET", search, 200, ""},
		{"ключ на чтение — выдача", readOnly, "POST", claim, 403, "API_KEY_SCOPE_DENIED"},
		{"ключ тендеров", tendersOnly, "GET", search, 403, "API_KEY_SCOPE_DENIED"},
		{"ключ со списком тендеров", restricted, "GET", search, 403, "API_KEY_TENDER_DENIED"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, m := callRegistry(t, registryRouter(&fakeRegistryBot{}, c.principal), c.method, c.path, `{"chat_id":-100}`)
			if w.Code != c.status || (c.code != "" && m["code"] != c.code) {
				t.Fatalf("status %d code %v, ожидалось %d %s: %s", w.Code, m["code"], c.status, c.code, w.Body.String())
			}
		})
	}
}

func TestRegistryHandlerResponses(t *testing.T) {
	key := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"registry:read", "registry:write"}}
	chronology := "/api/v1/tender-registry/" + regID + "/chronology"
	body := `{"text":"Позвонили","type":"call_follow_up","date":"2026-09-30T09:00:00Z"}`

	w, m := callRegistry(t, registryRouter(&fakeRegistryBot{}, key), "GET", "/api/v1/tender-registry/search?q=ода", "")
	data, _ := m["data"].(map[string]any)
	msg, _ := data["message"].(map[string]any)
	if w.Header().Get("Cache-Control") != "no-store" || msg["parse_mode"] != "HTML" || data["items"] == nil {
		t.Fatalf("ответ поиска: %s %s", w.Header().Get("Cache-Control"), w.Body.String())
	}
	if _, ok := msg["reply_markup"]; ok {
		t.Fatal("reply_markup без кнопок должен опускаться")
	}

	w, m = callRegistry(t, registryRouter(&fakeRegistryBot{}, key), "GET", "/api/v1/tender-registry/"+regID+"/card", "")
	if data, _ := m["data"].(map[string]any); w.Code != 200 || data["message"].(map[string]any)["reply_markup"] == nil {
		t.Fatalf("карточка: %d %s", w.Code, w.Body.String())
	}
	cases := []struct {
		name   string
		bot    *fakeRegistryBot
		method string
		path   string
		body   string
		status int
		code   string
	}{
		{"карточка: не uuid", &fakeRegistryBot{}, "GET", "/api/v1/tender-registry/abc/card", "", 400, "REGISTRY_INVALID_REQUEST"},
		{"карточка: нет тендера", &fakeRegistryBot{}, "GET", "/api/v1/tender-registry/1f8fad5b-d9cb-469f-a165-70867728950e/card", "", 404, "REGISTRY_NOT_FOUND"},
		{"выдача: битое тело", &fakeRegistryBot{}, "POST", "/api/v1/tender-registry/reminders/claim", "chat=1", 400, "REGISTRY_INVALID_REQUEST"},
		{"выдача: без chat_id", &fakeRegistryBot{}, "POST", "/api/v1/tender-registry/reminders/claim", "{}", 400, "REGISTRY_INVALID_REQUEST"},
		{"запись: новая", &fakeRegistryBot{created: true}, "POST", chronology, body, 201, ""},
		{"запись: повтор", &fakeRegistryBot{}, "POST", chronology, body, 200, ""},
		{"запись: неверный ввод", &fakeRegistryBot{appendErr: &services.RegistryInputError{Reason: "text"}}, "POST", chronology, body, 400, "REGISTRY_INVALID_REQUEST"},
		{"запись: нет тендера", &fakeRegistryBot{appendErr: repository.ErrTenderRegistryNotFound}, "POST", chronology, body, 404, "REGISTRY_NOT_FOUND"},
		{"запись: тело больше 64 КБ", &fakeRegistryBot{}, "POST", chronology, `{"text":"` + strings.Repeat("я", 40000) + `"}`, 400, "REGISTRY_INVALID_REQUEST"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, m := callRegistry(t, registryRouter(c.bot, key), c.method, c.path, c.body)
			if w.Code != c.status || (c.code != "" && m["code"] != c.code) {
				t.Fatalf("status %d code %v, ожидалось %d %s: %.300s", w.Code, m["code"], c.status, c.code, w.Body.String())
			}
		})
	}
}

type fakeVerificationBot struct{ resultErr error }

func (f *fakeVerificationBot) HandleUpdate(context.Context, telegram.Update) ([]services.BotAction, error) {
	return []services.BotAction{}, nil
}
func (f *fakeVerificationBot) Claim(_ context.Context, name string, _ int) ([]services.BotOutMessage, error) {
	if name == "bad" {
		return nil, services.ErrBotUsernameInvalid
	}
	return []services.BotOutMessage{}, nil
}
func (f *fakeVerificationBot) ReportResult(context.Context, string, services.SendResult) (string, error) {
	if f.resultErr != nil {
		return "", f.resultErr
	}
	return "sent", nil
}

func verificationBotRouter(bot *fakeVerificationBot, principal *middleware.APIKeyPrincipal) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if principal != nil {
				req = req.WithContext(context.WithValue(req.Context(), middleware.CtxAPIKey, principal))
			}
			next.ServeHTTP(w, req)
		})
	})
	registerVerificationBotRoutes(r, handlers.NewVerificationBotHandler(bot))
	return r
}

func TestVerificationBotRoutesGate(t *testing.T) {
	bot := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:telegram"}}
	other := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:read", "verification:write", "registry:write"}}
	restricted := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:telegram"},
		AllowedTenderIDs: []string{"11111111-1111-1111-1111-111111111111"}}
	paths := []struct{ name, path, body string }{
		{"updates", "/api/v1/verification-bot/updates", `{"update":{"update_id":1}}`},
		{"claim", "/api/v1/verification-bot/claim", `{"bot_username":"hub_bot"}`},
		{"result", "/api/v1/verification-bot/notifications/" + regID + "/result", `{"ok":true,"message_id":7}`},
	}
	cases := []struct {
		name      string
		principal *middleware.APIKeyPrincipal
		status    int
		code      string
	}{
		{"человек с JWT", nil, 403, "API_KEY_REQUIRED"},
		{"ключ без области", other, 403, "API_KEY_SCOPE_DENIED"},
		{"ключ со списком тендеров", restricted, 403, "API_KEY_TENDER_DENIED"},
		{"ключ с областью", bot, 200, ""},
	}
	for _, p := range paths {
		for _, c := range cases {
			t.Run(p.name+": "+c.name, func(t *testing.T) {
				w, m := callRegistry(t, verificationBotRouter(&fakeVerificationBot{}, c.principal), "POST", p.path, p.body)
				if w.Code != c.status || (c.code != "" && m["code"] != c.code) {
					t.Fatalf("status %d code %v, ожидалось %d %s: %.300s", w.Code, m["code"], c.status, c.code, w.Body.String())
				}
			})
		}
	}
}

func TestVerificationBotHandlerResponses(t *testing.T) {
	key := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:telegram"}}
	result := "/api/v1/verification-bot/notifications/" + regID + "/result"
	cases := []struct {
		name   string
		bot    *fakeVerificationBot
		path   string
		body   string
		status int
		code   string
	}{
		{"updates: без update", &fakeVerificationBot{}, "/api/v1/verification-bot/updates", `{}`, 400, "VERIFICATION_BOT_INVALID_REQUEST"},
		{"updates: битое тело", &fakeVerificationBot{}, "/api/v1/verification-bot/updates", `x`, 400, "VERIFICATION_BOT_INVALID_REQUEST"},
		{"claim: плохое имя", &fakeVerificationBot{}, "/api/v1/verification-bot/claim", `{"bot_username":"bad"}`, 400, "VERIFICATION_BOT_INVALID_REQUEST"},
		{"result: не uuid", &fakeVerificationBot{}, "/api/v1/verification-bot/notifications/abc/result", `{}`, 400, "VERIFICATION_BOT_INVALID_REQUEST"},
		{"result: нет сообщения", &fakeVerificationBot{resultErr: repository.ErrNotificationNotFound}, result, `{"ok":true}`, 404, "VERIFICATION_BOT_NOT_FOUND"},
		{"result: тело больше 64 КБ", &fakeVerificationBot{}, result, `{"description":"` + strings.Repeat("я", 40000) + `"}`, 400, "VERIFICATION_BOT_INVALID_REQUEST"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, m := callRegistry(t, verificationBotRouter(c.bot, key), "POST", c.path, c.body)
			if w.Code != c.status || (c.code != "" && m["code"] != c.code) {
				t.Fatalf("status %d code %v, ожидалось %d %s: %.300s", w.Code, m["code"], c.status, c.code, w.Body.String())
			}
		})
	}

	w, m := callRegistry(t, verificationBotRouter(&fakeVerificationBot{}, key), "POST", "/api/v1/verification-bot/claim", `{"bot_username":"hub_bot"}`)
	if data, _ := m["data"].(map[string]any); w.Header().Get("Cache-Control") != "no-store" || data["messages"] == nil {
		t.Fatalf("claim: %s", w.Body.String())
	}
	_, m = callRegistry(t, verificationBotRouter(&fakeVerificationBot{}, key), "POST", result, `{"ok":true}`)
	if data, _ := m["data"].(map[string]any); data["status"] != "sent" {
		t.Fatalf("result: %v", m)
	}
}

type fakeVerificationAI struct{ saved int }

func (f *fakeVerificationAI) Settings(context.Context) (*services.VerificationAISettingsView, error) {
	return nil, nil
}
func (f *fakeVerificationAI) SaveSettings(context.Context, repository.VerificationAISettings, *string) (*services.VerificationAISettingsView, error) {
	return nil, nil
}
func (f *fakeVerificationAI) TestModel(context.Context, *string) (*services.AITestResult, error) {
	return nil, nil
}
func (f *fakeVerificationAI) StartManual(context.Context, string, *string) (string, error) {
	return services.AITriageStarted, nil
}
func (f *fakeVerificationAI) Assessments(context.Context, string) (*services.TenderAssessments, error) {
	return &services.TenderAssessments{Assessments: []repository.AIAssessmentView{}}, nil
}
func (f *fakeVerificationAI) SaveExternalAssessments(context.Context, string, string, string, []services.ExternalAssessment) (*services.ExternalAssessmentsResult, error) {
	return &services.ExternalAssessmentsResult{Saved: f.saved}, nil
}

func verificationAIRouter(principal *middleware.APIKeyPrincipal) *chi.Mux {
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if principal != nil {
				req = req.WithContext(context.WithValue(req.Context(), middleware.CtxAPIKey, principal))
			}
			next.ServeHTTP(w, req)
		})
	})
	registerVerificationAIRoutes(r, handlers.NewVerificationAIHandler(&fakeVerificationAI{saved: 1}, nil))
	return r
}

// POST ai-assessments — действие проверяющего: нужна область verification:write,
// ключ только на чтение получает 403; GET тех же оценок читается и с read.
func TestVerificationAIAssessmentsRouteGate(t *testing.T) {
	read := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:read"}}
	write := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:write"}}
	restricted := &middleware.APIKeyPrincipal{ID: "k", Scopes: []string{"verification:write"},
		AllowedTenderIDs: []string{"11111111-1111-1111-1111-111111111111"}}
	path := "/api/v1/tenders/" + regID + "/verification/ai-assessments"
	body := `{"model_id":"m","prompt_version":"ext:v1","items":[{"finding_id":"` + regID + `","fingerprint":"fp","label":"unsure"}]}`
	cases := []struct {
		name      string
		principal *middleware.APIKeyPrincipal
		method    string
		status    int
		code      string
	}{
		{"POST: человек с JWT", nil, "POST", 200, ""},
		{"POST: ключ только на чтение", read, "POST", 403, "API_KEY_SCOPE_DENIED"},
		{"POST: ключ на запись", write, "POST", 200, ""},
		{"POST: ключ со списком тендеров без этого", restricted, "POST", 403, "API_KEY_TENDER_DENIED"},
		{"GET: ключ на чтение", read, "GET", 200, ""},
		{"GET: ключ только на запись", write, "GET", 403, "API_KEY_SCOPE_DENIED"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w, m := callRegistry(t, verificationAIRouter(c.principal), c.method, path, body)
			if w.Code != c.status || (c.code != "" && m["code"] != c.code) {
				t.Fatalf("status %d code %v, ожидалось %d %s: %.300s", w.Code, m["code"], c.status, c.code, w.Body.String())
			}
		})
	}
}
