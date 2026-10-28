package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/internal/services"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type nomenclatureEnsureServicer interface {
	Ensure(ctx context.Context, items []repository.EnsureNameItem) ([]repository.EnsureNameResult, error)
}

// NomenclatureEnsureHandler — POST /api/v1/nomenclature/ensure: найти или
// создать наименования работ/материалов (машинный ключ, область
// nomenclature:write). Ошибка валидации — 400 NOMENCLATURE_INVALID_REQUEST с
// индексом элемента (itemIndex), ничего не записывается.
type NomenclatureEnsureHandler struct {
	svc nomenclatureEnsureServicer
}

func NewNomenclatureEnsureHandler(svc nomenclatureEnsureServicer) *NomenclatureEnsureHandler {
	return &NomenclatureEnsureHandler{svc: svc}
}

// Тело: до 500 элементов по ≤1024 символов имени — с запасом на JSON-экранирование.
const nomenclatureEnsureBodyLimit = 4 << 20

type nomenclatureEnsureReq struct {
	Items []repository.EnsureNameItem `json:"items"`
}

func (h *NomenclatureEnsureHandler) problem(w http.ResponseWriter, r *http.Request, detail string, index int) {
	if s := middleware.CallStatFromContext(r.Context()); s != nil {
		s.ErrorCode = "NOMENCLATURE_INVALID_REQUEST"
	}
	extras := map[string]any{}
	if index >= 0 {
		extras["itemIndex"] = index
	}
	apierr.ArchiveProblem(http.StatusBadRequest, "NOMENCLATURE_INVALID_REQUEST", detail, extras).Render(w)
}

// Ensure handles POST /api/v1/nomenclature/ensure.
func (h *NomenclatureEnsureHandler) Ensure(w http.ResponseWriter, r *http.Request) {
	var req nomenclatureEnsureReq
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, nomenclatureEnsureBodyLimit))
	if err := dec.Decode(&req); err != nil {
		h.problem(w, r, "Тело запроса — JSON-объект {\"items\":[…]} до 4 МБ.", -1)
		return
	}
	res, err := h.svc.Ensure(r.Context(), req.Items)
	if err != nil {
		var in *services.EnsureInputError
		if errors.As(err, &in) {
			h.problem(w, r, in.Reason, in.Index)
			return
		}
		apierr.InternalFromErr(w, r, err, "failed to ensure nomenclature names")
		return
	}
	renderRegistry(w, r, http.StatusOK, res) // {data} с Cache-Control: no-store
}
