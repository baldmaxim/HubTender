package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Чёрновой прогон тендера, карточка проверки и таблица решений аналога.

// ensureAnalogRun возвращает действующий чёрновой прогон тендера, создавая его
// при первом применении. Поиск и создание идут под advisory-локом тендера:
// две параллельные первые операции не создадут два прогона.
func ensureAnalogRun(ctx context.Context, tx pgx.Tx, tenderID, userID string) (string, error) {
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended('analog-run:' || $1::text, 0))`, tenderID); err != nil {
		return "", fmt.Errorf("analog.ensureRun: lock: %w", err)
	}
	id, err := findAnalogRun(ctx, tx, tenderID)
	if err != nil {
		return "", err
	}
	if id != nil {
		return *id, nil
	}
	var created string
	if err := tx.QueryRow(ctx, `
		INSERT INTO public.import_sessions (user_id, tender_id, file_name, source, label)
		VALUES ($1::uuid, $2::uuid, $3, $4, $5)
		RETURNING id::text`,
		userID, tenderID, AnalogRunFileName, AutopriceSource, AnalogRunLabel).Scan(&created); err != nil {
		return "", fmt.Errorf("analog.ensureRun: insert: %w", err)
	}
	return created, nil
}

// upsertAnalogReviewTx пишет событие аналога в карточку проверки позиции.
// Новая карточка — pending; returned → pending; остальные статусы не меняются;
// approved/excluded — запрет. basis, pd_refs, pd_note не трогаются: аналог не
// доказательство по ПД. createIfMissing=false (отмена) без карточки ничего не
// пишет. Возвращает итоговый статус ("" — карточки нет).
func upsertAnalogReviewTx(
	ctx context.Context, tx pgx.Tx, runID, tenderID, positionID, userID, action, comment string, createIfMissing bool,
) (string, error) {
	var status *string
	err := tx.QueryRow(ctx, `
		SELECT status FROM public.autoprice_position_reviews
		WHERE import_session_id = $1::uuid AND client_position_id = $2::uuid FOR UPDATE`,
		runID, positionID).Scan(&status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("analog.review: load: %w", err)
	}
	exists := err == nil
	if !exists && !createIfMissing {
		return "", nil
	}
	if exists && (*status == AutopriceStatusApproved || *status == AutopriceStatusExcluded) {
		return "", errAnalogLocked()
	}

	ev := autopriceEvent{
		At: time.Now().UTC(), UserID: userID, UserName: autopriceUserName(ctx, tx, userID),
		Action: action, Comment: comment,
	}
	to := AutopriceStatusPending
	if exists {
		ev.From = status
		to = *status
		if action == "analog_apply" && *status == AutopriceStatusReturned {
			to = AutopriceStatusPending
		}
	}
	ev.To = &to
	evJSON, err := eventArray(ev)
	if err != nil {
		return "", fmt.Errorf("analog.review: event: %w", err)
	}
	if exists {
		_, err = tx.Exec(ctx, `
			UPDATE public.autoprice_position_reviews
			SET status = $3, events = events || $4::jsonb, updated_at = now()
			WHERE import_session_id = $1::uuid AND client_position_id = $2::uuid`,
			runID, positionID, to, evJSON)
	} else {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.autoprice_position_reviews
			    (import_session_id, tender_id, client_position_id, status, events)
			VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb)`,
			runID, tenderID, positionID, to, evJSON)
	}
	if err != nil {
		return "", fmt.Errorf("analog.review: write: %w", err)
	}
	return to, nil
}

// analogInsert — всё, что записывается в analog_applications при применении.
type analogInsert struct {
	ID       string
	In       AnalogExecuteInput
	TenderID string
	RunID    string
	Src      *analogPositionInfo
	SrcIDs   []string
	NewIDs   []string
	Factor   float64
	Plan     analogScalePlan
	SrcFP    string
	TgtFP    string
	SrcRows  []AnalogRow
	Result   analogStoredResult
}

func insertAnalogApplication(ctx context.Context, tx pgx.Tx, a analogInsert) (*AnalogApplication, error) {
	request, err := analogRequestJSON(a.In.PositionID, a.In.Request)
	if err != nil {
		return nil, fmt.Errorf("analog.insert: request: %w", err)
	}
	snapshot, err := snapshotJSON(a.Src, a.SrcRows)
	if err != nil {
		return nil, fmt.Errorf("analog.insert: snapshot: %w", err)
	}
	result, err := json.Marshal(a.Result)
	if err != nil {
		return nil, fmt.Errorf("analog.insert: result: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO public.analog_applications
		    (id, idempotency_key, tender_id, client_position_id, import_session_id,
		     source_position_id, source_tender_id, source_item_ids, new_item_ids,
		     scale_mode, scale_factor, source_volume, target_volume, copy_prices,
		     source_fingerprint, target_fingerprint, source_snapshot, request, result, created_by)
		VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
		        $6::uuid, $7::uuid, $8::uuid[], $9::uuid[],
		        $10, $11, $12, $13, $14,
		        $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20::uuid)`,
		a.ID, a.In.IdempotencyKey, a.TenderID, a.In.PositionID, a.RunID,
		a.Src.Position.ID, a.Src.TenderID, a.SrcIDs, a.NewIDs,
		a.In.Request.ScaleMode, a.Factor, a.Plan.SourceVolume, a.Plan.TargetVolume, a.In.Request.CopyPrices,
		a.SrcFP, a.TgtFP, snapshot, request, result, a.In.UserID); err != nil {
		return nil, fmt.Errorf("analog.insert: %w", err)
	}
	return getAnalogApplication(ctx, tx, a.ID)
}

const analogApplicationSelect = `
SELECT a.id::text, a.status, a.tender_id::text, a.client_position_id::text, a.import_session_id::text,
       a.source_position_id::text, a.source_tender_id::text,
       a.source_snapshot #>> '{tender,tender_number}',
       NULLIF(a.source_snapshot #>> '{tender,version}', '')::int,
       COALESCE(a.source_snapshot #>> '{position,work_name}', ''),
       a.scale_mode, a.scale_factor::float8, a.source_volume::float8, a.target_volume::float8, a.copy_prices,
       cardinality(a.new_item_ids), a.created_by::text,
       COALESCE(NULLIF(btrim(cu.full_name), ''), cu.email), a.created_at,
       COALESCE(NULLIF(btrim(ru.full_name), ''), ru.email), a.reverted_at
FROM public.analog_applications a
LEFT JOIN public.users cu ON cu.id = a.created_by
LEFT JOIN public.users ru ON ru.id = a.reverted_by
`

func scanAnalogApplication(row pgx.Row) (*AnalogApplication, error) {
	a := &AnalogApplication{}
	if err := row.Scan(&a.ID, &a.Status, &a.TenderID, &a.ClientPositionID, &a.RunID,
		&a.SourcePositionID, &a.SourceTenderID, &a.SourceTenderNumber, &a.SourceTenderVersion,
		&a.SourceWorkName, &a.ScaleMode, &a.ScaleFactor, &a.SourceVolume, &a.TargetVolume, &a.CopyPrices,
		&a.ItemsCreated, &a.CreatedBy, &a.CreatedByName, &a.CreatedAt, &a.RevertedByName, &a.RevertedAt); err != nil {
		return nil, err
	}
	return a, nil
}

func getAnalogApplication(ctx context.Context, q analogQuerier, id string) (*AnalogApplication, error) {
	a, err := scanAnalogApplication(q.QueryRow(ctx, analogApplicationSelect+` WHERE a.id = $1::uuid`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, analogErr(AnalogCodeApplicationAbsent, "Решение не найдено.", nil)
		}
		return nil, fmt.Errorf("analog.getApplication: %w", err)
	}
	return a, nil
}

// ListApplications — последние 20 решений по позиции, новые сверху.
func (r *AnalogRepo) ListApplications(ctx context.Context, positionID string) ([]AnalogApplication, error) {
	rows, err := r.pool.Query(ctx, analogApplicationSelect+`
		WHERE a.client_position_id = $1::uuid
		ORDER BY a.created_at DESC, a.id
		LIMIT 20`, positionID)
	if err != nil {
		return nil, fmt.Errorf("analog.list: %w", err)
	}
	defer rows.Close()
	out := make([]AnalogApplication, 0, 4)
	for rows.Next() {
		a, err := scanAnalogApplication(rows)
		if err != nil {
			return nil, fmt.Errorf("analog.list scan: %w", err)
		}
		out = append(out, *a)
	}
	return out, rows.Err()
}
