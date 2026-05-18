package services

import (
	"context"
	"fmt"
	"strings"

	"github.com/su10/hubtender/backend/internal/repository"
)

// noteViewerRoles mirrors NOTE_VIEWER_ROLES in src/lib/supabase/types.ts:
// roles allowed to see every note of a tender.
var noteViewerRoles = map[string]bool{
	"administrator":     true,
	"developer":         true,
	"director":          true,
	"senior_group":      true,
	"veduschiy_inzhener": true,
}

// tenderNotesRepoer is the interface TenderNotesService depends on.
type tenderNotesRepoer interface {
	CallerRole(ctx context.Context, userID string) (string, error)
	OwnNote(ctx context.Context, tenderID, userID string) (*repository.TenderNote, error)
	AllNotes(ctx context.Context, tenderID string) ([]repository.TenderNoteFull, error)
	UpsertOwnNote(ctx context.Context, tenderID, userID, text string) error
	DeleteOwnNote(ctx context.Context, tenderID, userID string) error
}

// NotesResult is the GET payload: the caller's own note plus, for privileged
// roles, all notes with author names (empty slice otherwise).
type NotesResult struct {
	MyNote   *repository.TenderNote      `json:"my_note"`
	AllNotes []repository.TenderNoteFull `json:"all_notes"`
}

// TenderNotesService enforces the view-all role rule server-side.
type TenderNotesService struct {
	repo tenderNotesRepoer
}

// NewTenderNotesService creates a TenderNotesService.
func NewTenderNotesService(repo *repository.TenderNotesRepo) *TenderNotesService {
	return &TenderNotesService{repo: repo}
}

// LoadNotes returns the caller's note and, if their role is privileged, all
// tender notes with author names. Privilege is decided from the DB role, not
// from any client-supplied flag.
func (s *TenderNotesService) LoadNotes(
	ctx context.Context, tenderID, userID string,
) (*NotesResult, error) {
	own, err := s.repo.OwnNote(ctx, tenderID, userID)
	if err != nil {
		return nil, fmt.Errorf("tenderNotesService.LoadNotes: %w", err)
	}
	// Empty own note behaves as "no note" (matches prior frontend logic).
	if own != nil && strings.TrimSpace(own.NoteText) == "" {
		own = nil
	}

	result := &NotesResult{MyNote: own, AllNotes: []repository.TenderNoteFull{}}

	role, err := s.repo.CallerRole(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("tenderNotesService.LoadNotes: %w", err)
	}
	if noteViewerRoles[role] {
		all, err := s.repo.AllNotes(ctx, tenderID)
		if err != nil {
			return nil, fmt.Errorf("tenderNotesService.LoadNotes: %w", err)
		}
		result.AllNotes = all
	}
	return result, nil
}

// SaveNote upserts the caller's note, or deletes it when the text is blank
// (so the user disappears from the privileged list — prior behaviour).
func (s *TenderNotesService) SaveNote(
	ctx context.Context, tenderID, userID, text string,
) error {
	if strings.TrimSpace(text) == "" {
		return s.repo.DeleteOwnNote(ctx, tenderID, userID)
	}
	return s.repo.UpsertOwnNote(ctx, tenderID, userID, text)
}
