package handlers

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// qualityAnalyticsServicer — граница сервиса для handler'а.
type qualityAnalyticsServicer interface {
	TenderQuality(ctx context.Context, tenderID string) (*quality.Report, error)
}

// QualityAnalyticsHandler — GET /api/v1/tenders/{id}/quality (та же auth-политика, что
// у остальных tender-маршрутов: JWTAuth группа).
type QualityAnalyticsHandler struct {
	svc qualityAnalyticsServicer
}

// NewQualityAnalyticsHandler creates a QualityAnalyticsHandler.
func NewQualityAnalyticsHandler(svc qualityAnalyticsServicer) *QualityAnalyticsHandler {
	return &QualityAnalyticsHandler{svc: svc}
}

// TenderQuality отдаёт отчёт качества по одному серверному snapshot.
// Read-only: никаких мутаций/side effects; internal-ошибки не утекают.
func (h *QualityAnalyticsHandler) TenderQuality(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	report, err := h.svc.TenderQuality(r.Context(), tenderID)
	if err != nil {
		if errors.Is(err, repository.ErrQualityTenderNotFound) {
			apierr.NotFound("tender not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to build tender quality report")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: report})
}
