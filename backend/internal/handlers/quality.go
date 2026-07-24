package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// qualityServicer is the interface QualityHandler depends on.
type qualityServicer interface {
	Report(ctx context.Context, tenderID string, refresh bool) (*repository.QualityReport, error)
	SetVerdict(ctx context.Context, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
	Export(ctx context.Context) ([]repository.ExportRow, error)
}

// QualityHandler serves the /api/v1/tenders/:id/quality endpoints.
type QualityHandler struct {
	svc qualityServicer
}

// NewQualityHandler creates a QualityHandler.
func NewQualityHandler(svc qualityServicer) *QualityHandler {
	return &QualityHandler{svc: svc}
}

type qualityEnvelope struct {
	Data *repository.QualityReport `json:"data"`
}

type rulesEnvelope struct {
	Data []quality.Rule `json:"data"`
}

type exportEnvelope struct {
	Data []repository.ExportRow `json:"data"`
}

// GetReport handles GET /api/v1/tenders/:id/quality.
// Query params: refresh=1 обходит кэш.
func (h *QualityHandler) GetReport(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	refresh := r.URL.Query().Get("refresh") == "1"

	rep, err := h.svc.Report(r.Context(), tenderID, refresh)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "quality report failed", "tender_id", tenderID)
		return
	}

	renderJSON(w, r, http.StatusOK, qualityEnvelope{Data: rep})
}

// GetRules handles GET /api/v1/quality/rules — каталог целиком, включая черновики.
// Нужен странице, чтобы показать описание правила рядом с находкой.
func (h *QualityHandler) GetRules(w http.ResponseWriter, r *http.Request) {
	renderJSON(w, r, http.StatusOK, rulesEnvelope{Data: quality.All()})
}

type verdictRequest struct {
	RuleCode    string  `json:"rule_code"`
	EntityID    string  `json:"entity_id"`
	Fingerprint string  `json:"fingerprint"`
	Verdict     string  `json:"verdict"` // accepted | error
	Note        *string `json:"note"`
}

// PostVerdict handles POST /api/v1/tenders/:id/quality/verdict.
func (h *QualityHandler) PostVerdict(w http.ResponseWriter, r *http.Request) {
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

	var req verdictRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return
	}
	if req.RuleCode == "" || req.EntityID == "" || req.Fingerprint == "" {
		apierr.BadRequest("rule_code, entity_id and fingerprint are required").Render(w)
		return
	}
	if req.Verdict != "accepted" && req.Verdict != "error" {
		apierr.BadRequest("verdict must be 'accepted' or 'error'").Render(w)
		return
	}

	err := h.svc.SetVerdict(r.Context(), tenderID, req.RuleCode, req.EntityID,
		req.Fingerprint, req.Verdict, req.Note, &authUser.ID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "quality verdict failed",
			"tender_id", tenderID, "rule_code", req.RuleCode)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetExport handles GET /api/v1/quality/export — выгрузка вердиктов для замера
// точности правил и наращивания каталога.
func (h *QualityHandler) GetExport(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.Export(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "quality export failed")
		return
	}
	renderJSON(w, r, http.StatusOK, exportEnvelope{Data: rows})
}
