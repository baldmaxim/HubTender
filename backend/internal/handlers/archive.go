package handlers

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// ---------------------------------------------------------------------------
// Request DTO
// ---------------------------------------------------------------------------

type composeScaleReq struct {
	Mode         string   `json:"mode"          validate:"omitempty,oneof=none factor volume_ratio"`
	Factor       *float64 `json:"factor"`
	SourceVolume *float64 `json:"source_volume"`
	TargetVolume *float64 `json:"target_volume"`
}

type composeSourceReq struct {
	SourcePositionID string           `json:"source_position_id" validate:"required,uuid"`
	SourceItemIDs    []string         `json:"source_item_ids"    validate:"omitempty,dive,uuid"`
	Scale            *composeScaleReq `json:"scale"`
}

type composeNewPositionReq struct {
	PositionNumber   *float64 `json:"position_number"`
	ItemNo           *string  `json:"item_no"`
	SectionNumber    *string  `json:"section_number"`
	PositionName     *string  `json:"position_name"`
	WorkName         string   `json:"work_name"          validate:"required,min=1"`
	UnitCode         *string  `json:"unit_code"`
	Volume           *float64 `json:"volume"`
	ManualVolume     *float64 `json:"manual_volume"`
	ClientNote       *string  `json:"client_note"`
	ManualNote       *string  `json:"manual_note"`
	HierarchyLevel   *int     `json:"hierarchy_level"`
	IsAdditional     bool     `json:"is_additional"`
	ParentPositionID *string  `json:"parent_position_id" validate:"omitempty,uuid"`
}

type composeTargetReq struct {
	PositionID  *string                `json:"position_id"  validate:"omitempty,uuid"`
	NewPosition *composeNewPositionReq `json:"new_position"`
}

type composeGroupReq struct {
	TempID  string             `json:"temp_id" validate:"required,min=1"`
	Target  composeTargetReq   `json:"target"`
	Sources []composeSourceReq `json:"sources" validate:"required,min=1,dive"`
}

type composeOptionsReq struct {
	OnMissingSource        string `json:"on_missing_source"          validate:"omitempty,oneof=fail skip"`
	CopyQuoteDates         bool   `json:"copy_quote_dates"`
	CopyDetailCostCategory *bool  `json:"copy_detail_cost_category"`
	QuantityDecimals       *int   `json:"quantity_decimals"          validate:"omitempty,gte=0,lte=9"`
}

type composeReq struct {
	TargetTenderID string             `json:"target_tender_id" validate:"required,uuid"`
	DryRun         bool               `json:"dry_run"`
	Options        *composeOptionsReq `json:"options"`
	Groups         []composeGroupReq  `json:"groups"           validate:"required,min=1,dive"`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Compose handles POST /api/v1/archive/compose.
//
// Создаёт позиции и строки BOQ в целевом тендере из исторических позиций чужих
// тендеров — одной транзакцией. `?verbose=1` добавляет построчную детализацию.
// При dry_run та же транзакция откатывается: ничего не записано, realtime молчит.
func (h *ArchiveHandler) Compose(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req composeReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.ComposeInput{
		TargetTenderID: req.TargetTenderID,
		ChangedBy:      authUser.ID,
		DryRun:         req.DryRun,
		Verbose:        boolParam(r.URL.Query().Get("verbose"), false),
		Options:        composeOptionsFromReq(req.Options),
		Groups:         composeGroupsFromReq(req.Groups),
	}

	res, err := h.svc.Compose(r.Context(), in)
	if err != nil {
		renderComposeError(w, r, req.TargetTenderID, err)
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: res})
}

func composeOptionsFromReq(o *composeOptionsReq) repository.ComposeOptions {
	out := repository.ComposeOptions{
		OnMissingSource:        repository.OnMissingSourceFail,
		CopyDetailCostCategory: true,
	}
	if o == nil {
		return out
	}
	if o.OnMissingSource != "" {
		out.OnMissingSource = o.OnMissingSource
	}
	out.CopyQuoteDates = o.CopyQuoteDates
	if o.CopyDetailCostCategory != nil {
		out.CopyDetailCostCategory = *o.CopyDetailCostCategory
	}
	out.QuantityDecimals = o.QuantityDecimals
	return out
}

func composeGroupsFromReq(groups []composeGroupReq) []repository.ComposeGroup {
	out := make([]repository.ComposeGroup, len(groups))
	for i, g := range groups {
		cg := repository.ComposeGroup{
			TempID:           g.TempID,
			TargetPositionID: g.Target.PositionID,
			Sources:          make([]repository.ComposeSource, len(g.Sources)),
		}
		if np := g.Target.NewPosition; np != nil {
			cg.NewPosition = &repository.NewTargetPosition{
				PositionNumber:   np.PositionNumber,
				ItemNo:           np.ItemNo,
				SectionNumber:    np.SectionNumber,
				PositionName:     np.PositionName,
				WorkName:         np.WorkName,
				UnitCode:         np.UnitCode,
				Volume:           np.Volume,
				ManualVolume:     np.ManualVolume,
				ClientNote:       np.ClientNote,
				ManualNote:       np.ManualNote,
				HierarchyLevel:   np.HierarchyLevel,
				IsAdditional:     np.IsAdditional,
				ParentPositionID: np.ParentPositionID,
			}
		}
		for j, s := range g.Sources {
			cs := repository.ComposeSource{
				SourcePositionID: s.SourcePositionID,
				SourceItemIDs:    s.SourceItemIDs,
			}
			if s.Scale != nil {
				cs.Scale = &repository.ScaleSpec{
					Mode:         s.Scale.Mode,
					Factor:       s.Scale.Factor,
					SourceVolume: s.Scale.SourceVolume,
					TargetVolume: s.Scale.TargetVolume,
				}
			}
			cg.Sources[j] = cs
		}
		out[i] = cg
	}
	return out
}

// renderComposeError разбирает доменные ошибки сборки в RFC 7807.
//
// Все 4xx поднимаются ДО коммита и откатывают транзакцию целиком: частичной
// сборки не бывает.
func renderComposeError(w http.ResponseWriter, r *http.Request, tenderID string, err error) {
	// Общие для копирования/переноса ошибки — теми же рендерерами.
	if renderMissingFXRate(w, err) {
		return
	}
	if renderInvalidBoqParent(w, err) {
		return
	}

	var specErr *repository.ArchiveTargetSpecError
	if errors.As(err, &specErr) {
		apierr.ArchiveTargetSpecInvalid(specErr.GroupTempID, specErr.Reason).Render(w)
		return
	}
	var dupErr *repository.ArchiveDuplicateTargetError
	if errors.As(err, &dupErr) {
		apierr.ArchiveDuplicateTarget(dupErr.GroupTempID, dupErr.PositionID).Render(w)
		return
	}
	var targetNotFound *repository.ArchiveTargetNotFoundError
	if errors.As(err, &targetNotFound) {
		apierr.ArchiveTargetPositionNotFound(targetNotFound.PositionID).Render(w)
		return
	}
	var scopeErr *repository.ArchiveTargetScopeError
	if errors.As(err, &scopeErr) {
		apierr.ArchiveTargetTenderMismatch(
			scopeErr.PositionID, scopeErr.ExpectedTenderID, scopeErr.ActualTenderID,
		).Render(w)
		return
	}
	var srcErr *repository.ArchiveSourceNotFoundError
	if errors.As(err, &srcErr) {
		apierr.ArchiveSourceNotFound(srcErr.Code(), srcErr.PositionID, srcErr.ItemID).Render(w)
		return
	}
	var emptyErr *repository.ArchiveNothingToComposeError
	if errors.As(err, &emptyErr) {
		apierr.ArchiveNothingToCompose().Render(w)
		return
	}
	var scaleErr *repository.ArchiveScaleError
	if errors.As(err, &scaleErr) {
		apierr.ArchiveScaleInvalid(scaleErr.Code(), scaleErr.GroupTempID, scaleErr.Reason).Render(w)
		return
	}
	var underflow *repository.ArchiveQuantityUnderflowError
	if errors.As(err, &underflow) {
		apierr.ArchiveQuantityUnderflow(
			underflow.GroupTempID, underflow.SourceItemID, underflow.Factor,
		).Render(w)
		return
	}
	var staleErr *repository.StaleCalculationResultError
	if errors.As(err, &staleErr) {
		apierr.ArchiveConcurrentModification(tenderID).Render(w)
		return
	}
	var tenderNotFound *repository.CachedGrandTotalTenderNotFoundError
	if errors.As(err, &tenderNotFound) {
		apierr.NotFound("тендер не найден").Render(w)
		return
	}

	apierr.InternalFromErr(w, r, err, "не удалось собрать смету из архива")
}
