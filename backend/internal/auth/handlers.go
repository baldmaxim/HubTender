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

// ---------------------------------------------------------------------------
// POST /api/v1/auth/forgot-password
// ---------------------------------------------------------------------------

// ForgotPassword handles POST /api/v1/auth/forgot-password.
// ALWAYS returns 200 with {success: true} — anti-enumeration.
// In dev environments (APP_ENV != "production") with no SMTP configured
// the body additionally carries `reset_url` so operators can complete the
// flow without an email round-trip; in prod this field is always omitted.
func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var req ForgotPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Even malformed body → generic success. Don't reveal anything.
		writeJSON(w, http.StatusOK, ForgotPasswordResult{Success: true})
		return
	}
	defer r.Body.Close() //nolint:errcheck

	sess := sessionFromRequest(r)
	res, err := h.svc.Forgot(r.Context(), req.Email, sess)
	if err != nil {
		if errors.Is(err, ErrMailerNotConfigured) {
			// Production deploy gate (see Service.Forgot). DO NOT pretend
			// we sent an email — the user would never receive it.
			apierr.New(http.StatusServiceUnavailable, "Service Unavailable", "email_provider_not_configured").Render(w)
			return
		}
		// Should never happen — Forgot() swallows everything else to nil —
		// but fall back to generic success for safety.
		log.Error().Err(err).Msg("auth: forgot-password unexpected error")
		writeJSON(w, http.StatusOK, ForgotPasswordResult{Success: true})
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/reset-password
// ---------------------------------------------------------------------------

// ResetPassword handles POST /api/v1/auth/reset-password.
//
// Maps:
//
//	ErrResetTokenNotFound / ErrResetTokenUsed / ErrResetTokenExpired -> 401 (same generic message)
//	ErrPasswordTooShort                                              -> 400
//	anything else                                                    -> 500
//
// On success returns 204 No Content (no body). Client redirects to /login.
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var req ResetPasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	defer r.Body.Close() //nolint:errcheck

	sess := sessionFromRequest(r)
	if err := h.svc.Reset(r.Context(), req.Token, req.NewPassword, sess); err != nil {
		switch {
		case errors.Is(err, ErrPasswordTooShort):
			apierr.BadRequest("password too short (min 6 chars)").Render(w)
		case errors.Is(err, ErrResetTokenNotFound),
			errors.Is(err, ErrResetTokenUsed),
			errors.Is(err, ErrResetTokenExpired):
			apierr.Unauthorized("invalid or expired reset token").Render(w)
		default:
			apierr.InternalFromErr(w, r, err, "reset failed")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/change-password
// ---------------------------------------------------------------------------

// ChangePassword handles POST /api/v1/auth/change-password.
// Requires the request to have an authenticated middleware-attached
// AuthUser (Bearer JWT). user_id is taken from the JWT — body cannot
// substitute another user. On success returns 204; ALL refresh tokens of
// the user are revoked (forced re-login).
func (h *Handler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	au := middleware.UserFromContext(r.Context())
	if au == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req ChangePasswordRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	defer r.Body.Close() //nolint:errcheck

	sess := sessionFromRequest(r)
	if err := h.svc.ChangePassword(r.Context(), au.ID, req.CurrentPassword, req.NewPassword, sess); err != nil {
		switch {
		case errors.Is(err, ErrPasswordTooShort):
			apierr.BadRequest("password too short (min 6 chars)").Render(w)
		case errors.Is(err, ErrInvalidCredentials):
			apierr.Unauthorized("current password is incorrect").Render(w)
		case errors.Is(err, ErrAccountMissing):
			apierr.Forbidden("account access disabled").Render(w)
		default:
			apierr.InternalFromErr(w, r, err, "change failed")
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

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
			apierr.InternalFromErr(w, r, err, "login failed")
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
			apierr.InternalFromErr(w, r, err, "registration failed")
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
			apierr.InternalFromErr(w, r, err, "refresh failed")
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
			apierr.InternalFromErr(w, r, err, "failed to load profile")
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
