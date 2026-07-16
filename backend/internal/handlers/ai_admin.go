package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// AIAdminHandler — этап 2.5: admin-only администрирование OpenRouter
// (/api/v1/admin/ai/*) + user-safe capability endpoint. Admin-гейт —
// middleware.RequireRoles на группе маршрутов (routes.go); handlers ничего
// секретного не возвращают по построению (views сервиса без API key).
type AIAdminHandler struct {
	svc *services.AIAdminService
}

// NewAIAdminHandler creates an AIAdminHandler.
func NewAIAdminHandler(svc *services.AIAdminService) *AIAdminHandler {
	return &AIAdminHandler{svc: svc}
}

// AIAdminRoles — роли с доступом к AI-администрированию (server-side gate).
var AIAdminRoles = map[string]bool{
	"administrator": true,
	"developer":     true,
}

// envelope — конвенция проекта {"data": ...}.
type aiEnvelope struct {
	Data any `json:"data"`
}

// renderAIError — единый маппинг typed domain errors → RFC7807 (§20).
func renderAIError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, services.ErrAIProviderNotConfigured):
		apierr.AIProviderNotConfigured().Render(w)
	case errors.Is(err, services.ErrAICatalogUnavailable):
		apierr.AICatalogUnavailable().Render(w)
	case errors.Is(err, services.ErrAIModelNotAvailable):
		apierr.AIModelNotAvailable().Render(w)
	case errors.Is(err, services.ErrAIModelNotSelected):
		apierr.AIModelNotSelected().Render(w)
	case errors.Is(err, services.ErrAIModelExpired):
		apierr.AIModelExpired().Render(w)
	case errors.Is(err, services.ErrAIModelTestRequired):
		apierr.AIModelTestRequired().Render(w)
	case errors.Is(err, services.ErrAIModelTestFailed):
		apierr.AIModelTestFailed().Render(w)
	case errors.Is(err, services.ErrAIModelConfigChanged):
		apierr.AIModelConfigChanged().Render(w)
	case errors.Is(err, services.ErrAIActivationNotAllowed):
		apierr.AIActivationNotAllowed("").Render(w)
	default:
		apierr.InternalFromErr(w, r, err, "ai administration request failed")
	}
}

// OpenRouterStatus — GET /api/v1/admin/ai/openrouter/status.
func (h *AIAdminHandler) OpenRouterStatus(w http.ResponseWriter, r *http.Request) {
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: h.svc.Status(r.Context())})
}

// OpenRouterTestConnection — POST /api/v1/admin/ai/openrouter/test-connection:
// всегда новый server request к OpenRouter (§8).
func (h *AIAdminHandler) OpenRouterTestConnection(w http.ResponseWriter, r *http.Request) {
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: h.svc.TestConnection(r.Context())})
}

// OpenRouterModels — GET /api/v1/admin/ai/openrouter/models (кэш ≤15 мин).
func (h *AIAdminHandler) OpenRouterModels(w http.ResponseWriter, r *http.Request) {
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: h.svc.Models(r.Context(), false)})
}

// OpenRouterModelsRefresh — POST /api/v1/admin/ai/openrouter/models/refresh.
func (h *AIAdminHandler) OpenRouterModelsRefresh(w http.ResponseWriter, r *http.Request) {
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: h.svc.Models(r.Context(), true)})
}

// GetNomenclatureSettings — GET /api/v1/admin/ai/nomenclature-settings.
func (h *AIAdminHandler) GetNomenclatureSettings(w http.ResponseWriter, r *http.Request) {
	view, err := h.svc.GetSettings(r.Context())
	if err != nil {
		renderAIError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// PutNomenclatureSettings — PUT /api/v1/admin/ai/nomenclature-settings.
// Принимает ТОЛЬКО selected_model_id из server-returned каталога (§9/§18):
// endpoint/prompt/policy/limits через API не изменяются (2.5: read-only).
func (h *AIAdminHandler) PutNomenclatureSettings(w http.ResponseWriter, r *http.Request) {
	var req struct {
		SelectedModelID string `json:"selected_model_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&req); err != nil {
		apierr.BadRequest("некорректное тело запроса").Render(w)
		return
	}
	modelID := strings.TrimSpace(req.SelectedModelID)
	if modelID == "" {
		apierr.BadRequest("selected_model_id обязателен").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	view, err := h.svc.SaveDraft(r.Context(), modelID, authUser.ID)
	if err != nil {
		renderAIError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// TestNomenclatureModel — POST /api/v1/admin/ai/nomenclature/test-model.
// Тело НЕ принимается: тестируется сохранённый draft, prompt и fixtures —
// серверные (§13/§17). Единственный разрешённый live-вызов OpenRouter в 2.5.
func (h *AIAdminHandler) TestNomenclatureModel(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	report, view, err := h.svc.TestModel(r.Context(), authUser.ID)
	if err != nil {
		renderAIError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: map[string]any{
		"report":   report,
		"settings": view,
	}})
}

// ActivateNomenclature — POST /api/v1/admin/ai/nomenclature/activate.
// Model ID из body не принимается — активируется сохранённый tested draft.
func (h *AIAdminHandler) ActivateNomenclature(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	view, err := h.svc.Activate(r.Context(), authUser.ID)
	if err != nil {
		renderAIError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// DeactivateNomenclature — POST /api/v1/admin/ai/nomenclature/deactivate.
func (h *AIAdminHandler) DeactivateNomenclature(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	view, err := h.svc.Deactivate(r.Context(), authUser.ID)
	if err != nil {
		renderAIError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}

// NomenclatureCapability — GET /api/v1/ai/nomenclature-capability:
// любой аутентифицированный пользователь; только безопасное effective
// состояние (§16), без secrets/settings.
func (h *AIAdminHandler) NomenclatureCapability(w http.ResponseWriter, r *http.Request) {
	view, err := h.svc.Capability(r.Context())
	if err != nil {
		renderAIError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: view})
}
