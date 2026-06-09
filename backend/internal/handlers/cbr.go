package handlers

import (
	"context"
	"net/http"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/cbr"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// cbrRater is the narrow interface CBRHandler depends on.
type cbrRater interface {
	RatesForDate(ctx context.Context, day time.Time) (*cbr.Rates, error)
}

// CBRHandler serves GET /api/v1/exchange-rates — official CBR daily rates,
// proxied server-side (cbr.ru sets no CORS headers for browser requests).
type CBRHandler struct {
	client cbrRater
}

// NewCBRHandler creates a CBRHandler.
func NewCBRHandler(client cbrRater) *CBRHandler {
	return &CBRHandler{client: client}
}

// GetExchangeRates handles GET /api/v1/exchange-rates?date=YYYY-MM-DD.
// The date is optional and defaults to the server's current day. Returns
// RUB-per-unit rates for USD, EUR and CNY in a {"data": {...}} envelope.
func (h *CBRHandler) GetExchangeRates(w http.ResponseWriter, r *http.Request) {
	day := time.Now()
	if q := r.URL.Query().Get("date"); q != "" {
		parsed, err := time.Parse("2006-01-02", q)
		if err != nil {
			apierr.BadRequest("invalid date: expected YYYY-MM-DD").Render(w)
			return
		}
		day = parsed
	}

	rates, err := h.client.RatesForDate(r.Context(), day)
	if err != nil {
		// Upstream (cbr.ru) failure is not our bug → 502, logged (no Sentry).
		log.Warn().Err(err).Str("date", day.Format("2006-01-02")).Msg("cbr rates fetch failed")
		apierr.New(http.StatusBadGateway, "Bad Gateway", "источник курсов ЦБ РФ недоступен").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rates})
}
