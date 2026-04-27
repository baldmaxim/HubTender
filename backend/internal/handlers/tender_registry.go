package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// tenderRegistryServicer is the interface TenderRegistryHandler depends on.
type tenderRegistryServicer interface {
	List(ctx context.Context) ([]repository.TenderRegistryRow, error)
	NextSortOrder(ctx context.Context) (int, error)
	Autocomplete(ctx context.Context) ([]repository.AutocompleteRow, error)
	Create(ctx context.Context, in repository.TenderRegistryCreateInput) error
	Update(ctx context.Context, id string, in repository.TenderRegistryUpdateInput) error
	ListTenderStatuses(ctx context.Context) ([]repository.NamedRefRow, error)
	ListConstructionScopes(ctx context.Context) ([]repository.NamedRefRow, error)
	TenderNumbers(ctx context.Context) ([]string, error)
	RelatedTendersByNumbers(ctx context.Context, numbers []string) ([]repository.RelatedTenderRow, error)
}

// TenderRegistryHandler serves tender_registry / statuses / scopes endpoints.
type TenderRegistryHandler struct {
	svc tenderRegistryServicer
}

// NewTenderRegistryHandler creates a TenderRegistryHandler.
func NewTenderRegistryHandler(svc tenderRegistryServicer) *TenderRegistryHandler {
	return &TenderRegistryHandler{svc: svc}
}

// List handles GET /api/v1/tender-registry.
func (h *TenderRegistryHandler) List(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.List(r.Context())
	if err != nil {
		apierr.InternalError("failed to list tender registry").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.TenderRegistryRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// NextSortOrder handles GET /api/v1/tender-registry/next-sort-order.
func (h *TenderRegistryHandler) NextSortOrder(w http.ResponseWriter, r *http.Request) {
	n, err := h.svc.NextSortOrder(r.Context())
	if err != nil {
		apierr.InternalError("failed to compute next sort order").Render(w)
		return
	}
	renderJSON(w, r, http.StatusOK, map[string]int{"next_sort_order": n})
}

// Autocomplete handles GET /api/v1/tender-registry/autocomplete.
func (h *TenderRegistryHandler) Autocomplete(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.Autocomplete(r.Context())
	if err != nil {
		apierr.InternalError("failed to load autocomplete").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.AutocompleteRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// Create handles POST /api/v1/tender-registry.
func (h *TenderRegistryHandler) Create(w http.ResponseWriter, r *http.Request) {
	var in repository.TenderRegistryCreateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if strings.TrimSpace(in.Title) == "" || strings.TrimSpace(in.ClientName) == "" {
		apierr.BadRequest("title and client_name are required").Render(w)
		return
	}
	if err := h.svc.Create(r.Context(), in); err != nil {
		apierr.InternalError("failed to create tender registry row").Render(w)
		return
	}
	w.WriteHeader(http.StatusCreated)
}

// Update handles PATCH /api/v1/tender-registry/{id}.
func (h *TenderRegistryHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		apierr.BadRequest("missing id").Render(w)
		return
	}
	var in repository.TenderRegistryUpdateInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return
	}
	if err := h.svc.Update(r.Context(), id, in); err != nil {
		apierr.InternalError("failed to update tender registry row").Render(w)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListTenderStatuses handles GET /api/v1/tender-statuses.
func (h *TenderRegistryHandler) ListTenderStatuses(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListTenderStatuses(r.Context())
	if err != nil {
		apierr.InternalError("failed to list tender statuses").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.NamedRefRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// ListConstructionScopes handles GET /api/v1/construction-scopes.
func (h *TenderRegistryHandler) ListConstructionScopes(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.ListConstructionScopes(r.Context())
	if err != nil {
		apierr.InternalError("failed to list construction scopes").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.NamedRefRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// TenderNumbers handles GET /api/v1/tender-registry/tender-numbers.
func (h *TenderRegistryHandler) TenderNumbers(w http.ResponseWriter, r *http.Request) {
	rows, err := h.svc.TenderNumbers(r.Context())
	if err != nil {
		apierr.InternalError("failed to list tender numbers").Render(w)
		return
	}
	if rows == nil {
		rows = []string{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}

// RelatedTenders handles GET /api/v1/tender-registry/related-tenders?numbers=a,b,c.
func (h *TenderRegistryHandler) RelatedTenders(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("numbers")
	var numbers []string
	if raw != "" {
		for _, n := range strings.Split(raw, ",") {
			n = strings.TrimSpace(n)
			if n != "" {
				numbers = append(numbers, n)
			}
		}
	}
	rows, err := h.svc.RelatedTendersByNumbers(r.Context(), numbers)
	if err != nil {
		apierr.InternalError("failed to list related tenders").Render(w)
		return
	}
	if rows == nil {
		rows = []repository.RelatedTenderRow{}
	}
	renderJSON(w, r, http.StatusOK, dataEnvelope{Data: rows})
}
