package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/middleware"
	"github.com/su10/hubtender/backend/internal/repository"
	"github.com/su10/hubtender/backend/pkg/apierr"
)

// Запись manual_volume позиции по API-ключу (авторасценка): PATCH
// /api/v1/positions/{id}/fields с ключом принимает только manual_volume
// (и tender_id), и только в тендере с прогоном авторасценки, где позиция не
// подтверждена. Человек с JWT этих ограничений не имеет.

const maxKeyFieldsBody = 64 << 10

// manualVolumeGate — граница репозитория авторасценки для записи по ключу.
type manualVolumeGate interface {
	ManualVolumeGate(ctx context.Context, positionID string) (tenderID string, hasRun, approved bool, err error)
}

// WithManualVolumeGate подключает проверку записи manual_volume по ключу.
func (h *PositionWriteHandler) WithManualVolumeGate(g manualVolumeGate) *PositionWriteHandler {
	h.gate = g
	return h
}

// markKeyCallError помечает код отказа для журнала вызовов API.
func markKeyCallError(ctx context.Context, code string) {
	if s := middleware.CallStatFromContext(ctx); s != nil {
		s.ErrorCode = code
	}
}

// checkKeyManualVolume проверяет запись по ключу: тело (только manual_volume и
// tender_id), прогон авторасценки у тендера позиции, позиция не подтверждена.
// Возвращает тендер позиции; при отказе сам пишет ответ (ok=false). Тело
// запроса читает целиком и подставляет обратно.
func (h *PositionWriteHandler) checkKeyManualVolume(w http.ResponseWriter, r *http.Request, positionID string) (tenderID string, ok bool) {
	ctx := r.Context()
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxKeyFieldsBody))
	if err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return "", false
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		apierr.BadRequest("invalid JSON body").Render(w)
		return "", false
	}
	for k := range fields {
		if k != "manual_volume" && k != "tender_id" {
			markKeyCallError(ctx, "API_KEY_FIELD_DENIED")
			apierr.ArchiveProblem(http.StatusForbidden, "API_KEY_FIELD_DENIED",
				"По ключу можно менять только manual_volume позиции.",
				map[string]any{"field": k}).Render(w)
			return "", false
		}
	}
	if v, has := fields["manual_volume"]; !has || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
		apierr.BadRequest("manual_volume: обязательное поле").Render(w)
		return "", false
	}

	if h.gate == nil {
		apierr.InternalFromErr(w, r, errors.New("manual volume gate is not configured"), "failed to check autoprice run")
		return "", false
	}
	tenderID, hasRun, approved, err := h.gate.ManualVolumeGate(ctx, positionID)
	switch {
	case errors.Is(err, repository.ErrAutopricePositionNotFound), errors.Is(err, pgx.ErrNoRows):
		apierr.NotFound("position not found").Render(w)
		return "", false
	case err != nil:
		apierr.InternalFromErr(w, r, err, "failed to check autoprice run")
		return "", false
	case !hasRun:
		markKeyCallError(ctx, "AUTOPRICE_RUN_REQUIRED")
		apierr.ArchiveProblem(http.StatusForbidden, "AUTOPRICE_RUN_REQUIRED",
			"У тендера позиции нет прогона авторасценки: объём по ключу менять нельзя.",
			map[string]any{"tenderId": tenderID}).Render(w)
		return "", false
	case approved:
		autopriceRepoError(w, r, repository.ErrAutopriceApproved, "")
		return "", false
	}
	return tenderID, true
}
