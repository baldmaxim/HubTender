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
	AllowedPages json.RawMessage // JSONB array
}

// RegisterUser ports public.register_user (lines 1423-1458 of
// 00000000000005_baseline_functions.sql).
//
// Logic:
//  1. If public.users is empty AND role_code ∈ (administrator, director,
//     developer) → access_status = approved, approved_by = self, approved_at = NOW().
//  2. Otherwise → access_status = pending (waits for admin approval).
//
// Called once per sign-up right after Supabase Auth creates the user.
func (r *UserRepo) RegisterUser(ctx context.Context, in RegisterUserInput) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("userRepo.RegisterUser: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	var isFirstUser bool
	if err := tx.QueryRow(ctx, `SELECT NOT EXISTS (SELECT 1 FROM public.users LIMIT 1)`).Scan(&isFirstUser); err != nil {
		return fmt.Errorf("userRepo.RegisterUser: first-user check: %w", err)
	}

	privilegedRole := in.RoleCode == "administrator" ||
		in.RoleCode == "director" ||
		in.RoleCode == "developer"

	if isFirstUser && privilegedRole {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.users (
			    id, full_name, email, role_code, access_status, allowed_pages,
			    approved_by, approved_at
			) VALUES ($1, $2, $3, $4, 'approved', $5, $1, NOW())
		`, in.UserID, in.FullName, in.Email, in.RoleCode, in.AllowedPages)
	} else {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.users (
			    id, full_name, email, role_code, access_status, allowed_pages
			) VALUES ($1, $2, $3, $4, 'pending', $5)
		`, in.UserID, in.FullName, in.Email, in.RoleCode, in.AllowedPages)
	}
	if err != nil {
		return fmt.Errorf("userRepo.RegisterUser: insert: %w", err)
	}

	return tx.Commit(ctx)
}
