package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
	"github.com/jackc/pgx/v5"
)

// tasksServicer is the interface TasksHandler depends on.
type tasksServicer interface {
	ListByUser(ctx context.Context, userID string, excludeCompleted bool) ([]repository.UserTaskWithRelations, error)
	ListAll(ctx context.Context, callerID string) ([]repository.UserTaskWithRelations, error)
	Create(ctx context.Context, userID string, tenderID *string, description string) (string, error)
	UpdateStatus(ctx context.Context, id string, taskStatus, completedAt *string) error
	GetWorkSettings(ctx context.Context, userID string) (*repository.WorkSettings, error)
	SetWorkSettings(ctx context.Context, userID string, mode, status *string) error
}

// TasksHandler serves user_tasks + per-user work settings.
type TasksHandler struct {
	svc tasksServicer
}

// NewTasksHandler creates a TasksHandler.
func NewTasksHandler(svc tasksServicer) *TasksHandler {
	return &TasksHandler{svc: svc}
}

// List handles GET /api/v1/tasks.
//   - ?user_id=<id> → that user's tasks (optionally ?exclude_completed=1)
//   - no user_id    → all tasks (manager roles only)
func (h *TasksHandler) List(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	userID := r.URL.Query().Get("user_id")
	if userID != "" {
		excludeCompleted := r.URL.Query().Get("exclude_completed") == "1" ||
			r.URL.Query().Get("exclude_completed") == "true"
		tasks, err := h.svc.ListByUser(r.Context(), userID, excludeCompleted)
		if err != nil {
			apierr.InternalFromErr(w, r, err, "failed to load tasks")
			return
		}
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: tasks})
		return
	}

	tasks, err := h.svc.ListAll(r.Context(), authUser.ID)
	if err != nil {
		if errors.Is(err, services.ErrForbidden) {
			apierr.Forbidden("insufficient privilege for all tasks").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to load tasks")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: tasks})
}

type createTaskReq struct {
	UserID      string  `json:"user_id"     validate:"required,uuid"`
	TenderID    *string `json:"tender_id"`
	Description string  `json:"description" validate:"required,min=1"`
}

// Create handles POST /api/v1/tasks.
func (h *TasksHandler) Create(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	var req createTaskReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if req.UserID == "" || req.Description == "" {
		apierr.BadRequest("user_id and description are required").Render(w)
		return
	}
	id, err := h.svc.Create(r.Context(), req.UserID, req.TenderID, req.Description)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to create task")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: map[string]string{"id": id}})
}

type updateTaskReq struct {
	TaskStatus  *string `json:"task_status"`
	CompletedAt *string `json:"completed_at"`
}

// Update handles PATCH /api/v1/tasks/{id}.
func (h *TasksHandler) Update(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing task id").Render(w)
		return
	}
	var req updateTaskReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateStatus(r.Context(), id, req.TaskStatus, req.CompletedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("task not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to update task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GetWorkSettings handles GET /api/v1/users/{id}/work-settings.
func (h *TasksHandler) GetWorkSettings(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	userID := chi.URLParam(r, "id")
	if userID == "" {
		apierr.BadRequest("missing user id").Render(w)
		return
	}
	ws, err := h.svc.GetWorkSettings(r.Context(), userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("user not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to load work settings")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: ws})
}

type setWorkSettingsReq struct {
	CurrentWorkMode   *string `json:"current_work_mode"`
	CurrentWorkStatus *string `json:"current_work_status"`
}

// SetWorkSettings handles PATCH /api/v1/users/{id}/work-settings.
func (h *TasksHandler) SetWorkSettings(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	userID := chi.URLParam(r, "id")
	if userID == "" {
		apierr.BadRequest("missing user id").Render(w)
		return
	}
	var req setWorkSettingsReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.SetWorkSettings(r.Context(), userID, req.CurrentWorkMode, req.CurrentWorkStatus); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("user not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to update work settings")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
