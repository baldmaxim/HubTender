package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// notificationsServicer is the interface NotificationsHandler depends on.
type notificationsServicer interface {
	Create(ctx context.Context, in repository.NotificationInput) error
	List(ctx context.Context, limit int) ([]repository.NotificationRow, error)
	DeleteAll(ctx context.Context) error
}

// NotificationsHandler serves /api/v1/notifications.
type NotificationsHandler struct {
	svc      notificationsServicer
	validate *validator.Validate
}

// NewNotificationsHandler creates a NotificationsHandler.
func NewNotificationsHandler(svc notificationsServicer) *NotificationsHandler {
	return &NotificationsHandler{svc: svc, validate: validator.New()}
}

type createNotificationReq struct {
	// UserID — accepted for API compatibility; the table has no user_id column.
	UserID  *string `json:"user_id"  validate:"omitempty,uuid"`
	Type    string  `json:"type"     validate:"required,oneof=success info warning error pending"`
	Title   string  `json:"title"    validate:"required,max=200"`
	Message string  `json:"message"  validate:"required,max=2000"`
}

// Create handles POST /api/v1/notifications. Returns 204.
func (h *NotificationsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createNotificationReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	if err := h.svc.Create(r.Context(), repository.NotificationInput{
		UserID:  req.UserID,
		Type:    req.Type,
		Title:   req.Title,
		Message: req.Message,
	}); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to create notification")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// List handles GET /api/v1/notifications?limit=50.
func (h *NotificationsHandler) List(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 {
			limit = n
		}
	}
	rows, err := h.svc.List(r.Context(), limit)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list notifications")
		return
	}
	if rows == nil {
		rows = []repository.NotificationRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// DeleteAll handles DELETE /api/v1/notifications.
func (h *NotificationsHandler) DeleteAll(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.DeleteAll(r.Context()); err != nil {
		apierr.InternalFromErr(w, r, err, "failed to clear notifications")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
