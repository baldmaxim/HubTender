package handlers

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/quality"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// qualityServicer is the interface QualityHandler depends on.
type qualityServicer interface {
	Report(ctx context.Context, tenderID string, opts services.ReportOptions) (*repository.QualityReport, error)
	SetVerdict(ctx context.Context, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
	SetVerdictFrom(ctx context.Context, source, tenderID, ruleCode, entityID, fingerprint, verdict string,
		note *string, changedBy *string) error
	SetVerdicts(ctx context.Context, tenderID string, in []repository.VerdictInput,
		changedBy *string) error
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

// verdictSource — откуда вердикт для истории находки: ключ или интерфейс.
func verdictSource(r *http.Request) string {
	if middleware.APIKeyFromContext(r.Context()) != nil {
		return "api"
	}
	return "ui"
}

// runTrigger — источник прогона: машинный ключ пишется отдельно от просмотра
// страницы, чтобы в истории было видно, кто гонял проверку.
func runTrigger(r *http.Request, human string) string {
	if middleware.APIKeyFromContext(r.Context()) != nil && human == repository.RunTriggerView {
		return repository.RunTriggerAPI
	}
	return human
}

// GetReport handles GET /api/v1/tenders/:id/quality.
// Query params: refresh=1 обходит кэш; only_new=1 — только появившиеся после
// отметки «Проверка завершена»; open_only=1 — без принятых как норма;
// rule=U,V — только указанные правила. Фильтры нужны внешнему агенту: полный
// отчёт по крупному тендеру — тысячи находок.
func (h *QualityHandler) GetReport(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	opts := services.ReportOptions{
		Refresh: r.URL.Query().Get("refresh") == "1",
		Trigger: runTrigger(r, repository.RunTriggerView),
	}
	if u := middleware.UserFromContext(r.Context()); u != nil {
		opts.UserID = &u.ID
	}

	rep, err := h.svc.Report(r.Context(), tenderID, opts)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "quality report failed", "tender_id", tenderID)
		return
	}

	q := r.URL.Query()
	rep = filterReport(rep, reportFilter{
		OnlyNew:  q.Get("only_new") == "1",
		OpenOnly: q.Get("open_only") == "1",
		Rules:    splitRules(q.Get("rule")),
	})
	renderJSON(w, r, http.StatusOK, qualityEnvelope{Data: rep})
}

// PostCheckpoint handles POST /api/v1/tenders/:id/quality/checkpoint — «Проверка
// завершена». Правила прогоняются заново, и этот прогон становится точкой, от
// которой считается новизна: всё, что есть сейчас, считается просмотренным.
func (h *QualityHandler) PostCheckpoint(w http.ResponseWriter, r *http.Request) {
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

	rep, err := h.svc.Report(r.Context(), tenderID, services.ReportOptions{
		Refresh: true,
		Trigger: repository.RunTriggerCheckpoint,
		UserID:  &authUser.ID,
	})
	if err != nil {
		apierr.InternalFromErr(w, r, err, "quality checkpoint failed", "tender_id", tenderID)
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

	err := h.svc.SetVerdictFrom(r.Context(), verdictSource(r), tenderID, req.RuleCode, req.EntityID,
		req.Fingerprint, req.Verdict, req.Note, &authUser.ID)
	if err != nil {
		apierr.InternalFromErr(w, r, err, "quality verdict failed",
			"tender_id", tenderID, "rule_code", req.RuleCode)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// maxBulkVerdicts ограничивает размер пачки. Правило Q даёт больше пяти тысяч
// находок, поэтому «принять всю группу» клиент режет на части — так один
// сорвавшийся запрос не отменяет всю работу инженера.
const maxBulkVerdicts = 5000

type verdictsRequest struct {
	Items []verdictRequest `json:"items"`
}

// PostVerdicts handles POST /api/v1/tenders/:id/quality/verdicts — пачка решений
// за один запрос («принять всю группу»).
func (h *QualityHandler) PostVerdicts(w http.ResponseWriter, r *http.Request) {
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

	var req verdictsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid json body").Render(w)
		return
	}
	if len(req.Items) == 0 {
		apierr.BadRequest("items must not be empty").Render(w)
		return
	}
	if len(req.Items) > maxBulkVerdicts {
		apierr.BadRequest("too many items in one request").Render(w)
		return
	}

	in := make([]repository.VerdictInput, 0, len(req.Items))
	for i := range req.Items {
		it := req.Items[i]
		if it.RuleCode == "" || it.EntityID == "" || it.Fingerprint == "" {
			apierr.BadRequest("rule_code, entity_id and fingerprint are required").Render(w)
			return
		}
		if it.Verdict != "accepted" && it.Verdict != "error" {
			apierr.BadRequest("verdict must be 'accepted' or 'error'").Render(w)
			return
		}
		in = append(in, repository.VerdictInput{
			RuleCode:    it.RuleCode,
			EntityID:    it.EntityID,
			Fingerprint: it.Fingerprint,
			Verdict:     it.Verdict,
			Note:        it.Note,
			Source:      verdictSource(r),
		})
	}

	if err := h.svc.SetVerdicts(r.Context(), tenderID, in, &authUser.ID); err != nil {
		apierr.InternalFromErr(w, r, err, "quality bulk verdict failed",
			"tender_id", tenderID, "count", len(in))
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
