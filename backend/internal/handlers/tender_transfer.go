package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// transferServicer is the interface TenderTransferHandler depends on.
type transferServicer interface {
	ExecuteVersionTransfer(
		ctx context.Context,
		in repository.TransferInput,
	) (*repository.TransferResult, error)
}

// TenderTransferHandler handles POST /api/v1/tenders/{id}/versions/transfer.
type TenderTransferHandler struct {
	svc      transferServicer
	validate *validator.Validate
}

// NewTenderTransferHandler creates a TenderTransferHandler.
func NewTenderTransferHandler(svc transferServicer) *TenderTransferHandler {
	return &TenderTransferHandler{svc: svc, validate: validator.New()}
}

// ---------------------------------------------------------------------------
// Request DTO
// ---------------------------------------------------------------------------

// transferNewPositionReq mirrors NewPositionInput for JSON decoding + validation.
type transferNewPositionReq struct {
	RowIndex       int      `json:"row_index"       validate:"gte=0"`
	ItemNo         *string  `json:"item_no"`
	UnitCode       *string  `json:"unit_code"`
	ClientNote     *string  `json:"client_note"`
	WorkName       string   `json:"work_name"       validate:"required,min=1"`
	Volume         *float64 `json:"volume"`
	HierarchyLevel *int     `json:"hierarchy_level"`
}

// transferMatchReq mirrors MatchInput for JSON decoding + validation.
type transferMatchReq struct {
	OldPositionID string `json:"old_position_id" validate:"uuid"`
	NewRowIndex   int    `json:"new_row_index"   validate:"gte=0"`
}

// transferReq is the full JSON body for the endpoint.
type transferReq struct {
	NewPositions []transferNewPositionReq `json:"new_positions" validate:"required,min=1,dive"`
	Matches      []transferMatchReq       `json:"matches"       validate:"omitempty,dive"`
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

// Transfer handles POST /api/v1/tenders/{id}/versions/transfer.
//
// The {id} path param is the source tender UUID. On success it returns 201
// with the TransferResult envelope. On business errors it dispatches:
//   - 404 — source tender not found
//   - 409 — target version already exists
//   - 400 — validation failure
//   - 500 — unexpected DB error
func (h *TenderTransferHandler) Transfer(w http.ResponseWriter, r *http.Request) {
	sourceTenderID := chi.URLParam(r, "id")
	if sourceTenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	var req transferReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	// Map DTO → domain input.
	newPositions := make([]repository.NewPositionInput, len(req.NewPositions))
	for i, p := range req.NewPositions {
		newPositions[i] = repository.NewPositionInput{
			RowIndex:       p.RowIndex,
			ItemNo:         p.ItemNo,
			UnitCode:       p.UnitCode,
			ClientNote:     p.ClientNote,
			WorkName:       p.WorkName,
			Volume:         p.Volume,
			HierarchyLevel: p.HierarchyLevel,
		}
	}

	matches := make([]repository.MatchInput, len(req.Matches))
	for i, m := range req.Matches {
		matches[i] = repository.MatchInput{
			OldPositionID: m.OldPositionID,
			NewRowIndex:   m.NewRowIndex,
		}
	}

	in := repository.TransferInput{
		SourceTenderID: sourceTenderID,
		NewPositions:   newPositions,
		Matches:        matches,
	}

	result, err := h.svc.ExecuteVersionTransfer(r.Context(), in)
	if err != nil {
		var transferErr *repository.ErrVersionTransfer
		if errors.As(err, &transferErr) {
			switch transferErr.HTTPStatus {
			case 404:
				apierr.NotFound(transferErr.Message).Render(w)
			case 409:
				apierr.Conflict(transferErr.Message).Render(w)
			default:
				apierr.InternalError(transferErr.Message).Render(w)
			}
			return
		}
		apierr.InternalError("failed to execute version transfer").Render(w)
		return
	}

	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: result})
}
