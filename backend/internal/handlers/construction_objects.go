package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

var constructionObjectUUIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// constructionObjectsServicer is the interface ConstructionObjectsHandler depends on.
type constructionObjectsServicer interface {
	List(ctx context.Context) ([]repository.ConstructionObjectRow, error)
	Create(ctx context.Context, in repository.ConstructionObjectInput, createdBy *string) (*repository.ConstructionObjectRow, error)
	Update(ctx context.Context, id string, in repository.ConstructionObjectInput) (*repository.ConstructionObjectRow, error)
	Delete(ctx context.Context, id string) error
}

// ConstructionObjectsHandler serves /api/v1/construction-objects.
type ConstructionObjectsHandler struct {
	svc constructionObjectsServicer
}

// NewConstructionObjectsHandler creates a ConstructionObjectsHandler.
func NewConstructionObjectsHandler(svc constructionObjectsServicer) *ConstructionObjectsHandler {
	return &ConstructionObjectsHandler{svc: svc}
}

// constructionObjectReq — тело POST/PATCH (полная замена всех полей).
type constructionObjectReq struct {
	Name              string   `json:"name"`
	Area              *float64 `json:"area"`
	Address           string   `json:"address"`
	Latitude          *float64 `json:"latitude"`
	Longitude         *float64 `json:"longitude"`
	Status            string   `json:"status"`
	ProjectID         *string  `json:"project_id"`
	CommissioningDate *string  `json:"commissioning_date"`
}

func isFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// validateConstructionObjectInput проверяет тело запроса и возвращает
// подрезанные поля для записи. Ошибка — текст для 400.
func validateConstructionObjectInput(req constructionObjectReq) (repository.ConstructionObjectInput, error) {
	var out repository.ConstructionObjectInput

	out.Name = strings.TrimSpace(req.Name)
	if out.Name == "" {
		return out, errors.New("name is required")
	}
	out.Address = strings.TrimSpace(req.Address)
	if out.Address == "" {
		return out, errors.New("address is required")
	}
	out.Status = strings.TrimSpace(req.Status)
	if out.Status != "archive" && out.Status != "current" {
		return out, errors.New("status must be 'archive' or 'current'")
	}

	if req.Area != nil {
		if !isFinite(*req.Area) || *req.Area < 0 {
			return out, errors.New("area must be a non-negative number")
		}
		out.Area = req.Area
	}

	if (req.Latitude == nil) != (req.Longitude == nil) {
		return out, errors.New("latitude and longitude must be set together")
	}
	if req.Latitude != nil {
		if !isFinite(*req.Latitude) || *req.Latitude < -90 || *req.Latitude > 90 {
			return out, errors.New("latitude must be within [-90, 90]")
		}
		if !isFinite(*req.Longitude) || *req.Longitude < -180 || *req.Longitude > 180 {
			return out, errors.New("longitude must be within [-180, 180]")
		}
		out.Latitude, out.Longitude = req.Latitude, req.Longitude
	}

	if req.ProjectID != nil {
		pid := strings.TrimSpace(*req.ProjectID)
		if !constructionObjectUUIDRe.MatchString(pid) {
			return out, errors.New("project_id must be a valid UUID")
		}
		out.ProjectID = &pid
	}

	if req.CommissioningDate != nil {
		d := strings.TrimSpace(*req.CommissioningDate)
		if _, err := time.Parse("2006-01-02", d); err != nil {
			return out, errors.New("commissioning_date must be YYYY-MM-DD")
		}
		out.CommissioningDate = &d
	}
	return out, nil
}

func decodeConstructionObject(w http.ResponseWriter, r *http.Request) (repository.ConstructionObjectInput, bool) {
	var req constructionObjectReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return repository.ConstructionObjectInput{}, false
	}
	in, err := validateConstructionObjectInput(req)
	if err != nil {
		apierr.BadRequest(err.Error()).Render(w)
		return in, false
	}
	return in, true
}

// constructionObjectID достаёт и проверяет {id}; битый id отвечает 404 (такой строки быть не может).
func constructionObjectID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !constructionObjectUUIDRe.MatchString(id) {
		apierr.NotFound("construction object not found").Render(w)
		return "", false
	}
	return id, true
}

// renderConstructionObjectPgErr отвечает на ожидаемые ошибки БД; false — ошибка неизвестна.
func renderConstructionObjectPgErr(w http.ResponseWriter, err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		apierr.BadRequest("project_id: project not found").Render(w)
		return true
	}
	if p := apierr.ProblemFromPgErr(err, nil); p != nil {
		p.Render(w)
		return true
	}
	return false
}

// List handles GET /api/v1/construction-objects.
func (h *ConstructionObjectsHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.List(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to list construction objects")
		return
	}
	if rows == nil {
		rows = []repository.ConstructionObjectRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// Create handles POST /api/v1/construction-objects.
func (h *ConstructionObjectsHandler) Create(w http.ResponseWriter, r *http.Request) {
	in, ok := decodeConstructionObject(w, r)
	if !ok {
		return
	}
	var createdBy *string
	if u := middleware.UserFromContext(r.Context()); u != nil && u.ID != "" {
		createdBy = &u.ID
	}
	o, err := h.svc.Create(r.Context(), in, createdBy)
	if err != nil {
		if renderConstructionObjectPgErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to create construction object")
		return
	}
	renderJSON(w, r, http.StatusCreated, dataEnvelope{Data: o})
}

// Update handles PATCH /api/v1/construction-objects/{id}.
func (h *ConstructionObjectsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, ok := constructionObjectID(w, r)
	if !ok {
		return
	}
	in, ok := decodeConstructionObject(w, r)
	if !ok {
		return
	}
	o, err := h.svc.Update(r.Context(), id, in)
	if err != nil {
		if errors.Is(err, repository.ErrConstructionObjectNotFound) {
			apierr.NotFound("construction object not found").Render(w)
			return
		}
		if renderConstructionObjectPgErr(w, err) {
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to update construction object")
		return
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: o})
}

// Delete handles DELETE /api/v1/construction-objects/{id}.
func (h *ConstructionObjectsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, ok := constructionObjectID(w, r)
	if !ok {
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrConstructionObjectNotFound) {
			apierr.NotFound("construction object not found").Render(w)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to delete construction object")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
