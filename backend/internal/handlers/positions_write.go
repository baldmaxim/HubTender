package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// positionWriteServicer extends positionServicer with write methods.
type positionWriteServicer interface {
	positionServicer
	GetPositionByID(ctx context.Context, id string) (*repository.PositionRow, error)
	CreatePosition(ctx context.Context, in repository.CreatePositionInput) (*repository.PositionRow, error)
	UpdatePosition(ctx context.Context, id string, in repository.UpdatePositionInput, tenderID string) (*repository.PositionRow, error)
}

// PositionWriteHandler handles mutating position endpoints.
type PositionWriteHandler struct {
	svc      positionWriteServicer
	validate *validator.Validate
}

// NewPositionWriteHandler creates a PositionWriteHandler.
func NewPositionWriteHandler(svc positionWriteServicer) *PositionWriteHandler {
	return &PositionWriteHandler{svc: svc, validate: validator.New()}
}

// createPositionReq is the request body for POST /api/v1/positions.
type createPositionReq struct {
	TenderID         string   `json:"tender_id" validate:"required,uuid"`
	PositionNumber   int      `json:"position_number" validate:"required,min=1"`
	WorkName         string   `json:"work_name" validate:"required,max=1024"`
	UnitCode         *string  `json:"unit_code"`
	Volume           *float64 `json:"volume" validate:"omitempty,gte=0"`
	ParentPositionID *string  `json:"parent_position_id" validate:"omitempty,uuid"`
	HierarchyLevel   *int     `json:"hierarchy_level" validate:"omitempty,min=0"`
	IsAdditional     *bool    `json:"is_additional"`
	ItemNo           *string  `json:"item_no" validate:"omitempty,max=64"`
}

// updatePositionReq is the request body for PATCH /api/v1/positions/:id.
type updatePositionReq struct {
	PositionNumber   *int     `json:"position_number" validate:"omitempty,min=1"`
	WorkName         *string  `json:"work_name" validate:"omitempty,max=1024"`
	UnitCode         *string  `json:"unit_code"`
	Volume           *float64 `json:"volume" validate:"omitempty,gte=0"`
	ParentPositionID *string  `json:"parent_position_id" validate:"omitempty,uuid"`
	HierarchyLevel   *int     `json:"hierarchy_level" validate:"omitempty,min=0"`
	IsAdditional     *bool    `json:"is_additional"`
	ItemNo           *string  `json:"item_no" validate:"omitempty,max=64"`
}

// CreatePosition handles POST /api/v1/positions.
func (h *PositionWriteHandler) CreatePosition(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req createPositionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.CreatePositionInput{
		TenderID:         req.TenderID,
		PositionNumber:   req.PositionNumber,
		WorkName:         req.WorkName,
		UnitCode:         req.UnitCode,
		Volume:           req.Volume,
		ParentPositionID: req.ParentPositionID,
		HierarchyLevel:   req.HierarchyLevel,
		IsAdditional:     req.IsAdditional,
		ItemNo:           req.ItemNo,
		CreatedBy:        authUser.ID,
	}

	pos, err := h.svc.CreatePosition(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to create position").Render(w)
		return
	}

	setResourceETag(w, pos.ID, pos.UpdatedAt)
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: pos})
}

// UpdatePosition handles PATCH /api/v1/positions/:id.
func (h *PositionWriteHandler) UpdatePosition(w http.ResponseWriter, r *http.Request) {
	posID := chi.URLParam(r, "id")
	if posID == "" {
		apierr.BadRequest("missing position id").Render(w)
		return
	}

	current, err := h.svc.GetPositionByID(r.Context(), posID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("position not found").Render(w)
			return
		}
		apierr.InternalError("failed to load position").Render(w)
		return
	}

	if r.Header.Get("If-Match") == "" {
		apierr.PreconditionRequired("If-Match header is required for updates").Render(w)
		return
	}
	if !checkIfMatch(r, current.ID, current.UpdatedAt) {
		currentETag := computeResourceETag(current.ID, current.UpdatedAt)
		apierr.PreconditionFailed("resource has been modified; reload and retry", map[string]any{
			"current_etag": currentETag,
			"current":      current,
		}).Render(w)
		return
	}

	var req updatePositionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.UpdatePositionInput{
		PositionNumber:   req.PositionNumber,
		WorkName:         req.WorkName,
		UnitCode:         req.UnitCode,
		Volume:           req.Volume,
		ParentPositionID: req.ParentPositionID,
		HierarchyLevel:   req.HierarchyLevel,
		IsAdditional:     req.IsAdditional,
		ItemNo:           req.ItemNo,
	}

	updated, err := h.svc.UpdatePosition(r.Context(), posID, in, current.TenderID)
	if err != nil {
		apierr.InternalError("failed to update position").Render(w)
		return
	}

	setResourceETag(w, updated.ID, updated.UpdatedAt)
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: updated})
}
