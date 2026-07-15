package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	ia "github.com/su10/hubtender/backend/internal/importanalysis"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type smartImportServicer interface {
	Analyze(ctx context.Context, tenderID, fileName string, data []byte, opts ia.Options) (*ia.Analysis, error)
	Execute(ctx context.Context, tenderID, fileName string, data []byte, expectedFingerprint string, opts ia.Options, userID string) (*services.ExecuteResult, error)
}

// SmartImportHandler — POST /api/v1/tenders/{id}/boq-import/{analyze|execute}.
type SmartImportHandler struct {
	svc smartImportServicer
}

// NewSmartImportHandler creates a SmartImportHandler.
func NewSmartImportHandler(svc smartImportServicer) *SmartImportHandler {
	return &SmartImportHandler{svc: svc}
}

// readUpload — multipart file с жёстким лимитом (§15); файл живёт только в
// памяти запроса и нигде не сохраняется.
func readUpload(w http.ResponseWriter, r *http.Request) (string, []byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, ia.MaxCompressedBytes+1<<20)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		apierr.BadRequest("не удалось разобрать multipart-запрос (проверьте размер файла)").Render(w)
		return "", nil, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		apierr.BadRequest("поле file обязательно").Render(w)
		return "", nil, false
	}
	defer file.Close() //nolint:errcheck
	if !strings.HasSuffix(strings.ToLower(header.Filename), ".xlsx") {
		apierr.BadRequest("поддерживается только формат .xlsx").Render(w)
		return "", nil, false
	}
	data, err := io.ReadAll(io.LimitReader(file, ia.MaxCompressedBytes+1))
	if err != nil {
		apierr.BadRequest("не удалось прочитать файл").Render(w)
		return "", nil, false
	}
	return header.Filename, data, true
}

func parseImportOptions(r *http.Request) ia.Options {
	opts := ia.Options{
		SheetName: r.FormValue("sheet_name"),
		Locale:    r.FormValue("locale"),
	}
	if hr, err := strconv.Atoi(r.FormValue("header_row")); err == nil && hr > 0 {
		opts.HeaderRow = hr
	}
	if raw := r.FormValue("mapping"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &opts.MappingOverrides)
	}
	if raw := r.FormValue("confirmed_options"); raw != "" {
		var c struct {
			AcceptFormulaCached bool   `json:"accept_formula_cached"`
			DefaultCurrency     string `json:"default_currency"`
			DefaultBoqType      string `json:"default_boq_type"`
		}
		if json.Unmarshal([]byte(raw), &c) == nil {
			opts.AcceptFormulaCached = c.AcceptFormulaCached
			opts.DefaultCurrency = c.DefaultCurrency
			opts.DefaultBoqType = c.DefaultBoqType
		}
	}
	return opts
}

func (h *SmartImportHandler) renderImportError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, repository.ErrQualityTenderNotFound) {
		apierr.NotFound("tender not found").Render(w)
		return
	}
	var limitErr *ia.WorkbookLimitError
	if errors.As(err, &limitErr) {
		(&apierr.ProblemExtra{
			Problem: apierr.Problem{Type: "about:blank", Title: "Payload Too Large",
				Status: http.StatusRequestEntityTooLarge, Detail: limitErr.Reason},
			Extras: map[string]any{"code": limitErr.Code},
		}).Render(w)
		return
	}
	var invalidErr *ia.InvalidWorkbookError
	if errors.As(err, &invalidErr) {
		apierr.BadRequest(invalidErr.Reason).Render(w)
		return
	}
	var fpErr *services.FingerprintMismatchError
	if errors.As(err, &fpErr) {
		(&apierr.ProblemExtra{
			Problem: apierr.Problem{Type: "about:blank", Title: "Conflict",
				Status: http.StatusConflict, Detail: "Файл изменился между анализом и импортом — выполните анализ заново."},
			Extras: map[string]any{"code": "BOQ_IMPORT_FINGERPRINT_MISMATCH"},
		}).Render(w)
		return
	}
	var blockErr *services.BlockersPresentError
	if errors.As(err, &blockErr) {
		(&apierr.ProblemExtra{
			Problem: apierr.Problem{Type: "about:blank", Title: "Conflict",
				Status: http.StatusConflict, Detail: "Импорт запрещён: остались blockers либо несопоставленные обязательные поля."},
			Extras: map[string]any{"code": "BOQ_IMPORT_BLOCKERS_PRESENT",
				"blocked_rows": blockErr.Blockers, "required_missing": blockErr.Missing},
		}).Render(w)
		return
	}
	if renderMissingFXRate(w, err) {
		return
	}
	apierr.InternalFromErr(w, r, err, "smart import failed")
}

// AnalyzeBoqImport — POST /api/v1/tenders/{id}/boq-import/analyze (§3).
func (h *SmartImportHandler) AnalyzeBoqImport(w http.ResponseWriter, r *http.Request) {
	if middleware.UserFromContext(r.Context()) == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	fileName, data, ok := readUpload(w, r)
	if !ok {
		return
	}
	an, err := h.svc.Analyze(r.Context(), tenderID, fileName, data, parseImportOptions(r))
	if err != nil {
		h.renderImportError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: an.Result})
}

// ExecuteBoqImport — POST /api/v1/tenders/{id}/boq-import/execute (§4):
// повторный серверный parse + существующий authoritative import.
func (h *SmartImportHandler) ExecuteBoqImport(w http.ResponseWriter, r *http.Request) {
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
	fileName, data, ok := readUpload(w, r)
	if !ok {
		return
	}
	fingerprint := r.FormValue("workbook_fingerprint")
	if fingerprint == "" {
		apierr.BadRequest("workbook_fingerprint обязателен").Render(w)
		return
	}
	result, err := h.svc.Execute(r.Context(), tenderID, fileName, data, fingerprint,
		parseImportOptions(r), authUser.ID)
	if err != nil {
		h.renderImportError(w, r, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: result})
}
