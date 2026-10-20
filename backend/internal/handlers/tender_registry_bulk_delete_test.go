package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/su10/hubtender/backend/internal/repository"
)

// POST /api/v1/tender-registry/bulk-delete: удаление строк «Перечня тендеров».

type stubRegistrySvc struct {
	deleteIDs [][]string
	deleted   []repository.DeletedRegistryRow
	err       error
}

func (s *stubRegistrySvc) List(context.Context) ([]repository.TenderRegistryRow, error) {
	return nil, nil
}
func (s *stubRegistrySvc) NextSortOrder(context.Context) (int, error) { return 0, nil }
func (s *stubRegistrySvc) Autocomplete(context.Context) ([]repository.AutocompleteRow, error) {
	return nil, nil
}
func (s *stubRegistrySvc) Create(context.Context, repository.TenderRegistryCreateInput) error {
	return nil
}
func (s *stubRegistrySvc) Update(context.Context, string, repository.TenderRegistryUpdateInput) error {
	return nil
}
func (s *stubRegistrySvc) PatchFields(context.Context, string, repository.TenderRegistryPatch) error {
	return nil
}
func (s *stubRegistrySvc) DeleteMany(_ context.Context, ids []string) ([]repository.DeletedRegistryRow, error) {
	s.deleteIDs = append(s.deleteIDs, ids)
	return s.deleted, s.err
}
func (s *stubRegistrySvc) ListTenderStatuses(context.Context) ([]repository.NamedRefRow, error) {
	return nil, nil
}
func (s *stubRegistrySvc) ListConstructionScopes(context.Context) ([]repository.NamedRefRow, error) {
	return nil, nil
}
func (s *stubRegistrySvc) TenderNumbers(context.Context) ([]string, error) { return nil, nil }
func (s *stubRegistrySvc) RelatedTendersByNumbers(context.Context, []string) ([]repository.RelatedTenderRow, error) {
	return nil, nil
}

const (
	registryID1 = "11111111-1111-1111-1111-111111111111"
	registryID2 = "22222222-2222-2222-2222-222222222222"
)

func postBulkDelete(svc *stubRegistrySvc, body string) *httptest.ResponseRecorder {
	h := NewTenderRegistryHandler(svc)
	req := httptest.NewRequest("POST", "/api/v1/tender-registry/bulk-delete", strings.NewReader(body))
	w := httptest.NewRecorder()
	h.BulkDelete(w, req)
	return w
}

func TestTenderRegistryBulkDelete_RejectsBadInput(t *testing.T) {
	cases := map[string]string{
		"invalid JSON": `{"ids":`,
		"no ids":       `{}`,
		"empty ids":    `{"ids":[]}`,
		"not a uuid":   `{"ids":["` + registryID1 + `","42"]}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			svc := &stubRegistrySvc{}
			w := postBulkDelete(svc, body)
			if w.Code != 400 {
				t.Fatalf("status = %d, want 400 (body %s)", w.Code, w.Body.String())
			}
			if len(svc.deleteIDs) != 0 {
				t.Fatalf("service must not be called, got %v", svc.deleteIDs)
			}
		})
	}
}

func TestTenderRegistryBulkDelete_DeletesAndReturnsRows(t *testing.T) {
	svc := &stubRegistrySvc{deleted: []repository.DeletedRegistryRow{
		{ID: registryID1, Title: "ЖК Ода"},
		{ID: registryID2, Title: "ЖК Парк"},
	}}
	w := postBulkDelete(svc, `{"ids":["`+registryID1+`","`+registryID2+`"]}`)
	if w.Code != 200 {
		t.Fatalf("status = %d, want 200 (body %s)", w.Code, w.Body.String())
	}
	if want := [][]string{{registryID1, registryID2}}; !reflect.DeepEqual(svc.deleteIDs, want) {
		t.Fatalf("service ids = %v, want %v", svc.deleteIDs, want)
	}

	var resp struct {
		Data struct {
			Deleted []repository.DeletedRegistryRow `json:"deleted"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Data.Deleted) != 2 || resp.Data.Deleted[1].Title != "ЖК Парк" {
		t.Fatalf("deleted = %+v", resp.Data.Deleted)
	}
}

func TestTenderRegistryBulkDelete_ServiceError500(t *testing.T) {
	svc := &stubRegistrySvc{err: errors.New("db down")}
	w := postBulkDelete(svc, `{"ids":["`+registryID1+`"]}`)
	if w.Code != 500 {
		t.Fatalf("status = %d, want 500", w.Code)
	}
}
