package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// feature/ai-key-ui: управление OpenRouter-ключом из админки.
// Write-only: ключ принимается в теле, никогда не логируется и не
// возвращается; наружу — только configured/suffix/set_at + свежий
// connection-view (авто-проверка нового ключа).

type aiSetKeyRequest struct {
	APIKey string `json:"api_key"`
}

// SetOpenRouterKey — POST /api/v1/admin/ai/openrouter/key.
func (h *AIAdminHandler) SetOpenRouterKey(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	var req aiSetKeyRequest
	// Тело маленькое и секретное: лимит и немедленный decode, без логирования.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	st, err := h.svc.SetAPIKey(r.Context(), req.APIKey, authUser.ID)
	if err != nil {
		switch {
		case errors.Is(err, services.ErrAIKeyInvalid):
			apierr.BadRequest("api key must start with sk-or- and be at least 20 characters").Render(w)
		case errors.Is(err, services.ErrAIKeyCryptoUnavailable):
			apierr.Conflict("key management is not available on this server").Render(w)
		default:
			apierr.InternalFromErr(w, r, err, "failed to save api key")
		}
		return
	}
	// Сразу проверяем подключение новым ключом — UI получает статус одной ходкой.
	view := h.svc.TestConnection(r.Context())
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: map[string]any{
		"key_state":  st,
		"connection": view,
	}})
}

// DeleteOpenRouterKey — DELETE /api/v1/admin/ai/openrouter/key.
func (h *AIAdminHandler) DeleteOpenRouterKey(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	if err := h.svc.ClearAPIKey(r.Context()); err != nil {
		if errors.Is(err, services.ErrAIKeyCryptoUnavailable) {
			apierr.Conflict("key management is not available on this server").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to delete api key")
		return
	}
	view := h.svc.TestConnection(r.Context())
	renderJSON(w, r, http.StatusOK, aiEnvelope{Data: map[string]any{"connection": view}})
}
