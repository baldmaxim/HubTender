package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// tenderNotesServicer is the interface TenderNotesHandler depends on.
type tenderNotesServicer interface {
	LoadNotes(ctx context.Context, tenderID, userID string) (*services.NotesResult, error)
	SaveNote(ctx context.Context, tenderID, userID, text string) error
}

// TenderNotesHandler handles tender notes (per-user, per-tender).
type TenderNotesHandler struct {
	svc tenderNotesServicer
}

// NewTenderNotesHandler creates a TenderNotesHandler.
func NewTenderNotesHandler(svc tenderNotesServicer) *TenderNotesHandler {
	return &TenderNotesHandler{svc: svc}
}

// List handles GET /api/v1/tenders/{id}/notes.
// Returns {data:{my_note, all_notes}} — all_notes is non-empty only for
// privileged roles (decided server-side from the DB role).
func (h *TenderNotesHandler) List(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	res, err := h.svc.LoadNotes(r.Context(), tenderID, authUser.ID)
	if err != nil {
		apierr.InternalError("failed to load tender notes").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}

// saveNoteReq is the PUT body for /api/v1/tenders/{id}/notes.
type saveNoteReq struct {
	NoteText string `json:"note_text"`
}

// Save handles PUT /api/v1/tenders/{id}/notes — upsert (or delete when
// blank) the caller's own note. Returns 204.
func (h *TenderNotesHandler) Save(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	var req saveNoteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}

	if err := h.svc.SaveNote(r.Context(), tenderID, authUser.ID, req.NoteText); err != nil {
		apierr.InternalError("failed to save tender note").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
