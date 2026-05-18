package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TenderNote mirrors public.tender_notes (timestamps as text — same as the
// frontend TenderNote interface: created_at/updated_at are ISO strings).
type TenderNote struct {
	ID        string `json:"id"`
	TenderID  string `json:"tender_id"`
	UserID    string `json:"user_id"`
	NoteText  string `json:"note_text"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
}

// TenderNoteFull adds the author name (for privileged "view all" roles).
type TenderNoteFull struct {
	TenderNote
	UserFullName string `json:"user_full_name"`
}

// TenderNotesRepo is the data layer for public.tender_notes.
type TenderNotesRepo struct {
	pool *pgxpool.Pool
}

// NewTenderNotesRepo creates a TenderNotesRepo.
func NewTenderNotesRepo(pool *pgxpool.Pool) *TenderNotesRepo {
	return &TenderNotesRepo{pool: pool}
}

// CallerRole returns role_code for the given user id ("" if user missing).
func (r *TenderNotesRepo) CallerRole(ctx context.Context, userID string) (string, error) {
	var role string
	err := r.pool.QueryRow(ctx,
		`SELECT role_code FROM public.users WHERE id = $1::uuid`, userID,
	).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("tenderNotesRepo.CallerRole: %w", err)
	}
	return role, nil
}

// OwnNote returns the caller's own note for a tender, or nil if absent.
func (r *TenderNotesRepo) OwnNote(ctx context.Context, tenderID, userID string) (*TenderNote, error) {
	var n TenderNote
	err := r.pool.QueryRow(ctx, `
		SELECT id::text, tender_id::text, user_id::text, note_text,
		       created_at::text, updated_at::text
		FROM public.tender_notes
		WHERE tender_id = $1::uuid AND user_id = $2::uuid
	`, tenderID, userID).Scan(
		&n.ID, &n.TenderID, &n.UserID, &n.NoteText, &n.CreatedAt, &n.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("tenderNotesRepo.OwnNote: %w", err)
	}
	return &n, nil
}

// AllNotes returns every non-empty note for a tender with the author name,
// newest first (matches the previous client-side behaviour).
func (r *TenderNotesRepo) AllNotes(ctx context.Context, tenderID string) ([]TenderNoteFull, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT n.id::text, n.tender_id::text, n.user_id::text, n.note_text,
		       n.created_at::text, n.updated_at::text,
		       COALESCE(u.full_name, 'Неизвестный')
		FROM public.tender_notes n
		LEFT JOIN public.users u ON u.id = n.user_id
		WHERE n.tender_id = $1::uuid AND btrim(n.note_text) <> ''
		ORDER BY n.updated_at DESC
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("tenderNotesRepo.AllNotes: %w", err)
	}
	defer rows.Close()

	out := make([]TenderNoteFull, 0)
	for rows.Next() {
		var n TenderNoteFull
		if err := rows.Scan(
			&n.ID, &n.TenderID, &n.UserID, &n.NoteText,
			&n.CreatedAt, &n.UpdatedAt, &n.UserFullName,
		); err != nil {
			return nil, fmt.Errorf("tenderNotesRepo.AllNotes scan: %w", err)
		}
		out = append(out, n)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderNotesRepo.AllNotes rows: %w", err)
	}
	return out, nil
}

// UpsertOwnNote inserts or updates the caller's note (unique tender_id,user_id).
func (r *TenderNotesRepo) UpsertOwnNote(ctx context.Context, tenderID, userID, text string) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.tender_notes (tender_id, user_id, note_text)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT (tender_id, user_id)
		DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = now()
	`, tenderID, userID, text)
	if err != nil {
		return fmt.Errorf("tenderNotesRepo.UpsertOwnNote: %w", err)
	}
	return nil
}

// DeleteOwnNote removes the caller's note for a tender (no-op if absent).
func (r *TenderNotesRepo) DeleteOwnNote(ctx context.Context, tenderID, userID string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM public.tender_notes
		WHERE tender_id = $1::uuid AND user_id = $2::uuid
	`, tenderID, userID)
	if err != nil {
		return fmt.Errorf("tenderNotesRepo.DeleteOwnNote: %w", err)
	}
	return nil
}
