package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// Статусы проверки позиции авторасценки.
const (
	AutopriceStatusPending       = "pending"
	AutopriceStatusInProgress    = "in_progress"
	AutopriceStatusNeedsCustomer = "needs_customer"
	AutopriceStatusReturned      = "returned"
	AutopriceStatusApproved      = "approved"
	AutopriceStatusExcluded      = "excluded"
)

// autopriceOpenStatuses — статусы, из которых возможны рабочие действия.
var autopriceOpenStatuses = map[string]bool{
	AutopriceStatusPending: true, AutopriceStatusInProgress: true,
	AutopriceStatusNeedsCustomer: true, AutopriceStatusReturned: true,
}

type autopriceTransition struct {
	to   string
	from map[string]bool
}

// autopriceTransitions — действия кнопок инженера. reopen снимает финальные
// статусы approved/excluded.
var autopriceTransitions = map[string]autopriceTransition{
	"start": {AutopriceStatusInProgress, map[string]bool{
		AutopriceStatusPending: true, AutopriceStatusReturned: true, AutopriceStatusNeedsCustomer: true}},
	"approve":        {AutopriceStatusApproved, autopriceOpenStatuses},
	"return":         {AutopriceStatusReturned, autopriceOpenStatuses},
	"needs_customer": {AutopriceStatusNeedsCustomer, autopriceOpenStatuses},
	"exclude":        {AutopriceStatusExcluded, autopriceOpenStatuses},
	"reopen": {AutopriceStatusInProgress, map[string]bool{
		AutopriceStatusApproved: true, AutopriceStatusExcluded: true}},
}

// IsAutopriceAction — известно ли действие.
func IsAutopriceAction(action string) bool {
	_, ok := autopriceTransitions[action]
	return ok
}

// AutopriceReviewInput — тело PUT .../review (загрузка машиной).
type AutopriceReviewInput struct {
	Basis     *string
	PdRefs    json.RawMessage
	PdNote    *string
	Questions json.RawMessage
	Findings  json.RawMessage
	// VolumeSourceSet — ключ volume_source был в теле: false — значение в БД
	// не меняется; true — записать VolumeSource (нормализованный JSON), nil = NULL.
	VolumeSourceSet bool
	VolumeSource    []byte
}

// AutopriceReviewPatch — правка инженером; nil-поле не меняется.
type AutopriceReviewPatch struct {
	EngineerComment *string
	Questions       json.RawMessage
	Findings        json.RawMessage
}

type autopriceEvent struct {
	At       time.Time `json:"at"`
	UserID   string    `json:"user_id"`
	UserName string    `json:"user_name"`
	Action   string    `json:"action"`
	From     *string   `json:"from"`
	To       *string   `json:"to"`
	Comment  string    `json:"comment,omitempty"`
}

// eventArray — журнал из одного события для `events || $n::jsonb`.
func eventArray(ev autopriceEvent) (string, error) {
	b, err := json.Marshal([]autopriceEvent{ev})
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func nonNilJSON(raw json.RawMessage, def string) string {
	if len(raw) == 0 {
		return def
	}
	return string(raw)
}

func optJSON(raw json.RawMessage) *string {
	if len(raw) == 0 {
		return nil
	}
	s := string(raw)
	return &s
}

// lockRun — сессия прогона для записи: должна существовать, быть autoprice и
// не отменённой. forUpdate берёт блокировку строки сессии (пакетная запись:
// отмена прогона дождётся коммита и увидит вставленные строки).
func lockRun(ctx context.Context, tx pgx.Tx, sessionID string, forUpdate bool) (tenderID string, err error) {
	var (
		tid       *string
		cancelled bool
	)
	q := `
		SELECT tender_id::text, cancelled_at IS NOT NULL
		FROM public.import_sessions WHERE id = $1 AND source = $2`
	if forUpdate {
		q += ` FOR UPDATE`
	}
	err = tx.QueryRow(ctx, q, sessionID, AutopriceSource).Scan(&tid, &cancelled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrAutopriceRunNotFound
		}
		return "", fmt.Errorf("autoprice: load run: %w", err)
	}
	if tid == nil {
		return "", ErrAutopriceRunNotFound
	}
	if cancelled {
		return "", ErrAutopriceRunCancelled
	}
	return *tid, nil
}

// lockedRun — сессия прогона для записи (lockRun) плюс проверка, что позиция
// принадлежит тендеру прогона.
func lockedRun(ctx context.Context, tx pgx.Tx, sessionID, positionID string) (tenderID string, err error) {
	tid, err := lockRun(ctx, tx, sessionID, false)
	if err != nil {
		return "", err
	}
	var ok bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM public.client_positions WHERE id = $1 AND tender_id = $2)`,
		positionID, tid).Scan(&ok); err != nil {
		return "", fmt.Errorf("autoprice: check position: %w", err)
	}
	if !ok {
		return "", ErrAutopricePositionNotFound
	}
	return tid, nil
}

// autopriceUserName — имя для журнала: ФИО, а если оно пустое — e-mail,
// чтобы у каждого события было видно, кто нажал кнопку.
func autopriceUserName(ctx context.Context, tx pgx.Tx, userID string) string {
	var name *string
	if err := tx.QueryRow(ctx, `SELECT COALESCE(NULLIF(trim(full_name), ''), email) FROM public.users WHERE id = $1`, userID).Scan(&name); err != nil || name == nil {
		return ""
	}
	return *name
}

// UpsertReview — загрузка/обновление карточки машиной. Новая карточка
// pending; существующая approved — ErrAutopriceApproved; returned после
// повторной загрузки возвращается в pending, остальные статусы сохраняются.
func (r *AutopriceReviewRepo) UpsertReview(ctx context.Context, sessionID, positionID, actorID string, in AutopriceReviewInput) (*AutopriceReview, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("autoprice.UpsertReview: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	tenderID, err := lockedRun(ctx, tx, sessionID, positionID)
	if err != nil {
		return nil, err
	}

	review, err := upsertReviewTx(ctx, tx, sessionID, tenderID, positionID, actorID, in)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("autoprice.UpsertReview: commit: %w", err)
	}
	return review, nil
}

// upsertReviewTx — запись карточки позиции в открытой транзакции после лока
// прогона (lockedRun): общая часть UpsertReview и пакетной записи
// (autoprice_bulk.go). Коммит и откат — на вызывающем.
func upsertReviewTx(ctx context.Context, tx pgx.Tx, sessionID, tenderID, positionID, actorID string, in AutopriceReviewInput) (*AutopriceReview, error) {
	var status *string
	err := tx.QueryRow(ctx, `
		SELECT status FROM public.autoprice_position_reviews
		WHERE import_session_id = $1 AND client_position_id = $2 FOR UPDATE`,
		sessionID, positionID).Scan(&status)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("autoprice.upsertReviewTx: load: %w", err)
	}
	exists := err == nil
	if exists && *status == AutopriceStatusApproved {
		return nil, ErrAutopriceApproved
	}

	ev := autopriceEvent{At: time.Now().UTC(), UserID: actorID, UserName: autopriceUserName(ctx, tx, actorID), Action: "load"}
	to := AutopriceStatusPending
	if exists {
		ev.From = status
		to = *status
		if *status == AutopriceStatusReturned {
			to = AutopriceStatusPending
		}
	}
	ev.To = &to
	evJSON, err := eventArray(ev)
	if err != nil {
		return nil, fmt.Errorf("autoprice.upsertReviewTx: event: %w", err)
	}

	var volumeSource *string
	if in.VolumeSourceSet && in.VolumeSource != nil {
		s := string(in.VolumeSource)
		volumeSource = &s
	}
	if exists {
		_, err = tx.Exec(ctx, `
			UPDATE public.autoprice_position_reviews
			SET basis = $3, pd_refs = $4::jsonb, pd_note = $5, questions = $6::jsonb, findings = $7::jsonb,
			    status = $8, events = events || $9::jsonb,
			    volume_source = CASE WHEN $10::boolean THEN $11::jsonb ELSE volume_source END,
			    updated_at = now()
			WHERE import_session_id = $1 AND client_position_id = $2`,
			sessionID, positionID, in.Basis, nonNilJSON(in.PdRefs, "[]"), in.PdNote,
			nonNilJSON(in.Questions, "[]"), nonNilJSON(in.Findings, "[]"), to, evJSON,
			in.VolumeSourceSet, volumeSource)
	} else {
		_, err = tx.Exec(ctx, `
			INSERT INTO public.autoprice_position_reviews
			    (import_session_id, tender_id, client_position_id, basis, pd_refs, pd_note,
			     questions, findings, status, events, volume_source)
			VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9, $10::jsonb, $11::jsonb)`,
			sessionID, tenderID, positionID, in.Basis, nonNilJSON(in.PdRefs, "[]"), in.PdNote,
			nonNilJSON(in.Questions, "[]"), nonNilJSON(in.Findings, "[]"), to, evJSON, volumeSource)
	}
	if err != nil {
		return nil, fmt.Errorf("autoprice.upsertReviewTx: write: %w", err)
	}
	return getAutopriceReview(ctx, tx, sessionID, positionID)
}

// lockReview блокирует карточку и возвращает её статус; запись в отменённый
// прогон запрещена.
func lockReview(ctx context.Context, tx pgx.Tx, sessionID, positionID string) (string, error) {
	var (
		status    string
		cancelled bool
	)
	err := tx.QueryRow(ctx, `
		SELECT r.status, s.cancelled_at IS NOT NULL
		FROM public.autoprice_position_reviews r
		JOIN public.import_sessions s ON s.id = r.import_session_id
		WHERE r.import_session_id = $1 AND r.client_position_id = $2
		FOR UPDATE OF r`, sessionID, positionID).Scan(&status, &cancelled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrAutopriceReviewNotFound
		}
		return "", fmt.Errorf("autoprice: lock review: %w", err)
	}
	if cancelled {
		return "", ErrAutopriceRunCancelled
	}
	return status, nil
}

// PatchReview — правка комментария инженера, вопросов и находок; для
// подтверждённой позиции — ErrAutopriceApproved (сначала reopen).
func (r *AutopriceReviewRepo) PatchReview(ctx context.Context, sessionID, positionID, actorID string, p AutopriceReviewPatch) (*AutopriceReview, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("autoprice.PatchReview: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	status, err := lockReview(ctx, tx, sessionID, positionID)
	if err != nil {
		return nil, err
	}
	if status == AutopriceStatusApproved {
		return nil, ErrAutopriceApproved
	}
	evJSON, err := eventArray(autopriceEvent{
		At: time.Now().UTC(), UserID: actorID, UserName: autopriceUserName(ctx, tx, actorID),
		Action: "edit", From: &status, To: &status,
	})
	if err != nil {
		return nil, fmt.Errorf("autoprice.PatchReview: event: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.autoprice_position_reviews
		SET engineer_comment = COALESCE($3, engineer_comment),
		    questions = COALESCE($4::jsonb, questions),
		    findings = COALESCE($5::jsonb, findings),
		    events = events || $6::jsonb, updated_at = now()
		WHERE import_session_id = $1 AND client_position_id = $2`,
		sessionID, positionID, p.EngineerComment, optJSON(p.Questions), optJSON(p.Findings), evJSON); err != nil {
		return nil, fmt.Errorf("autoprice.PatchReview: update: %w", err)
	}
	review, err := getAutopriceReview(ctx, tx, sessionID, positionID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("autoprice.PatchReview: commit: %w", err)
	}
	return review, nil
}

// ApplyAction — смена статуса. approve требует ненулевых цен во ВСЕХ строках
// позиции (иначе *AutopriceZeroPriceError) и ставит approved_by/approved_at;
// reopen чистит их. Роли и обязательный комментарий проверяет хендлер.
func (r *AutopriceReviewRepo) ApplyAction(ctx context.Context, sessionID, positionID, actorID, action, comment string) (*AutopriceReview, error) {
	tr, ok := autopriceTransitions[action]
	if !ok {
		return nil, &AutopriceTransitionError{Action: action}
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("autoprice.ApplyAction: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	status, err := lockReview(ctx, tx, sessionID, positionID)
	if err != nil {
		return nil, err
	}
	if !tr.from[status] {
		return nil, &AutopriceTransitionError{Action: action, From: status}
	}

	if action == "approve" {
		var zero int
		if err := tx.QueryRow(ctx, `
			SELECT count(*)::int FROM public.boq_items
			WHERE client_position_id = $1 AND COALESCE(unit_rate, 0) = 0`, positionID).Scan(&zero); err != nil {
			return nil, fmt.Errorf("autoprice.ApplyAction: zero price: %w", err)
		}
		if zero > 0 {
			return nil, &AutopriceZeroPriceError{Count: zero}
		}
	}

	evJSON, err := eventArray(autopriceEvent{
		At: time.Now().UTC(), UserID: actorID, UserName: autopriceUserName(ctx, tx, actorID),
		Action: action, From: &status, To: &tr.to, Comment: comment,
	})
	if err != nil {
		return nil, fmt.Errorf("autoprice.ApplyAction: event: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.autoprice_position_reviews
		SET status = $3,
		    approved_by = CASE WHEN $3 = 'approved' THEN $4::uuid
		                       WHEN $5 = 'reopen' THEN NULL ELSE approved_by END,
		    approved_at = CASE WHEN $3 = 'approved' THEN now()
		                       WHEN $5 = 'reopen' THEN NULL ELSE approved_at END,
		    events = events || $6::jsonb, updated_at = now()
		WHERE import_session_id = $1 AND client_position_id = $2`,
		sessionID, positionID, tr.to, actorID, action, evJSON); err != nil {
		return nil, fmt.Errorf("autoprice.ApplyAction: update: %w", err)
	}
	review, err := getAutopriceReview(ctx, tx, sessionID, positionID)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("autoprice.ApplyAction: commit: %w", err)
	}
	return review, nil
}
