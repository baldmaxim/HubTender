package handlers

import (
	"context"
	"net/http"
	"sort"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

type tenderRegistryExportServicer interface {
	List(ctx context.Context) ([]repository.TenderRegistryRow, error)
}

// TenderRegistryExportHandler — полный перечень тендеров для внешних систем
// (импортёр Meridian) по машинному ключу с областью registry:read.
type TenderRegistryExportHandler struct {
	svc tenderRegistryExportServicer
}

func NewTenderRegistryExportHandler(svc tenderRegistryExportServicer) *TenderRegistryExportHandler {
	return &TenderRegistryExportHandler{svc: svc}
}

// registryExportRow — строка перечня для внешних систем. Типы полей те же, что
// в repository.TenderRegistryRow; без omitempty — пустые значения идут как null.
type registryExportRow struct {
	ID                string                  `json:"id"`
	TenderNumber      *string                 `json:"tender_number"`
	Title             string                  `json:"title"`
	ClientName        string                  `json:"client_name"`
	ObjectAddress     *string                 `json:"object_address"`
	DashboardStatus   *string                 `json:"dashboard_status"`
	Status            *repository.NamedRefRow `json:"status"`
	IsArchived        bool                    `json:"is_archived"`
	ConstructionScope *repository.NamedRefRow `json:"construction_scope"`
	Area              *float64                `json:"area"`
	SubmissionDate    *string                 `json:"submission_date"`
	UpdatedAt         *string                 `json:"updated_at"`
}

// Export handles GET /api/v1/tender-registry/export — весь перечень без
// пагинации, включая архив и тендеры без расчёта. Порядок — как в списке
// портала (sort_order), равные — по id, чтобы выдача была детерминированной.
func (h *TenderRegistryExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	src, err := h.svc.List(r.Context())
	if err != nil {
		apierr.InternalFromErr(w, r, err, "failed to export tender registry")
		return
	}
	sorted := make([]repository.TenderRegistryRow, len(src))
	copy(sorted, src)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].SortOrder != sorted[j].SortOrder {
			return sorted[i].SortOrder < sorted[j].SortOrder
		}
		return sorted[i].ID < sorted[j].ID
	})

	rows := make([]registryExportRow, 0, len(sorted))
	for _, s := range sorted {
		rows = append(rows, registryExportRow{
			ID:                s.ID,
			TenderNumber:      s.TenderNumber,
			Title:             s.Title,
			ClientName:        s.ClientName,
			ObjectAddress:     s.ObjectAddress,
			DashboardStatus:   s.DashboardStatus,
			Status:            s.Status,
			IsArchived:        s.IsArchived,
			ConstructionScope: s.ConstructionScope,
			Area:              s.Area,
			SubmissionDate:    s.SubmissionDate,
			UpdatedAt:         s.UpdatedAt,
		})
	}
	middleware.SetCallItems(r.Context(), len(rows), false)
	renderRegistry(w, r, http.StatusOK, rows)
}
