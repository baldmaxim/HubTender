package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// userRegisterServicer is the interface UserRegisterHandler depends on.
type userRegisterServicer interface {
	Register(ctx context.Context, in repository.RegisterUserInput) error
}

// UserRegisterHandler handles POST /api/v1/users/register.
type UserRegisterHandler struct {
	svc      userRegisterServicer
	validate *validator.Validate
}

// NewUserRegisterHandler creates a UserRegisterHandler.
func NewUserRegisterHandler(svc userRegisterServicer) *UserRegisterHandler {
	return &UserRegisterHandler{svc: svc, validate: validator.New()}
}

type registerReq struct {
	FullName     string          `json:"full_name"     validate:"required,min=1,max=200"`
	Email        string          `json:"email"         validate:"required,email"`
	RoleCode     string          `json:"role_code"     validate:"required,min=1,max=50"`
	AllowedPages json.RawMessage `json:"allowed_pages"`
}

// Register creates the public.users row after Supabase Auth sign-up.
// userID comes from the verified JWT, not the body — clients cannot
// register under another user.
func (h *UserRegisterHandler) Register(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req registerReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	// Default to empty JSONB array if allowed_pages is missing/null.
	pages := req.AllowedPages
	if len(pages) == 0 {
		pages = json.RawMessage(`[]`)
	}

	in := repository.RegisterUserInput{
		UserID:       authUser.ID,
		FullName:     req.FullName,
		Email:        authUser.Email, // trust JWT over body
		RoleCode:     req.RoleCode,
		AllowedPages: pages,
	}

	if err := h.svc.Register(r.Context(), in); err != nil {
		apierr.InternalError("failed to register user").Render(w)
		return
	}

	w.WriteHeader(http.StatusCreated)
}
