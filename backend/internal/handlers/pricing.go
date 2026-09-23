package handlers

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/mcpauth"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/pricing"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type PricingHandler struct{ svc *services.PricingService }

func NewPricingHandler(svc *services.PricingService) *PricingHandler {
	return &PricingHandler{svc: svc}
}

func (h *PricingHandler) GetState(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	limit := parseLimitParam(r.URL.Query().Get("limit"), 50)
	offset := parseOffset(r.URL.Query().Get("offset"))
	out, err := h.svc.GetPricingState(r.Context(), p, chi.URLParam(r, "id"), limit, offset)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to load pricing state")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

func (h *PricingHandler) ListDrafts(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	tenderID := r.URL.Query().Get("tender_id")
	if tenderID == "" {
		apierr.BadRequest("tender_id required").Render(w)
		return
	}
	rows, page, err := h.svc.ListDrafts(r.Context(), p, tenderID, parseLimitParam(r.URL.Query().Get("limit"), 20), parseOffset(r.URL.Query().Get("offset")))
	if err != nil {
		renderPricingError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, map[string]any{"data": rows, "pagination": page})
}

func (h *PricingHandler) GetDraft(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	out, err := h.svc.GetDraft(r.Context(), p, chi.URLParam(r, "id"))
	if err != nil {
		renderPricingError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

func (h *PricingHandler) ValidateDraft(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	out, err := h.svc.ValidateDraft(r.Context(), p, chi.URLParam(r, "id"))
	if err != nil {
		renderPricingError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

type applyPricingDraftReq struct {
	ValidationHash string `json:"validation_hash"`
	Confirm        bool   `json:"confirm"`
}

func (h *PricingHandler) ApplyDraft(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	var req applyPricingDraftReq
	if err := decodePricingJSON(r, &req); err != nil || req.ValidationHash == "" || !req.Confirm {
		apierr.BadRequest("validation_hash and confirm=true are required").Render(w)
		return
	}
	out, err := h.svc.ApplyDraft(r.Context(), p, chi.URLParam(r, "id"), req.ValidationHash)
	if err != nil {
		renderPricingError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

func (h *PricingHandler) CancelDraft(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	if err := h.svc.CancelDraft(r.Context(), p, chi.URLParam(r, "id")); err != nil {
		renderPricingError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *PricingHandler) QAReport(w http.ResponseWriter, r *http.Request) {
	p, ok := portalPrincipal(r)
	if !ok {
		apierr.Unauthorized("authentication required").Render(w)
		return
	}
	out, err := h.svc.QAReport(r.Context(), p, chi.URLParam(r, "id"))
	if err != nil {
		renderPricingError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: out})
}

func portalPrincipal(r *http.Request) (pricing.Principal, bool) {
	u := middleware.UserFromContext(r.Context())
	if u == nil {
		return pricing.Principal{}, false
	}
	return pricing.Principal{UserID: u.ID, Email: u.Email, RoleCode: u.Role, Scopes: mcpauth.AllScopes}, true
}
func parseOffset(raw string) int {
	n, _ := strconv.Atoi(raw)
	if n < 0 {
		return 0
	}
	return n
}
func decodePricingJSON(r *http.Request, dst any) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, 128*1024))
	dec.DisallowUnknownFields()
	return dec.Decode(dst)
}
func renderPricingError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, services.ErrPricingForbidden), errors.Is(err, services.ErrDraftOwnership):
		apierr.Forbidden("pricing access denied").Render(w)
	case errors.Is(err, services.ErrPricingDisabled):
		(&apierr.Problem{Status: http.StatusServiceUnavailable, Title: "Pricing writes disabled", Detail: "Enable MCP_WRITE_ENABLED only after staging verification"}).Render(w)
	case errors.Is(err, repository.ErrDraftStale), errors.Is(err, repository.ErrDraftHashMismatch), errors.Is(err, repository.ErrDraftNotEditable):
		(&apierr.Problem{Status: http.StatusConflict, Title: "Pricing draft conflict", Detail: err.Error()}).Render(w)
	case errors.Is(err, services.ErrInvalidPricingInput):
		apierr.BadRequest(err.Error()).Render(w)
	default:
		apierr.InternalFromErr(w, r, err, "pricing operation failed")
	}
}
