package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog/log"

	"github.com/su10/hubtender/backend/internal/ai/triage"
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
	SaveExternalAssessments(ctx context.Context, tenderID, modelID, promptVersion string,
		items []services.ExternalAssessment) (*services.ExternalAssessmentsResult, error)
}

// verificationNotifier — событие realtime «проверка тендера обновилась»
// (тема verification:<tender_id>).
type verificationNotifier interface {
	NotifyVerificationUpdated(ctx context.Context, tenderID string) error
}

// notifyVerificationUpdated шлёт событие; ошибка только в лог — ответ запроса
// событие не ломает. Нулевой notifier допустим (тесты).
func notifyVerificationUpdated(r *http.Request, n verificationNotifier, tenderID string) {
	if n == nil {
		return
	}
	if err := n.NotifyVerificationUpdated(r.Context(), tenderID); err != nil {
		log.Warn().Err(err).Str("tender_id", tenderID).Msg("verification updated event not sent")
	}
}

// VerificationAIHandler — ИИ-разбор находок: настройки (администраторы), оценки и
// запуск по тендеру.
type VerificationAIHandler struct {
	svc      verificationAIServicer
	notifier verificationNotifier
}

func NewVerificationAIHandler(svc verificationAIServicer, notifier verificationNotifier) *VerificationAIHandler {
	return &VerificationAIHandler{svc: svc, notifier: notifier}
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

// Пределы внешних оценок (скрипт на офисном ПК).
const (
	maxExternalAssessments     = 2000
	maxExternalReasonRunes     = 2000
	maxExternalEvidence        = 10
	maxExternalModelRunes      = 200
	maxExternalPromptRunes     = 100
	externalPromptPrefix       = "ext:"
	maxExternalAssessmentsBody = 16 << 20
)

type externalAssessmentItem struct {
	FindingID   string            `json:"finding_id"`
	Fingerprint string            `json:"fingerprint"`
	Label       string            `json:"label"`
	Reason      string            `json:"reason"`
	Evidence    []triage.Evidence `json:"evidence"`
}

type externalAssessmentsRequest struct {
	ModelID       string                   `json:"model_id"`
	PromptVersion string                   `json:"prompt_version"`
	Items         []externalAssessmentItem `json:"items"`
}

// PostExternalAssessments handles POST /api/v1/tenders/{id}/verification/ai-assessments —
// оценки находок от внешнего скрипта. Находки чужого тендера, закрытые и с
// устаревшим отпечатком пропускаются (skipped), остальные записываются.
func (h *VerificationAIHandler) PostExternalAssessments(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if !uuidPatchRe.MatchString(tenderID) {
		apierr.BadRequest("ожидается uuid тендера").Render(w)
		return
	}
	var req externalAssessmentsRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxExternalAssessmentsBody)).Decode(&req); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return
	}
	if n := len(req.Items); n == 0 || n > maxExternalAssessments {
		apierr.BadRequest("items: от 1 до 2000 элементов").Render(w)
		return
	}
	if !strings.HasPrefix(req.PromptVersion, externalPromptPrefix) ||
		utf8.RuneCountInString(req.PromptVersion) > maxExternalPromptRunes {
		apierr.BadRequest("prompt_version: должна начинаться с \"ext:\", не длиннее 100 символов").Render(w)
		return
	}
	if strings.TrimSpace(req.ModelID) == "" || utf8.RuneCountInString(req.ModelID) > maxExternalModelRunes {
		apierr.BadRequest("model_id: обязателен, не длиннее 200 символов").Render(w)
		return
	}

	items := make([]services.ExternalAssessment, 0, len(req.Items))
	for i := range req.Items {
		it := req.Items[i]
		if it.FindingID == "" || it.Fingerprint == "" {
			apierr.BadRequest("items: у каждого элемента нужны finding_id и fingerprint").Render(w)
			return
		}
		if !uuidPatchRe.MatchString(it.FindingID) {
			apierr.BadRequest("items: finding_id должен быть uuid").Render(w)
			return
		}
		if it.Label != triage.LabelLikelyError && it.Label != triage.LabelLikelyOK && it.Label != triage.LabelUnsure {
			apierr.BadRequest("items: label — likely_error, likely_ok или unsure").Render(w)
			return
		}
		reason := it.Reason
		if utf8.RuneCountInString(reason) > maxExternalReasonRunes {
			reason = string([]rune(reason)[:maxExternalReasonRunes])
		}
		ev := it.Evidence
		if len(ev) > maxExternalEvidence {
			ev = ev[:maxExternalEvidence]
		}
		if ev == nil {
			ev = []triage.Evidence{}
		}
		items = append(items, services.ExternalAssessment{
			FindingID: strings.ToLower(it.FindingID), Fingerprint: it.Fingerprint,
			Label: it.Label, Reason: reason, Evidence: ev,
		})
	}

	res, err := h.svc.SaveExternalAssessments(r.Context(), tenderID, req.ModelID, req.PromptVersion, items)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "verification ai external assessments failed", "tender_id", tenderID)
		return
	}
	if res.Saved > 0 {
		notifyVerificationUpdated(r, h.notifier, tenderID)
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}
