package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// Резолверы тендера для гейта машинного доступа: маршруты PATCH /items/{id}
// и POST /positions/{id}/recompute-totals не несут id тендера в URL, а ключ
// может быть ограничен списком тендеров.

func (d *deps) tenderOfItem(r *http.Request) (string, error) {
	item, err := d.boqSvc.GetBoqItemByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return "", err
	}
	return item.TenderID, nil
}

func (d *deps) tenderOfPosition(r *http.Request) (string, error) {
	pos, err := d.positionSvc.GetPositionByID(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		return "", err
	}
	return pos.TenderID, nil
}
