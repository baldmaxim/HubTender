package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// markupServicer is the interface MarkupHandler depends on.
type markupServicer interface {
	ListTactics(ctx context.Context) ([]repository.MarkupTacticRow, error)
	GetTactic(ctx context.Context, id string) (*repository.MarkupTacticRow, error)
	FindGlobalTacticByName(ctx context.Context, name string) (*repository.MarkupTacticRow, error)
	CreateTactic(ctx context.Context, in repository.MarkupTacticInput) (*repository.MarkupTacticRow, error)
	UpdateTactic(ctx context.Context, id string, p repository.MarkupTacticPatch) error
	RenameTactic(ctx context.Context, id, name string) error
	DeleteTactic(ctx context.Context, id string) error
	ListActiveParameters(ctx context.Context) ([]repository.MarkupParameterRow, error)
	CreateParameter(ctx context.Context, in repository.MarkupParameterInput) error
	UpdateParameter(ctx context.Context, id string, p repository.MarkupParameterPatch) error
	DeleteParameter(ctx context.Context, id string) error
	SetParameterOrderNum(ctx context.Context, id string, orderNum int) error
	GetTenderTacticID(ctx context.Context, tenderID string) (*string, error)
	SetTenderTacticID(ctx context.Context, tenderID, tacticID string) error
	ListTenderMarkupPercentages(ctx context.Context, tenderID string) ([]repository.TenderMarkupPctRow, error)
	ReplaceTenderMarkupPercentages(ctx context.Context, tenderID string, records []repository.TenderMarkupPctInput) error
	GetPricingDistribution(ctx context.Context, tenderID string) (*repository.PricingDistributionRow, error)
	UpsertPricingDistribution(ctx context.Context, in repository.PricingDistributionInput) (*repository.PricingDistributionRow, error)
	ListSubcontractExclusions(ctx context.Context, tenderID string) ([]repository.SubcontractExclusionRow, error)
	InsertSubcontractExclusion(ctx context.Context, in repository.SubcontractExclusionInput) error
	InsertSubcontractExclusionsBatch(ctx context.Context, rows []repository.SubcontractExclusionInput) error
	DeleteSubcontractExclusion(ctx context.Context, in repository.SubcontractExclusionInput) error
	DeleteSubcontractExclusionsBatch(ctx context.Context, tenderID string, ids []string, exclusionType string) error
}

// MarkupHandler serves Admin/Markup* endpoints.
type MarkupHandler struct {
	svc markupServicer
}

// NewMarkupHandler creates a MarkupHandler.
func NewMarkupHandler(svc markupServicer) *MarkupHandler {
	return &MarkupHandler{svc: svc}
}

// ─── Tactics ────────────────────────────────────────────────────────────────

func (h *MarkupHandler) ListTactics(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListTactics(r.Context())
	if err != nil {
		apierr.InternalError("failed to list tactics").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.MarkupTacticRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *MarkupHandler) GetTactic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	row, err := h.svc.GetTactic(r.Context(), id)
	if err != nil {
		apierr.InternalError("failed to load tactic").Render(w)
		return
	}
	if row == nil {
		apierr.NotFound("tactic not found").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

func (h *MarkupHandler) FindGlobalTactic(w http.ResponseWriter, r *http.Request) {
	name := r.URL.Query().Get("name")
	if name == "" {
		apierr.BadRequest("name query param required").Render(w)
		return
	}
	row, err := h.svc.FindGlobalTacticByName(r.Context(), name)
	if err != nil {
		apierr.InternalError("failed to find global tactic").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

func (h *MarkupHandler) CreateTactic(w http.ResponseWriter, r *http.Request) {
	var in repository.MarkupTacticInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	row, err := h.svc.CreateTactic(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to create tactic").Render(w)
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: row})
}

func (h *MarkupHandler) UpdateTactic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var p repository.MarkupTacticPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateTactic(r.Context(), id, p); err != nil {
		apierr.InternalError("failed to update tactic").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type renameReq struct {
	Name string `json:"name"`
}

func (h *MarkupHandler) RenameTactic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var req renameReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.RenameTactic(r.Context(), id, req.Name); err != nil {
		apierr.InternalError("failed to rename tactic").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MarkupHandler) DeleteTactic(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteTactic(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete tactic").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Parameters ────────────────────────────────────────────────────────────

func (h *MarkupHandler) ListParameters(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListActiveParameters(r.Context())
	if err != nil {
		apierr.InternalError("failed to list parameters").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.MarkupParameterRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *MarkupHandler) CreateParameter(w http.ResponseWriter, r *http.Request) {
	var in repository.MarkupParameterInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.CreateParameter(r.Context(), in); err != nil {
		apierr.InternalError("failed to create parameter").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *MarkupHandler) UpdateParameter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var p repository.MarkupParameterPatch
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.UpdateParameter(r.Context(), id, p); err != nil {
		apierr.InternalError("failed to update parameter").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *MarkupHandler) DeleteParameter(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	if err := h.svc.DeleteParameter(r.Context(), id); err != nil {
		apierr.InternalError("failed to delete parameter").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type setOrderNumReq struct {
	OrderNum int `json:"order_num"`
}

func (h *MarkupHandler) SetParameterOrderNum(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var req setOrderNumReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Allow query param fallback for simple consumers.
		if v := r.URL.Query().Get("order_num"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				apierr.BadRequest("invalid order_num").Render(w)
				return
			}
			req.OrderNum = n
		} else {
			apierr.BadRequest("invalid JSON body").Render(w)
			return
		}
	}
	if err := h.svc.SetParameterOrderNum(r.Context(), id, req.OrderNum); err != nil {
		apierr.InternalError("failed to set order num").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── Tender ↔ tactic ───────────────────────────────────────────────────────

func (h *MarkupHandler) GetTenderTacticID(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	id, err := h.svc.GetTenderTacticID(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to load tactic id").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, map[string]any{"markup_tactic_id": id})
}

type setTacticReq struct {
	MarkupTacticID string `json:"markup_tactic_id"`
}

func (h *MarkupHandler) SetTenderTacticID(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	var req setTacticReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.SetTenderTacticID(r.Context(), tenderID, req.MarkupTacticID); err != nil {
		apierr.InternalError("failed to set tactic id").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── tender_markup_percentage ──────────────────────────────────────────────

func (h *MarkupHandler) ListTenderMarkupPercentages(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	rows, err := h.svc.ListTenderMarkupPercentages(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to list percentages").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.TenderMarkupPctRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

type replacePercentagesReq struct {
	Records []repository.TenderMarkupPctInput `json:"records"`
}

func (h *MarkupHandler) ReplaceTenderMarkupPercentages(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	var req replacePercentagesReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.ReplaceTenderMarkupPercentages(r.Context(), tenderID, req.Records); err != nil {
		apierr.InternalError("failed to replace percentages").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ─── tender_pricing_distribution ───────────────────────────────────────────

func (h *MarkupHandler) GetPricingDistribution(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	row, err := h.svc.GetPricingDistribution(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to load pricing distribution").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

func (h *MarkupHandler) UpsertPricingDistribution(w http.ResponseWriter, r *http.Request) {
	var in repository.PricingDistributionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if in.TenderID == "" {
		apierr.BadRequest("tender_id required").Render(w)
		return
	}
	row, err := h.svc.UpsertPricingDistribution(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to save pricing distribution").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: row})
}

// ─── subcontract_growth_exclusions ─────────────────────────────────────────

func (h *MarkupHandler) ListSubcontractExclusions(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}
	rows, err := h.svc.ListSubcontractExclusions(r.Context(), tenderID)
	if err != nil {
		apierr.InternalError("failed to list exclusions").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.SubcontractExclusionRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

func (h *MarkupHandler) InsertSubcontractExclusion(w http.ResponseWriter, r *http.Request) {
	var in repository.SubcontractExclusionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.InsertSubcontractExclusion(r.Context(), in); err != nil {
		apierr.InternalError("failed to insert exclusion").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

type subcontractBatchInsertReq struct {
	Rows []repository.SubcontractExclusionInput `json:"rows"`
}

func (h *MarkupHandler) InsertSubcontractExclusionsBatch(w http.ResponseWriter, r *http.Request) {
	var req subcontractBatchInsertReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.InsertSubcontractExclusionsBatch(r.Context(), req.Rows); err != nil {
		apierr.InternalError("failed to insert exclusions batch").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

func (h *MarkupHandler) DeleteSubcontractExclusion(w http.ResponseWriter, r *http.Request) {
	var in repository.SubcontractExclusionInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.DeleteSubcontractExclusion(r.Context(), in); err != nil {
		apierr.InternalError("failed to delete exclusion").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type subcontractBatchDeleteReq struct {
	TenderID             string   `json:"tender_id"`
	DetailCostCategoryIDs []string `json:"detail_cost_category_ids"`
	ExclusionType        string   `json:"exclusion_type"`
}

func (h *MarkupHandler) DeleteSubcontractExclusionsBatch(w http.ResponseWriter, r *http.Request) {
	var req subcontractBatchDeleteReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.DeleteSubcontractExclusionsBatch(r.Context(), req.TenderID, req.DetailCostCategoryIDs, req.ExclusionType); err != nil {
		apierr.InternalError("failed to delete exclusions batch").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
