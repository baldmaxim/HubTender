package handlers

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/domain/user"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// userServicer is the interface MeHandler depends on — makes testing easy.
type userServicer interface {
	GetMe(ctx context.Context, userID string) (*user.User, error)
	GetDeadlineExtensions(ctx context.Context, userID string) (json.RawMessage, error)
	SetMyAccessStatus(ctx context.Context, userID, status string) error
}

// MeHandler serves the /me and /me/permissions endpoints.
type MeHandler struct {
	svc userServicer
}

// NewMeHandler creates a MeHandler backed by the given UserService.
func NewMeHandler(svc userServicer) *MeHandler {
	return &MeHandler{svc: svc}
}

// meResponse is the JSON shape for GET /api/v1/me.
type meResponse struct {
	ID            string   `json:"id"`
	Email         string   `json:"email"`
	FullName      string   `json:"full_name"`
	RoleCode      string   `json:"role_code"`
	RoleName      string   `json:"role_name"`
	RoleColor     string   `json:"role_color"`
	AccessStatus  string   `json:"access_status"`
	AccessEnabled bool     `json:"access_enabled"`
	AllowedPages  []string `json:"allowed_pages"`
}

// permissionsResponse is the JSON shape for GET /api/v1/me/permissions.
type permissionsResponse struct {
	AllowedPages []string `json:"allowed_pages"`
}

// GetMe handles GET /api/v1/me.
func (h *MeHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	u, err := h.svc.GetMe(r.Context(), authUser.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("user not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to load user profile")
		return
	}

	resp := meResponse{
		ID:            u.ID,
		Email:         u.Email,
		FullName:      u.FullName,
		RoleCode:      u.RoleCode,
		RoleName:      u.RoleName,
		RoleColor:     u.RoleColor,
		AccessStatus:  u.AccessStatus,
		AccessEnabled: u.AccessEnabled,
		AllowedPages:  u.AllowedPages,
	}

	renderJSON(w, r, http.StatusOK, resp)
}

// GetPermissions handles GET /api/v1/me/permissions.
func (h *MeHandler) GetPermissions(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	u, err := h.svc.GetMe(r.Context(), authUser.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("user not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to load user profile")
		return
	}

	pages := u.AllowedPages
	if pages == nil {
		pages = []string{}
	}

	renderJSON(w, r, http.StatusOK, permissionsResponse{AllowedPages: pages})
}

// GetDeadlineExtensions handles GET /api/v1/me/deadline-extensions.
// Returns the JWT user's tender_deadline_extensions JSON array.
func (h *MeHandler) GetDeadlineExtensions(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	raw, err := h.svc.GetDeadlineExtensions(r.Context(), authUser.ID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("user not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to load deadline extensions")
		return
	}

	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: raw})
}

// ReapplyAccess handles POST /api/v1/me/reapply-access — sets the calling
// user's access_status to 'pending' (used by Login when a rejected user
// re-submits their access request).
func (h *MeHandler) ReapplyAccess(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	if err := h.svc.SetMyAccessStatus(r.Context(), authUser.ID, "pending"); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to update access status")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// Shared helpers used by all handlers in this package.
// ---------------------------------------------------------------------------

// renderJSON serialises v to JSON, computes an ETag, and handles
// If-None-Match conditional requests (returning 304 when the tag matches).
// Sets Content-Type: application/json and Cache-Control: private, max-age=60
// on all 200 responses.
//
// If the caller already wrote an ETag header (e.g. row-level resources via
// setResourceETag), it is preserved — otherwise the body-hash ETag is used.
// This keeps the If-Match flow consistent: clients echo back exactly what
// the server sent, and the PATCH/DELETE handler compares against the same
// resource ETag it computed at GET time.
func renderJSON(w http.ResponseWriter, r *http.Request, status int, v any) {
	body, err := json.Marshal(v)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "response serialization failed")
		return
	}

	etag := w.Header().Get("ETag")
	if etag == "" {
		etag = computeETag(body)
	}

	if match := r.Header.Get("If-None-Match"); match == etag {
		w.Header().Set("ETag", etag)
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

// computeETag returns the first 16 hex characters of the SHA-256 hash of body.
func computeETag(body []byte) string {
	sum := sha256.Sum256(body)
	return fmt.Sprintf(`"%x"`, sum[:8]) // 16 hex chars, quoted per RFC 7232
}
