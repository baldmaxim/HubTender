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
)

type verificationAIServicer interface {
	Settings(ctx context.Context) (*services.VerificationAISettingsView, error)
	SaveSettings(ctx context.Context, in repository.VerificationAISettings, actor *string) (*services.VerificationAISettingsView, error)
	TestModel(ctx context.Context, actor *string) (*services.AITestResult, error)
	StartManual(ctx context.Context, tenderID string, actor *string) (string, error)
	Assessments(ctx context.Context, tenderID string) (*services.TenderAssessments, error)
}

// VerificationAIHandler — ИИ-разбор находок: настройки (администраторы), оценки и
// запуск по тендеру.
type VerificationAIHandler struct {
	svc verificationAIServicer
}

func NewVerificationAIHandler(svc verificationAIServicer) *VerificationAIHandler {
	return &VerificationAIHandler{svc: svc}
}

func actorID(r *http.Request) *string {
	if u := middleware.UserFromContext(r.Context()); u != nil {
		return &u.ID
	}
	return nil
}

// GetSettings handles GET /api/v1/verification/ai-settings.
func (h *VerificationAIHandler) GetSettings(w http.ResponseWriter, r *http.Request) {
	v, err := h.svc.Settings(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "verification ai settings failed")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: v})
}

// PutSettings handles PUT /api/v1/verification/ai-settings.
func (h *VerificationAIHandler) PutSettings(w http.ResponseWriter, r *http.Request) {
	var in repository.VerificationAISettings
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&in); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return
	}
	for _, id := range in.AllowedTenderIDs {
		if !uuidPatchRe.MatchString(id) {
			apierr.BadRequest("allowed_tender_ids: ожидаются uuid").Render(w)
			return
		}
	}
	v, err := h.svc.SaveSettings(r.Context(), in, actorID(r))
	switch {
	case errors.Is(err, services.ErrAITriageModelRequired):
		apierr.BadRequest("укажите модель").Render(w)
	case errors.Is(err, services.ErrAITriageNotTested):
		apierr.Conflict("включить можно только модель, прошедшую проверку: нажмите «Проверить модель»").Render(w)
	case errors.Is(err, repository.ErrAISettingsInvalid):
		apierr.BadRequest("значения вне допустимых пределов").Render(w)
	case err != nil:
		apierr.InternalFromErr(w, r, err, "verification ai settings save failed")
	default:
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: v})
	}
}

// PostTest handles POST /api/v1/verification/ai-settings/test — проверка модели на
// известном случае (утеплитель в два слоя).
func (h *VerificationAIHandler) PostTest(w http.ResponseWriter, r *http.Request) {
	res, err := h.svc.TestModel(r.Context(), actorID(r))
	switch {
	case errors.Is(err, services.ErrAITriageNotConfigured):
		apierr.ServiceUnavailable("подключение к модели не настроено: нет ключа или прокси").Render(w)
	case errors.Is(err, services.ErrAITriageModelRequired):
		apierr.BadRequest("сначала сохраните модель").Render(w)
	case err != nil:
		apierr.InternalFromErr(w, r, err, "verification ai model test failed")
	default:
		renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
	}
}

// GetAssessments handles GET /api/v1/tenders/{id}/verification/ai-assessments.
func (h *VerificationAIHandler) GetAssessments(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	res, err := h.svc.Assessments(r.Context(), tenderID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "verification ai assessments failed", "tender_id", tenderID)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}

// PostTriage handles POST /api/v1/tenders/{id}/verification/ai-triage — разбор в фоне.
func (h *VerificationAIHandler) PostTriage(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	status, err := h.svc.StartManual(r.Context(), tenderID, actorID(r))
	if err != nil {
		apierr.InternalFromErr(w, r, err, "verification ai triage start failed", "tender_id", tenderID)
		return
	}
	code := http.StatusOK
	if status == services.AITriageStarted {
		code = http.StatusAccepted
	}
	renderJSON(w, r, code, dataEnvelope{Data: map[string]string{"status": status}})
}
