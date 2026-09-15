package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type verificationSectionsServicer interface {
	Sections(ctx context.Context, tenderID string) (*repository.TenderSections, error)
	Mark(ctx context.Context, tenderID, sectionKey, stage, expectedHash string, note, actor *string) error
	Unmark(ctx context.Context, tenderID, sectionKey, stage string, actor *string) error
}

// VerificationSectionsHandler — /api/v1/tenders/{id}/verification/sections.
type VerificationSectionsHandler struct {
	svc verificationSectionsServicer
}

func NewVerificationSectionsHandler(svc verificationSectionsServicer) *VerificationSectionsHandler {
	return &VerificationSectionsHandler{svc: svc}
}

type sectionsEnvelope struct {
	Data *repository.TenderSections `json:"data"`
}

// GetSections handles GET /api/v1/tenders/{id}/verification/sections.
func (h *VerificationSectionsHandler) GetSections(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	res, err := h.svc.Sections(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "verification sections failed", "tender_id", tenderID)
		return
	}
	renderJSON(w, r, http.StatusOK, sectionsEnvelope{Data: res})
}

type sectionMarkRequest struct {
	SectionKey  string  `json:"section_key"`
	Stage       string  `json:"stage"`
	ContentHash string  `json:"content_hash"`
	Note        *string `json:"note"`
}

func (h *VerificationSectionsHandler) decode(w http.ResponseWriter, r *http.Request, needHash bool) (string, string, *sectionMarkRequest, bool) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return "", "", nil, false
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return "", "", nil, false
	}
	var req sectionMarkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return "", "", nil, false
	}
	if req.SectionKey == "" {
		apierr.BadRequest("section_key is required").Render(w)
		return "", "", nil, false
	}
	// «Расценено» ставится автоматически по заполненности позиций — вручную
	// отмечается только проверка.
	if req.Stage != repository.SectionStageReview {
		apierr.BadRequest("stage must be 'review'").Render(w)
		return "", "", nil, false
	}
	if needHash && req.ContentHash == "" {
		apierr.BadRequest("content_hash is required").Render(w)
		return "", "", nil, false
	}
	if req.Note != nil {
		trimmed := strings.TrimSpace(*req.Note)
		if trimmed == "" {
			req.Note = nil
		} else {
			req.Note = &trimmed
		}
	}
	return tenderID, authUser.ID, &req, true
}

// PostMark handles POST /api/v1/tenders/{id}/verification/sections/mark.
func (h *VerificationSectionsHandler) PostMark(w http.ResponseWriter, r *http.Request) {
	tenderID, userID, req, ok := h.decode(w, r, true)
	if !ok {
		return
	}
	err := h.svc.Mark(r.Context(), tenderID, req.SectionKey, req.Stage, req.ContentHash, req.Note, &userID)
	switch {
	case err == nil:
		w.WriteHeader(http.StatusNoContent)
	case errors.Is(err, repository.ErrSectionNotFound):
		apierr.NotFound("раздел не найден — структура ВОР могла измениться").Render(w)
	case errors.Is(err, repository.ErrSectionChanged):
		(&apierr.ProblemExtra{
			Problem: *apierr.Conflict("раздел изменился после загрузки — обновите страницу и проверьте снова"),
			Extras:  map[string]any{"code": "SECTION_CHANGED"},
		}).Render(w)
	default:
		apierr.InternalFromErr(w, r, err, "verification section mark failed",
			"tender_id", tenderID, "section_key", req.SectionKey)
	}
}

// PostUnmark handles POST /api/v1/tenders/{id}/verification/sections/unmark.
func (h *VerificationSectionsHandler) PostUnmark(w http.ResponseWriter, r *http.Request) {
	tenderID, userID, req, ok := h.decode(w, r, false)
	if !ok {
		return
	}
	if err := h.svc.Unmark(r.Context(), tenderID, req.SectionKey, req.Stage, &userID); err != nil {
		apierr.InternalFromErr(w, r, err, "verification section unmark failed",
			"tender_id", tenderID, "section_key", req.SectionKey)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
