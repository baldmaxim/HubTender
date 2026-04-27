package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// userAdminServicer is the interface UserAdminHandler depends on.
type userAdminServicer interface {
	ListTendersForUserAccess(ctx context.Context) ([]repository.TenderForAccessRow, error)
	ListPendingUsers(ctx context.Context) ([]repository.PendingUserRow, error)
	ListAllUsers(ctx context.Context) ([]repository.AdminUserRow, error)
	ApproveUser(ctx context.Context, id string, in repository.ApproveInput) error
	DeleteUser(ctx context.Context, id string) error
	SetUserAccessEnabled(ctx context.Context, id string, enabled bool) error
	UpdateUserProfile(ctx context.Context, id string, in repository.UpdateUserProfileInput) error
	SyncUsersAllowedPagesByRole(ctx context.Context, roleCode string, pages []string) error
	CountUsersWithRole(ctx context.Context, roleCode string) (int, error)
	ListRoles(ctx context.Context) ([]repository.AdminRoleRow, error)
	FindRoleByCode(ctx context.Context, code string) (*repository.AdminRoleRow, error)
	FindRoleByName(ctx context.Context, name string) (*repository.AdminRoleRow, error)
	CreateRole(ctx context.Context, in repository.RoleInput) (*repository.AdminRoleRow, error)
	UpdateRoleAllowedPages(ctx context.Context, code string, pages []string) error
	DeleteRole(ctx context.Context, code string) error
}

// UserAdminHandler serves Admin/Users + Admin/Roles endpoints.
type UserAdminHandler struct {
	svc userAdminServicer
}

// NewUserAdminHandler creates a UserAdminHandler.
func NewUserAdminHandler(svc userAdminServicer) *UserAdminHandler {
	return &UserAdminHandler{svc: svc}
}

// ─── Tenders for access tab ────────────────────────────────────────────────

func (h *UserAdminHandler) ListTendersForUserAccess(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListTendersForUserAccess(r.Context())
	if err != nil {
		apierr.InternalError("failed to list tenders").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.TenderForAccessRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// ─── Users ──────────────────────────────────────────────────────────────────

func (h *UserAdminHandler) ListPending(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListPendingUsers(r.Context())
	if err != nil {
		apierr.InternalError("failed to list pending users").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.PendingUserRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *UserAdminHandler) ListAll(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListAllUsers(r.Context())
	if err != nil {
		apierr.InternalError("failed to list users").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.AdminUserRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

type approveReq struct {
	RoleCode     string   `json:"role_code"`
	AllowedPages []string `json:"allowed_pages"`
}

func (h *UserAdminHandler) Approve(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req approveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if strings.TrimSpace(req.RoleCode) == "" {
		apierr.BadRequest("role_code required").Render(w)
		return
	}
	if err := h.svc.ApproveUser(r.Context(), id, repository.ApproveInput{
		ApprovedBy:   authUser.ID,
		RoleCode:     req.RoleCode,
		AllowedPages: req.AllowedPages,
	}); err != nil {
		apierr.InternalError("failed to approve user").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserAdminHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteUser(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete user").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setAccessReq struct {
	Enabled bool `json:"enabled"`
}

func (h *UserAdminHandler) SetAccess(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var req setAccessReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.SetUserAccessEnabled(r.Context(), id, req.Enabled); err != nil {
		apierr.InternalError("failed to update access").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserAdminHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.UpdateUserProfileInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateUserProfile(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update user").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type syncPagesReq struct {
	AllowedPages []string `json:"allowed_pages"`
}

func (h *UserAdminHandler) SyncPagesByRole(w http.ResponseWriter, r *http.Request) {
	roleCode := chi.URLParam(r, "code")
	if roleCode == "" {
		apierr.BadRequest("missing code").Render(w)
		return
	}
	var req syncPagesReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.SyncUsersAllowedPagesByRole(r.Context(), roleCode, req.AllowedPages); err != nil {
		apierr.InternalError("failed to sync allowed pages").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserAdminHandler) CountByRole(w http.ResponseWriter, r *http.Request) {
	roleCode := r.URL.Query().Get("role_code")
	if roleCode == "" {
		apierr.BadRequest("role_code query param required").Render(w)
		return
	}
	n, err := h.svc.CountUsersWithRole(r.Context(), roleCode)
	if err != nil {
		apierr.InternalError("failed to count users").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, map[string]int{"count": n})
}

// ─── Roles ──────────────────────────────────────────────────────────────────

func (h *UserAdminHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListRoles(r.Context())
	if err != nil {
		apierr.InternalError("failed to list roles").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.AdminRoleRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *UserAdminHandler) FindRoleByCode(w http.ResponseWriter, r *http.Request) {
	code := r.URL.Query().Get("code")
	if code == "" {
		apierr.BadRequest("code query param required").Render(w)
		return
	}
	row, err := h.svc.FindRoleByCode(r.Context(), code)
	if err != nil {
		apierr.InternalError("failed to find role").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

func (h *UserAdminHandler) FindRoleByName(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		apierr.BadRequest("name query param required").Render(w)
		return
	}
	row, err := h.svc.FindRoleByName(r.Context(), name)
	if err != nil {
		apierr.InternalError("failed to find role").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

func (h *UserAdminHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	var in repository.RoleInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if strings.TrimSpace(in.Code) == "" || strings.TrimSpace(in.Name) == "" {
		apierr.BadRequest("code and name required").Render(w)
		return
	}
	row, err := h.svc.CreateRole(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to create role").Render(w)
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: row})
}

func (h *UserAdminHandler) UpdateRolePages(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		apierr.BadRequest("missing code").Render(w)
		return
	}
	var req syncPagesReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateRoleAllowedPages(r.Context(), code, req.AllowedPages); err != nil {
		apierr.InternalError("failed to update role").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *UserAdminHandler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	if code == "" {
		apierr.BadRequest("missing code").Render(w)
		return
	}
	if err := h.svc.DeleteRole(r.Context(), code); err != nil {
		apierr.InternalError("failed to delete role").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
