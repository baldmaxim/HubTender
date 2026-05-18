package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TaskTenderRef is the joined tender (nullable — tender_id may be NULL).
type TaskTenderRef struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// TaskUserRef is the joined assignee + work mode/status.
type TaskUserRef struct {
	ID                string `json:"id"`
	FullName          string `json:"full_name"`
	Email             string `json:"email"`
	CurrentWorkMode   string `json:"current_work_mode"`
	CurrentWorkStatus string `json:"current_work_status"`
}

// UserTaskWithRelations mirrors the frontend type of the same name.
type UserTaskWithRelations struct {
	ID          string         `json:"id"`
	UserID      string         `json:"user_id"`
	TenderID    *string        `json:"tender_id"`
	Description string         `json:"description"`
	TaskStatus  string         `json:"task_status"`
	CompletedAt *string        `json:"completed_at"`
	CreatedAt   string         `json:"created_at"`
	UpdatedAt   string         `json:"updated_at"`
	Tender      *TaskTenderRef `json:"tender"`
	User        *TaskUserRef   `json:"user"`
}

// WorkSettings is the per-user work mode/status pair.
type WorkSettings struct {
	CurrentWorkMode   string `json:"current_work_mode"`
	CurrentWorkStatus string `json:"current_work_status"`
}

// TasksRepo is the data layer for public.user_tasks (+ joined relations).
type TasksRepo struct {
	pool *pgxpool.Pool
}

// NewTasksRepo creates a TasksRepo.
func NewTasksRepo(pool *pgxpool.Pool) *TasksRepo {
	return &TasksRepo{pool: pool}
}

const tasksSelect = `
	SELECT t.id::text, t.user_id::text, t.tender_id::text, t.description,
	       t.task_status::text, t.completed_at::text,
	       t.created_at::text, t.updated_at::text,
	       te.id::text, te.title,
	       u.id::text, u.full_name, u.email,
	       u.current_work_mode::text, u.current_work_status::text
	FROM public.user_tasks t
	LEFT JOIN public.tenders te ON te.id = t.tender_id
	LEFT JOIN public.users   u  ON u.id  = t.user_id
`

func scanTaskRows(rows pgx.Rows) ([]UserTaskWithRelations, error) {
	out := make([]UserTaskWithRelations, 0)
	for rows.Next() {
		var (
			r                            UserTaskWithRelations
			teID, teTitle                *string
			uID, uFull, uEmail           *string
			uMode, uStatus               *string
		)
		if err := rows.Scan(
			&r.ID, &r.UserID, &r.TenderID, &r.Description,
			&r.TaskStatus, &r.CompletedAt, &r.CreatedAt, &r.UpdatedAt,
			&teID, &teTitle,
			&uID, &uFull, &uEmail, &uMode, &uStatus,
		); err != nil {
			return nil, fmt.Errorf("tasksRepo scan: %w", err)
		}
		if teID != nil {
			r.Tender = &TaskTenderRef{ID: *teID, Title: deref(teTitle)}
		}
		if uID != nil {
			r.User = &TaskUserRef{
				ID:                *uID,
				FullName:          deref(uFull),
				Email:             deref(uEmail),
				CurrentWorkMode:   deref(uMode),
				CurrentWorkStatus: deref(uStatus),
			}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tasksRepo rows: %w", err)
	}
	return out, nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ListByUser returns tasks for one user (optionally excluding completed),
// newest first.
func (r *TasksRepo) ListByUser(ctx context.Context, userID string, excludeCompleted bool) ([]UserTaskWithRelations, error) {
	q := tasksSelect + ` WHERE t.user_id = $1::uuid`
	if excludeCompleted {
		q += ` AND t.task_status <> 'completed'`
	}
	q += ` ORDER BY t.created_at DESC`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("tasksRepo.ListByUser: %w", err)
	}
	defer rows.Close()
	return scanTaskRows(rows)
}

// ListAll returns every task (manager view), newest first.
func (r *TasksRepo) ListAll(ctx context.Context) ([]UserTaskWithRelations, error) {
	rows, err := r.pool.Query(ctx, tasksSelect+` ORDER BY t.created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("tasksRepo.ListAll: %w", err)
	}
	defer rows.Close()
	return scanTaskRows(rows)
}

// Create inserts a user_task (task_status defaults to 'running').
func (r *TasksRepo) Create(ctx context.Context, userID string, tenderID *string, description string) (string, error) {
	var id string
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.user_tasks (user_id, tender_id, description, task_status)
		VALUES ($1::uuid, $2::uuid, $3, 'running')
		RETURNING id::text
	`, userID, tenderID, description).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("tasksRepo.Create: %w", err)
	}
	return id, nil
}

// UpdateStatus applies task_status and/or completed_at (only provided fields).
// Returns pgx.ErrNoRows if the task does not exist.
func (r *TasksRepo) UpdateStatus(ctx context.Context, id string, taskStatus, completedAt *string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.user_tasks
		SET task_status  = COALESCE($2::public.task_status, task_status),
		    completed_at = COALESCE($3::timestamptz, completed_at),
		    updated_at   = NOW()
		WHERE id = $1::uuid
	`, id, taskStatus, completedAt)
	if err != nil {
		return fmt.Errorf("tasksRepo.UpdateStatus: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// GetWorkSettings returns current work mode/status for a user.
func (r *TasksRepo) GetWorkSettings(ctx context.Context, userID string) (*WorkSettings, error) {
	var ws WorkSettings
	err := r.pool.QueryRow(ctx, `
		SELECT current_work_mode::text, current_work_status::text
		FROM public.users WHERE id = $1::uuid
	`, userID).Scan(&ws.CurrentWorkMode, &ws.CurrentWorkStatus)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("tasksRepo.GetWorkSettings: %w", err)
	}
	return &ws, nil
}

// SetWorkSettings updates current work mode/status (only provided fields).
func (r *TasksRepo) SetWorkSettings(ctx context.Context, userID string, mode, status *string) error {
	tag, err := r.pool.Exec(ctx, `
		UPDATE public.users
		SET current_work_mode   = COALESCE($2::public.work_mode, current_work_mode),
		    current_work_status = COALESCE($3::public.work_status, current_work_status)
		WHERE id = $1::uuid
	`, userID, mode, status)
	if err != nil {
		return fmt.Errorf("tasksRepo.SetWorkSettings: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// CallerRole returns role_code for a user ("" if absent).
func (r *TasksRepo) CallerRole(ctx context.Context, userID string) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT role_code FROM public.users WHERE id = $1::uuid`, userID,
	).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("tasksRepo.CallerRole: %w", err)
	}
	return role, nil
}
