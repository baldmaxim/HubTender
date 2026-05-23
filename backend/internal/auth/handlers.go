package auth

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/rs/zerolog/log"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Handler exposes the HTTP layer for the app-auth package — login, refresh,
// logout, me, plus the JWKS endpoint. The middleware that protects /me /
// /logout is wired up in main.go (so we don't import the middleware package
// from inside the handler unnecessarily — we just read the AuthUser the
// middleware attached to the request).
type Handler struct {
	svc *Service
}

// NewHandler creates a Handler wired to a Service.
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// ---------------------------------------------------------------------------
// POST /api/v1/auth/login
// ---------------------------------------------------------------------------

// Login handles POST /api/v1/auth/login. Maps domain errors to HTTP codes:
//
//	ErrInvalidCredentials -> 401 invalid_credentials
//	ErrUserBlocked        -> 403 access_blocked
//	anything else         -> 500
//
// On success returns AuthResult with both tokens. The plaintext refresh
// token leaves the server here and only here.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	defer r.Body.Close() //nolint:errcheck

	sess := sessionFromRequest(r)

	result, err := h.svc.Login(r.Context(), req.Email, req.Password, sess)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredentials):
			apierr.Unauthorized("invalid credentials").Render(w)
		case errors.Is(err, ErrUserBlocked):
			apierr.Forbidden("account access disabled").Render(w)
		default:
			log.Error().Err(err).Msg("auth: login failed unexpectedly")
			apierr.InternalError("login failed").Render(w)
		}
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/register
// ---------------------------------------------------------------------------

// Register handles POST /api/v1/auth/register. Public route (no Bearer).
// Maps domain errors to HTTP codes:
//
//	ErrInvalidEmail / ErrFullNameRequired / ErrPasswordTooShort -> 400
//	ErrEmailAlreadyExists                                      -> 409
//	anything else                                              -> 500
//
// On success returns 201 Created with {user_id, email, access_status}.
// We deliberately do NOT issue tokens here: fresh users land in
// access_status="pending" and must wait for admin approval before login.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	defer r.Body.Close() //nolint:errcheck

	sess := sessionFromRequest(r)
	result, err := h.svc.Register(r.Context(), req, sess)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidEmail):
			apierr.BadRequest("invalid email").Render(w)
		case errors.Is(err, ErrFullNameRequired):
			apierr.BadRequest("full_name is required").Render(w)
		case errors.Is(err, ErrPasswordTooShort):
			apierr.BadRequest("password too short (min 6 chars)").Render(w)
		case errors.Is(err, ErrEmailAlreadyExists):
			apierr.Conflict("email already registered").Render(w)
		default:
			log.Error().Err(err).Msg("auth: register failed unexpectedly")
			apierr.InternalError("registration failed").Render(w)
		}
		return
	}

	writeJSON(w, http.StatusCreated, result)
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/refresh
// ---------------------------------------------------------------------------

// Refresh handles POST /api/v1/auth/refresh. Notable mapping:
//
//	ErrRefreshNotFound / ErrRefreshExpired / ErrRefreshRevoked -> 401
//	ErrRefreshReuse                                            -> 401 (same)
//	ErrUserBlocked                                             -> 403
//
// Reuse and not-found return the SAME 401 so the client cannot probe whether
// a leaked token used to be valid. Service still revokes the family.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req RefreshRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	defer r.Body.Close() //nolint:errcheck

	sess := sessionFromRequest(r)

	result, err := h.svc.Refresh(r.Context(), req.RefreshToken, sess)
	if err != nil {
		switch {
		case errors.Is(err, ErrRefreshNotFound),
			errors.Is(err, ErrRefreshExpired),
			errors.Is(err, ErrRefreshRevoked),
			errors.Is(err, ErrRefreshReuse):
			apierr.Unauthorized("invalid or expired refresh token").Render(w)
		case errors.Is(err, ErrUserBlocked):
			apierr.Forbidden("account access disabled").Render(w)
		default:
			log.Error().Err(err).Msg("auth: refresh failed unexpectedly")
			apierr.InternalError("refresh failed").Render(w)
		}
		return
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/logout
// ---------------------------------------------------------------------------

// Logout handles POST /api/v1/auth/logout. Always returns 204 even when the
// token is unknown — clients must not learn whether a token was valid.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	var req LogoutRequest
	// Tolerant decoder: missing body / empty body is OK.
	if r.ContentLength > 0 {
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			// Even malformed body — return 204 to keep logout idempotent.
			log.Debug().Err(err).Msg("auth: logout body decode failed (treating as empty)")
		}
		defer r.Body.Close() //nolint:errcheck
	}

	sess := sessionFromRequest(r)
	if err := h.svc.Logout(r.Context(), req.RefreshToken, sess); err != nil {
		log.Error().Err(err).Msg("auth: logout failed unexpectedly")
		// Don't expose the failure — security tradeoff.
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------

// Me handles GET /api/v1/auth/me. Requires the dual-mode JWT middleware to
// have attached an AuthUser to the request context.
//
// Returns the same UserPayload shape Login emits — so the frontend can use
// one type for all three (login, refresh, me) responses.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	au := middleware.UserFromContext(r.Context())
	if au == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	payload, err := h.svc.Me(r.Context(), au.ID)
	if err != nil {
		switch {
		case errors.Is(err, ErrAccountMissing), errors.Is(err, ErrUserBlocked):
			apierr.Forbidden("account access disabled").Render(w)
		default:
			log.Error().Err(err).Msg("auth: /me failed")
			apierr.InternalError("failed to load profile").Render(w)
		}
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

// ---------------------------------------------------------------------------
// GET /.well-known/jwks.json
// ---------------------------------------------------------------------------

// JWKS handles GET /.well-known/jwks.json. Returns the public JWKS for the
// currently active signing key. Never exposes the private key.
//
// Cache-Control: public, max-age=300 — keeps load light on browsers / CDNs
// while still allowing key rotation within five minutes.
func (h *Handler) JWKS(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil || h.svc.Issuer() == nil || h.svc.Issuer().SigningKey() == nil {
		apierr.InternalError("JWKS not initialised").Render(w)
		return
	}
	set := h.svc.Issuer().SigningKey().PublicJWKS()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(set)
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store") // tokens MUST not be cached
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func sessionFromRequest(r *http.Request) SessionContext {
	return SessionContext{
		UserAgent: strings.TrimSpace(r.UserAgent()),
		IPAddress: clientIP(r),
	}
}

// clientIP returns the best-effort client IP. Prefers X-Forwarded-For (left-
// most), falls back to RemoteAddr without the port. Empty string when we
// cannot extract anything sensible — the repo writes NULL in that case.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Pick the left-most non-empty entry.
		for _, part := range strings.Split(xff, ",") {
			ip := strings.TrimSpace(part)
			if ip != "" {
				return ip
			}
		}
	}
	if r.RemoteAddr == "" {
		return ""
	}
	// RemoteAddr is "ip:port" for tcp / "[ipv6]:port" for v6. Strip the port.
	if i := strings.LastIndex(r.RemoteAddr, ":"); i > 0 {
		host := r.RemoteAddr[:i]
		host = strings.TrimPrefix(host, "[")
		host = strings.TrimSuffix(host, "]")
		return host
	}
	return r.RemoteAddr
}
