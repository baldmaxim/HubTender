package handlers

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// tenderBriefServicer — зависимость TenderBriefHandler. Отдельный интерфейс,
// а не расширение tenderServicer: тот стабят тесты write-хендлера.
type tenderBriefServicer interface {
	ListTendersBrief(ctx context.Context, p repository.TenderBriefParams) ([]repository.TenderBriefRow, error)
}

// TenderBriefHandler serves GET /api/v1/tenders/brief — узкий список тендеров
// для машинного доступа (выпадающий список в TenderConnector).
type TenderBriefHandler struct {
	svc tenderBriefServicer
}

// NewTenderBriefHandler creates a TenderBriefHandler.
func NewTenderBriefHandler(svc tenderBriefServicer) *TenderBriefHandler {
	return &TenderBriefHandler{svc: svc}
}

type tenderBriefEnvelope struct {
	Data []repository.TenderBriefRow `json:"data"`
}

// List handles GET /api/v1/tenders/brief.
// Query params: is_archived (true/false), search.
//
// Ключ, ограниченный списком тендеров, видит только их: маршрутный гейт без
// id тендера в URL проверяет лишь область, а ограничение применяется здесь
// фильтром выборки. Человек с JWT видит всё.
func (h *TenderBriefHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	p := repository.TenderBriefParams{
		Search: strings.TrimSpace(q.Get("search")),
	}

	if raw := q.Get("is_archived"); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			apierr.BadRequest("is_archived must be true or false").Render(w)
			return
		}
		p.IsArchived = &v
	}

	if k := middleware.APIKeyFromContext(r.Context()); k != nil && len(k.AllowedTenderIDs) > 0 {
		p.IDs = k.AllowedTenderIDs
	}

	rows, err := h.svc.ListTendersBrief(r.Context(), p)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list tenders")
		return
	}
	if rows == nil {
		rows = []repository.TenderBriefRow{}
	}

	renderJSON(w, r, http.StatusOK, tenderBriefEnvelope{Data: rows})
}
