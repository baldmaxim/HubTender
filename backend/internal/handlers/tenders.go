package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// tenderServicer is the interface TenderHandler depends on.
type tenderServicer interface {
	ListTenders(ctx context.Context, userID string, p repository.TenderListParams) ([]repository.TenderRow, error)
	GetTenderOverview(ctx context.Context, tenderID string) (*repository.TenderOverviewRow, error)
}

// TenderHandler serves the /api/v1/tenders/* endpoints.
type TenderHandler struct {
	svc tenderServicer
}

// NewTenderHandler creates a TenderHandler.
func NewTenderHandler(svc tenderServicer) *TenderHandler {
	return &TenderHandler{svc: svc}
}

// tenderListEnvelope is {"data": [...], "next_cursor": "..."}.
type tenderListEnvelope struct {
	Data       []repository.TenderRow `json:"data"`
	NextCursor string                 `json:"next_cursor,omitempty"`
}

// GetTenders handles GET /api/v1/tenders.
// Query params: cursor, limit (1-200), is_archived (true/false),
//               housing_class, search.
func (h *TenderHandler) GetTenders(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	p := repository.TenderListParams{
		HousingClass: q.Get("housing_class"),
		Search:       q.Get("search"),
		Limit:        parseLimitParam(q.Get("limit"), 50),
	}

	if raw := q.Get("is_archived"); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			apierr.BadRequest("is_archived must be true or false").Render(w)
			return
		}
		p.IsArchived = &v
	}

	if cur := q.Get("cursor"); cur != "" {
		ua, id, err := decodeCursor(cur)
		if err != nil {
			apierr.BadRequest("invalid cursor").Render(w)
			return
		}
		p.CursorUpdatedAt = &ua
		p.CursorID = &id
	}

	var userID string
	if u := middleware.UserFromContext(r.Context()); u != nil {
		userID = u.ID
	}

	rows, err := h.svc.ListTenders(r.Context(), userID, p)
	if err != nil {
		apierr.InternalError("failed to list tenders").Render(w)
		return
	}

	if rows == nil {
		rows = []repository.TenderRow{}
	}

	env := tenderListEnvelope{Data: rows}
	if len(rows) == p.Limit {
		last := rows[len(rows)-1]
		env.NextCursor = encodeCursor(last.UpdatedAt, last.ID)
	}

	renderJSON(w, r, http.StatusOK, env)
}

// GetTenderOverview handles GET /api/v1/tenders/:id/overview.
func (h *TenderHandler) GetTenderOverview(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	ov, err := h.svc.GetTenderOverview(r.Context(), tenderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("tender not found").Render(w)
			return
		}
		apierr.InternalError("failed to load tender overview").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: ov})
}

// ---------------------------------------------------------------------------
// Cursor helpers — shared with positions handler via the same package.
// ---------------------------------------------------------------------------

// encodeCursor produces a base64url cursor token from (updated_at, id).
// Format: "<RFC3339Nano>|<uuid>"
func encodeCursor(updatedAt time.Time, id string) string {
	raw := updatedAt.UTC().Format(time.RFC3339Nano) + "|" + id
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeCursor parses a cursor produced by encodeCursor.
func decodeCursor(encoded string) (time.Time, string, error) {
	b, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return time.Time{}, "", fmt.Errorf("base64 decode: %w", err)
	}
	parts := strings.SplitN(string(b), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("invalid cursor format")
	}
	t, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", fmt.Errorf("parse time: %w", err)
	}
	return t, parts[1], nil
}

// parseLimitParam parses the limit query param, falling back to defaultVal.
// Result is clamped to [1, 200].
func parseLimitParam(raw string, defaultVal int) int {
	if raw == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return defaultVal
	}
	if v > 200 {
		return 200
	}
	return v
}
