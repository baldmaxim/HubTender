package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type telegramLinkServicer interface {
	Status(ctx context.Context, userID string) (*services.TelegramStatus, error)
	CreateLink(ctx context.Context, userID string) (*services.TelegramLinkToken, error)
	Unlink(ctx context.Context, userID string) error
}

type dispatchServicer interface {
	Preview(ctx context.Context, tenderID string, ids []string, sender string) ([]repository.DispatchRecipient, error)
	Dispatch(ctx context.Context, tenderID string, ids []string, sender string) (*repository.DispatchResult, error)
}

// TelegramHandler — привязка Telegram и рассылка замечаний проверки.
type TelegramHandler struct {
	links    telegramLinkServicer
	dispatch dispatchServicer
}

func NewTelegramHandler(links telegramLinkServicer, dispatch dispatchServicer) *TelegramHandler {
	return &TelegramHandler{links: links, dispatch: dispatch}
}

func telegramUser(w http.ResponseWriter, r *http.Request) *middleware.AuthUser {
	u := middleware.UserFromContext(r.Context())
	if u == nil {
		apierr.Unauthorized("missing auth context").Render(w)
	}
	return u
}

// GetStatus handles GET /api/v1/me/telegram.
func (h *TelegramHandler) GetStatus(w http.ResponseWriter, r *http.Request) {
	u := telegramUser(w, r)
	if u == nil {
		return
	}
	st, err := h.links.Status(r.Context(), u.ID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "telegram status failed")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: st})
}

// PostLink handles POST /api/v1/me/telegram/link — одноразовая ссылка на бота.
func (h *TelegramHandler) PostLink(w http.ResponseWriter, r *http.Request) {
	u := telegramUser(w, r)
	if u == nil {
		return
	}
	tok, err := h.links.CreateLink(r.Context(), u.ID)
	switch {
	case errors.Is(err, services.ErrTelegramDisabled):
		apierr.ServiceUnavailable("Telegram-бот не настроен").Render(w)
	case err != nil:
		apierr.InternalFromErr(w, r, err, "telegram link failed")
	default:
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: tok})
	}
}

// DeleteLink handles DELETE /api/v1/me/telegram.
func (h *TelegramHandler) DeleteLink(w http.ResponseWriter, r *http.Request) {
	u := telegramUser(w, r)
	if u == nil {
		return
	}
	if err := h.links.Unlink(r.Context(), u.ID); err != nil {
		apierr.InternalFromErr(w, r, err, "telegram unlink failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type dispatchRequest struct {
	FindingIDs []string `json:"finding_ids"`
}

func (h *TelegramHandler) decodeDispatch(w http.ResponseWriter, r *http.Request) (*middleware.AuthUser, string, []string, bool) {
	u := telegramUser(w, r)
	if u == nil {
		return nil, "", nil, false
	}
	var req dispatchRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return nil, "", nil, false
	}
	if len(req.FindingIDs) == 0 {
		apierr.BadRequest("finding_ids пуст").Render(w)
		return nil, "", nil, false
	}
	for _, id := range req.FindingIDs {
		if !uuidPatchRe.MatchString(id) {
			apierr.BadRequest("finding_ids: ожидаются uuid").Render(w)
			return nil, "", nil, false
		}
	}
	return u, chi.URLParam(r, "id"), req.FindingIDs, true
}

func renderDispatchErr(w http.ResponseWriter, r *http.Request, err error, tenderID string) {
	switch {
	case errors.Is(err, services.ErrTelegramDisabled):
		apierr.ServiceUnavailable("Telegram-бот не настроен").Render(w)
	case errors.Is(err, services.ErrDispatchTooMany):
		apierr.BadRequest("за одну отправку — не больше 500 находок").Render(w)
	case errors.Is(err, repository.ErrDispatchEmpty):
		apierr.Conflict("среди выбранных нет открытых находок — перепроверьте тендер").Render(w)
	default:
		apierr.InternalFromErr(w, r, err, "verification dispatch failed", "tender_id", tenderID)
	}
}

// PostPreview handles POST /api/v1/tenders/{id}/verification/dispatch/preview.
func (h *TelegramHandler) PostPreview(w http.ResponseWriter, r *http.Request) {
	u, tenderID, ids, ok := h.decodeDispatch(w, r)
	if !ok {
		return
	}
	recs, err := h.dispatch.Preview(r.Context(), tenderID, ids, u.ID)
	if err != nil {
		renderDispatchErr(w, r, err, tenderID)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: recs})
}

// PostDispatch handles POST /api/v1/tenders/{id}/verification/dispatch.
func (h *TelegramHandler) PostDispatch(w http.ResponseWriter, r *http.Request) {
	u, tenderID, ids, ok := h.decodeDispatch(w, r)
	if !ok {
		return
	}
	res, err := h.dispatch.Dispatch(r.Context(), tenderID, ids, u.ID)
	if err != nil {
		renderDispatchErr(w, r, err, tenderID)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}
