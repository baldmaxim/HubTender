package repository

import (
	"context"
	"encoding/json"
	"fmt"
)

// RegisterUserInput holds parameters for RegisterUser.
type RegisterUserInput struct {
	UserID       string
	FullName     string
	Email        string
	RoleCode     string
	AllowedPages json.RawMessage // JSONB array; if empty, role's default is used
}

// RegisterUser ports public.register_user (lines 1423-1458 of
// 00000000000005_baseline_functions.sql).
//
// Logic:
//  1. If allowed_pages is empty, fall back to roles.allowed_pages for role_code.
//  2. If public.users is empty AND role_code ∈ (administrator, director,
//     developer) → access_status = approved, approved_by = self, approved_at = NOW().
//  3. Otherwise → access_status = pending and a registration-request
//     notification row is inserted so admins can see the request.
//
// Called once per sign-up right after Supabase Auth creates the user.
func (r *UserRepo) RegisterUser(ctx context.Context, in RegisterUserInput) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("userRepo.RegisterUser: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	pages := in.AllowedPages
	if len(pages) == 0 || string(pages) == "null" {
		var rolePages json.RawMessage
		if err := tx.QueryRow(ctx,
			`SELECT allowed_pages FROM public.roles WHERE code = $1`,
			in.RoleCode,
		).Scan(&rolePages); err == nil {
			pages = rolePages
		}
		if len(pages) == 0 {
			pages = json.RawMessage(`[]`)
		}
	}

	var isFirstUser bool
	if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM public.users LIMIT 1)`).Scan(&isFirstUser); err != nil {
		return fmt.Errorf("userRepo.RegisterUser: first-user check: %w", err)
	}

	privilegedRole := in.RoleCode == "administrator" ||
		in.RoleCode == "director" ||
		in.RoleCode == "developer"

	approved := isFirstUser && privilegedRole
	if approved {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.users (
			    id, full_name, email, role_code, access_status, allowed_pages,
			    approved_by, approved_at
			) VALUES ($1, $2, $3, $4, 'approved', $5, $1, NOW())
		`, in.UserID, in.FullName, in.Email, in.RoleCode, pages)
	} else {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.users (
			    id, full_name, email, role_code, access_status, allowed_pages
			) VALUES ($1, $2, $3, $4, 'pending', $5)
		`, in.UserID, in.FullName, in.Email, in.RoleCode, pages)
	}
	if err != nil {
		return fmt.Errorf("userRepo.RegisterUser: insert: %w", err)
	}

	if !approved {
		title := "Новый запрос на регистрацию"
		msg := fmt.Sprintf("%s (%s) запросил доступ к системе", in.FullName, in.Email)
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.notifications (
			    type, title, message, related_entity_type, related_entity_id, is_read
			) VALUES ('pending', $1, $2, 'registration_request', $3, false)
		`, title, msg, in.UserID); err != nil {
			return fmt.Errorf("userRepo.RegisterUser: notify: %w", err)
		}
	}

	return tx.Commit(ctx)
}
