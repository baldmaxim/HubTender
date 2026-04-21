package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"
	"github.com/jackc/pgx/v5"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// tenderWriteServicer extends tenderServicer with write methods.
type tenderWriteServicer interface {
	tenderServicer
	GetTenderByID(ctx context.Context, id string) (*repository.TenderRow, error)
	CreateTender(ctx context.Context, in repository.CreateTenderInput) (*repository.TenderRow, error)
	UpdateTender(ctx context.Context, id string, in repository.UpdateTenderInput) (*repository.TenderRow, error)
}

// TenderWriteHandler handles mutating tender endpoints.
type TenderWriteHandler struct {
	svc      tenderWriteServicer
	validate *validator.Validate
}

// NewTenderWriteHandler creates a TenderWriteHandler.
func NewTenderWriteHandler(svc tenderWriteServicer) *TenderWriteHandler {
	return &TenderWriteHandler{svc: svc, validate: validator.New()}
}

// createTenderReq is the request body for POST /api/v1/tenders.
type createTenderReq struct {
	TenderNumber       string     `json:"tender_number" validate:"required,max=64"`
	Title              string     `json:"title" validate:"required,max=512"`
	ClientName         string     `json:"client_name" validate:"required,max=512"`
	HousingClass       *string    `json:"housing_class"`
	ConstructionScope  *string    `json:"construction_scope"`
	USDRate            *float64   `json:"usd_rate" validate:"omitempty,gt=0"`
	EURRate            *float64   `json:"eur_rate" validate:"omitempty,gt=0"`
	CNYRate            *float64   `json:"cny_rate" validate:"omitempty,gt=0"`
	SubmissionDeadline *time.Time `json:"submission_deadline"`
	Description        *string    `json:"description"`
}

// updateTenderReq is the request body for PATCH /api/v1/tenders/:id.
type updateTenderReq struct {
	TenderNumber       *string    `json:"tender_number" validate:"omitempty,max=64"`
	Title              *string    `json:"title" validate:"omitempty,max=512"`
	ClientName         *string    `json:"client_name" validate:"omitempty,max=512"`
	HousingClass       *string    `json:"housing_class"`
	ConstructionScope  *string    `json:"construction_scope"`
	USDRate            *float64   `json:"usd_rate" validate:"omitempty,gt=0"`
	EURRate            *float64   `json:"eur_rate" validate:"omitempty,gt=0"`
	CNYRate            *float64   `json:"cny_rate" validate:"omitempty,gt=0"`
	SubmissionDeadline *time.Time `json:"submission_deadline"`
	Description        *string    `json:"description"`
}

// CreateTender handles POST /api/v1/tenders.
func (h *TenderWriteHandler) CreateTender(w http.ResponseWriter, r *http.Request) {
	authUser := middleware.UserFromContext(r.Context())
	if authUser == nil {
		apierr.Unauthorized("missing auth context").Render(w)
		return
	}

	var req createTenderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.CreateTenderInput{
		TenderNumber:       req.TenderNumber,
		Title:              req.Title,
		ClientName:         req.ClientName,
		HousingClass:       req.HousingClass,
		ConstructionScope:  req.ConstructionScope,
		USDRate:            req.USDRate,
		EURRate:            req.EURRate,
		CNYRate:            req.CNYRate,
		SubmissionDeadline: req.SubmissionDeadline,
		Description:        req.Description,
		CreatedBy:          authUser.ID,
	}

	t, err := h.svc.CreateTender(r.Context(), in)
	if err != nil {
		apierr.InternalError("failed to create tender").Render(w)
		return
	}

	setResourceETag(w, t.ID, t.UpdatedAt)
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: t})
}

// UpdateTender handles PATCH /api/v1/tenders/:id.
func (h *TenderWriteHandler) UpdateTender(w http.ResponseWriter, r *http.Request) {
	tenderID := chi.URLParam(r, "id")
	if tenderID == "" {
		apierr.BadRequest("missing tender id").Render(w)
		return
	}

	// Fetch current row to validate ETag.
	current, err := h.svc.GetTenderByID(r.Context(), tenderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			apierr.NotFound("tender not found").Render(w)
			return
		}
		apierr.InternalError("failed to load tender").Render(w)
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

	var req updateTenderReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.validate.Struct(req); err != nil {
		apierr.BadRequest("validation failed: " + err.Error()).Render(w)
		return
	}

	in := repository.UpdateTenderInput{
		TenderNumber:       req.TenderNumber,
		Title:              req.Title,
		ClientName:         req.ClientName,
		HousingClass:       req.HousingClass,
		ConstructionScope:  req.ConstructionScope,
		USDRate:            req.USDRate,
		EURRate:            req.EURRate,
		CNYRate:            req.CNYRate,
		SubmissionDeadline: req.SubmissionDeadline,
		Description:        req.Description,
	}

	updated, err := h.svc.UpdateTender(r.Context(), tenderID, in)
	if err != nil {
		apierr.InternalError("failed to update tender").Render(w)
		return
	}

	setResourceETag(w, updated.ID, updated.UpdatedAt)
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: updated})
}
