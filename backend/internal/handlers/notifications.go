package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// notificationsServicer is the interface NotificationsHandler depends on.
type notificationsServicer interface {
	Create(ctx context.Context, in repository.NotificationInput) error
}

// NotificationsHandler serves POST /api/v1/notifications.
type NotificationsHandler struct {
	svc      notificationsServicer
	validate *validator.Validate
}

// NewNotificationsHandler creates a NotificationsHandler.
func NewNotificationsHandler(svc notificationsServicer) *NotificationsHandler {
	return &NotificationsHandler{svc: svc, validate: validator.New()}
}

type createNotificationReq struct {
	// UserID — optional; nil means a system-wide notification.
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
		apierr.InternalError("failed to create notification").Render(w)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
