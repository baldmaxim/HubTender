package handlers

// Этап 2.6 (§24-25): rollout admin API — гейты доступа, transition-flow,
// pilot allowlist, redaction capability. Через chi router + RequireRoles +
// реальный сервис (fake store + fake OpenRouter).

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

// newRolloutRouter — router с rollout-маршрутами этапа 2.6.
func newRolloutRouter(t *testing.T) (http.Handler, func(role string, req *http.Request) *http.Request) {
	t.Helper()
	r, inject := newAIAdminRouter(t)
	// newAIAdminRouter уже регистрирует 2.5-маршруты; добавляем 2.6 нельзя в
	// готовый chi после использования — поэтому маршруты 2.6 регистрируются
	// в самом newAIAdminRouter (см. правку ниже). Здесь — просто алиас.
	return r, inject
}

// Полный happy-path: off→evaluation→(live eval)→pilot_individual через HTTP;
// non-admin отовсюду 403; capability отражает пилота и не течёт секретами.
func TestAIRolloutEndpointsFlow(t *testing.T) {
	r, inject := newRolloutRouter(t)

	// Non-admin — 403 на все rollout-маршруты (§25.X).
	rolloutEndpoints := []struct{ m, p string }{
		{"GET", "/api/v1/admin/ai/nomenclature/rollout"},
		{"PUT", "/api/v1/admin/ai/nomenclature/rollout/settings"},
		{"POST", "/api/v1/admin/ai/nomenclature/rollout/transition"},
		{"POST", "/api/v1/admin/ai/nomenclature/rollout/emergency-off"},
		{"GET", "/api/v1/admin/ai/nomenclature/pilot-users"},
		{"POST", "/api/v1/admin/ai/nomenclature/pilot-users"},
		{"GET", "/api/v1/admin/ai/nomenclature/usage"},
		{"GET", "/api/v1/admin/ai/nomenclature/evaluations"},
		{"POST", "/api/v1/admin/ai/nomenclature/evaluate"},
		{"POST", "/api/v1/admin/ai/nomenclature/circuit/reset"},
	}
	for _, ep := range rolloutEndpoints {
		rec := doReq(t, r, inject, "engineer", ep.m, ep.p, "")
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s %s engineer: %d, want 403", ep.m, ep.p, rec.Code)
		}
	}

	// Готовим конфигурацию 2.5: модель + тест.
	_ = doReq(t, r, inject, "administrator", "GET", "/api/v1/admin/ai/openrouter/models", "")
	_ = doReq(t, r, inject, "administrator", "PUT", "/api/v1/admin/ai/nomenclature-settings", `{"selected_model_id":"prov/alpha"}`)
	if rec := doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/test-model", ""); rec.Code != 200 {
		t.Fatalf("test-model: %d %s", rec.Code, rec.Body.String())
	}

	// Rollout по умолчанию off.
	rec := doReq(t, r, inject, "administrator", "GET", "/api/v1/admin/ai/nomenclature/rollout", "")
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"rollout_mode":"off"`) {
		t.Fatalf("rollout state: %d %s", rec.Code, rec.Body.String())
	}

	// off→pilot_individual напрямую — недопустимый переход.
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/rollout/transition",
		`{"target":"pilot_individual","confirmation":"pilot_individual"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "AI_ROLLOUT_TRANSITION_INVALID") {
		t.Fatalf("off→pilot: %d %s", rec.Code, rec.Body.String())
	}

	// off→evaluation.
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/rollout/transition",
		`{"target":"evaluation","confirmation":"evaluation"}`)
	if rec.Code != 200 {
		t.Fatalf("→evaluation: %d %s", rec.Code, rec.Body.String())
	}

	// Live evaluation через endpoint (fake provider, live-флаг сервиса).
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/evaluate",
		`{"mode":"live","confirm_live_provider_cost":true}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"gates_passed":true`) {
		t.Fatalf("evaluate: %d %s", rec.Code, rec.Body.String())
	}

	// Пилот + бюджет.
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/pilot-users",
		`{"user_id":"pilot-http-1","bulk_confirmation_allowed":false}`)
	if rec.Code != 200 {
		t.Fatalf("pilot add: %d %s", rec.Code, rec.Body.String())
	}
	// Самодобавление запрещено (§6.7): admin id из inject = фиксированный UUID.
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/pilot-users",
		`{"user_id":"0b6a2d0e-8f4e-4f7a-9a3e-1b2c3d4e5f60"}`)
	if rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "AI_PILOT_SELF_ADD_FORBIDDEN") {
		t.Fatalf("self-add: %d %s", rec.Code, rec.Body.String())
	}
	rec = doReq(t, r, inject, "administrator", "PUT", "/api/v1/admin/ai/nomenclature/rollout/settings",
		`{"monthly_budget_usd":"25.00"}`)
	if rec.Code != 200 {
		t.Fatalf("settings: %d %s", rec.Code, rec.Body.String())
	}

	// evaluation→pilot_individual (все гейты).
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/rollout/transition",
		`{"target":"pilot_individual","confirmation":"pilot_individual"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"rollout_mode":"pilot_individual"`) {
		t.Fatalf("→pilot_individual: %d %s", rec.Code, rec.Body.String())
	}

	// Capability пилота: is_pilot=true, без секретов/allowlist/ledger (§25.Y).
	pilotInject := func(role string, req *http.Request) *http.Request {
		return injectAs(req, "pilot-http-1", role)
	}
	rec = doReq(t, r, pilotInject, "engineer", "GET", "/api/v1/ai/nomenclature-capability", "")
	if rec.Code != 200 {
		t.Fatalf("capability: %d", rec.Code)
	}
	var env struct {
		Data map[string]any `json:"data"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Data["is_pilot"] != true || env.Data["status"] != "available" {
		t.Fatalf("pilot capability: %v", env.Data)
	}
	for _, forbidden := range []string{"pilot_users", "allowlist", "ledger", "api_key", "config_hash", "reservation"} {
		if _, ok := env.Data[forbidden]; ok {
			t.Fatalf("capability must not expose %q", forbidden)
		}
	}
	body := rec.Body.String()
	if strings.Contains(body, testAPIKey) {
		t.Fatal("capability leaked API key")
	}

	// Non-pilot capability: not_allowed.
	rec = doReq(t, r, inject, "engineer", "GET", "/api/v1/ai/nomenclature-capability", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Data["status"] != "not_allowed" || env.Data["is_pilot"] != false {
		t.Fatalf("non-pilot capability: %v", env.Data)
	}

	// Emergency off — без гейтов, мгновенно.
	rec = doReq(t, r, inject, "administrator", "POST", "/api/v1/admin/ai/nomenclature/rollout/emergency-off",
		`{"reason":"test"}`)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"rollout_mode":"off"`) {
		t.Fatalf("emergency off: %d %s", rec.Code, rec.Body.String())
	}
	rec = doReq(t, r, pilotInject, "engineer", "GET", "/api/v1/ai/nomenclature-capability", "")
	_ = json.Unmarshal(rec.Body.Bytes(), &env)
	if env.Data["status"] != "rollout_off" {
		t.Fatalf("after emergency off: %v", env.Data)
	}
}
