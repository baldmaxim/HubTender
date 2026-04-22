package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// importBoqServicer is the interface ImportBoqHandler depends on.
type importBoqServicer interface {
	BulkImport(ctx context.Context, in repository.ImportInput) (*repository.ImportResult, error)
}

// ImportBoqHandler handles POST /api/v1/imports/boq.
type ImportBoqHandler struct {
	svc      importBoqServicer
	validate *validator.Validate
}

// NewImportBoqHandler creates an ImportBoqHandler.
func NewImportBoqHandler(svc importBoqServicer) *ImportBoqHandler {
	return &ImportBoqHandler{svc: svc, validate: validator.New()}
}

// importBoqReq is the JSON body for POST /api/v1/imports/boq.
// Items and PositionUpdates may be empty slices — that is a valid no-op call.
type importBoqReq struct {
	TenderID        string                          `json:"tender_id" validate:"required,uuid"`
	FileName        string                          `json:"file_name" validate:"required"`
	Items           []repository.ImportBoqItem      `json:"items"`
	PositionUpdates []repository.ImportPositionUpdate `json:"position_updates"`
}

// importBoqResp is the JSON body returned on success.
type importBoqResp struct {
	ImportSessionID      *string `json:"import_session_id"`
	InsertedItemsCount   int     `json:"inserted_items_count"`
	UpdatedPositionsCount int    `json:"updated_positions_count"`
}

// BulkImport handles POST /api/v1/imports/boq.
//
// The authenticated user's ID is taken from the JWT context (never from the
// body). Empty items/position_updates slices are accepted and produce a
// 200 with zeroed counts and a null import_session_id.
func (h *ImportBoqHandler) BulkImport(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req importBoqReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	// Nil slices from JSON decode (omitted keys) are safe — repo handles them.
	in := repository.ImportInput{
		TenderID:        req.TenderID,
		FileName:        req.FileName,
		UserID:          authUser.ID,
		Items:           req.Items,
		PositionUpdates: req.PositionUpdates,
	}

	result, err := h.svc.BulkImport(r.Context(), in)
	if err != nil {
		var bulkErr *repository.ErrBulkImport
		if errors.As(err, &bulkErr) {
			apierr.BadRequest(bulkErr.Message).Render(w)
			return
		}
		apierr.InternalError("failed to import BOQ items").Render(w)
		return
	}

	renderJSON(w, r, http.StatusOK, importBoqResp{
		ImportSessionID:       result.ImportSessionID,
		InsertedItemsCount:    result.InsertedItemsCount,
		UpdatedPositionsCount: result.UpdatedPositionsCount,
	})
}
