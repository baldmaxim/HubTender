package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Предпросмотр и применение аналога идут ОДНИМ путём (execute): предпросмотр —
// та же транзакция с ROLLBACK, поэтому CHECK-констрейнты, курсы целевого тендера
// и пересчёт итогов отрабатывают как при записи.

// AnalogExecuteInput — вход предпросмотра и применения.
type AnalogExecuteInput struct {
	PositionID string
	UserID     string
	Request    AnalogRequest
	// Только для применения.
	PreviewToken   string
	IdempotencyKey string
}

// analogStoredItem — соответствие созданной строки строке источника.
type analogStoredItem struct {
	Index        int    `json:"index"`
	NewItemID    string `json:"new_item_id"`
	SourceItemID string `json:"source_item_id"`
}

// analogStoredResult — analog_applications.result.
type analogStoredResult struct {
	ItemsCreated int                 `json:"items_created"`
	Items        []analogStoredItem  `json:"items"`
	Totals       AnalogPreviewTotals `json:"totals"`
	Warnings     []AnalogWarning     `json:"warnings"`
}

// analogSnapshot — analog_applications.source_snapshot.
type analogSnapshot struct {
	Position AnalogSourcePosition `json:"position"`
	Tender   AnalogSourceTender   `json:"tender"`
	Items    []AnalogRow          `json:"items"`
}

// analogOutcome — результат execute: предпросмотр или итог применения.
type analogOutcome struct {
	preview *AnalogPreview
	apply   *AnalogApplyResult
}

// Preview строит предпросмотр: ничего не сохраняет.
func (r *AnalogRepo) Preview(ctx context.Context, in AnalogExecuteInput) (*AnalogPreview, error) {
	out, err := r.execute(ctx, in, true)
	if err != nil {
		return nil, err
	}
	return out.preview, nil
}

// Apply применяет аналог: заменяет строки прежнего решения по позиции строками
// из источника и записывает решение. Повтор с тем же ключом и телом возвращает
// сохранённый результат (Replayed).
func (r *AnalogRepo) Apply(ctx context.Context, in AnalogExecuteInput) (*AnalogApplyResult, error) {
	out, err := r.execute(ctx, in, false)
	if err != nil {
		return nil, err
	}
	return out.apply, nil
}

func (r *AnalogRepo) execute(ctx context.Context, in AnalogExecuteInput, dryRun bool) (*analogOutcome, error) {
	out, err := r.executeOnce(ctx, in, dryRun)
	if err != nil && !dryRun && isIdempotencyKeyViolation(err) {
		// Тот же ключ записан параллельным запросом по другой позиции: повтор
		// увидит ключ при проверке и отдаст replay либо конфликт.
		return r.executeOnce(ctx, in, dryRun)
	}
	return out, err
}

func isIdempotencyKeyViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505" && pg.ConstraintName == "analog_applications_idempotency_key_key"
}

// lockAnalogPosition — сериализует операции аналога по одной позиции.
func lockAnalogPosition(ctx context.Context, tx pgx.Tx, positionID string) error {
	if _, err := tx.Exec(ctx,
		`SELECT pg_advisory_xact_lock(hashtextextended('analog-pos:' || $1::text, 0))`, positionID); err != nil {
		return fmt.Errorf("analog.lockPosition: %w", err)
	}
	return nil
}

// blockedReasonOf — почему к цели нельзя применить аналог ("" — можно).
func blockedReasonOf(state string) string {
	if state == AnalogStateLocked || state == AnalogStateForeign {
		return state
	}
	return ""
}

func (r *AnalogRepo) executeOnce(ctx context.Context, in AnalogExecuteInput, dryRun bool) (*analogOutcome, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("analog.execute: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if err := lockAnalogPosition(ctx, tx, in.PositionID); err != nil {
		return nil, err
	}
	target, err := loadAnalogTarget(ctx, tx, in.PositionID, !dryRun)
	if err != nil {
		return nil, err
	}
	if target == nil {
		return nil, errAnalogTargetNotFound()
	}
	if !dryRun {
		replay, err := findAnalogReplay(ctx, tx, in)
		if err != nil || replay != nil {
			return &analogOutcome{apply: replay}, err
		}
	}

	src, err := loadAnalogPosition(ctx, tx, in.Request.SourcePositionID, false)
	if err != nil {
		return nil, err
	}
	if src == nil {
		return nil, errAnalogSourceNotFound()
	}
	if src.TenderID == target.TenderID {
		return nil, analogErr(AnalogCodeSourceSameTender,
			"Аналог должен быть из другого тендера: позиции этого же тендера не подходят.", nil)
	}
	srcRows, err := loadAnalogRowsByPosition(ctx, tx, src.Position.ID, nil)
	if err != nil {
		return nil, err
	}
	if len(srcRows) == 0 {
		return nil, analogErr(AnalogCodeSourceEmpty, "У позиции-аналога нет строк расценки.", nil)
	}

	blocked := blockedReasonOf(target.State)
	if !dryRun && blocked != "" {
		return nil, analogBlockedError(target)
	}
	plan, err := planAnalogScale(in.Request, src.Position.UnitCode, target.UnitCode, src.Position.Volume, target.Volume)
	if err != nil {
		return nil, err
	}

	srcFP, err := analogSourceFingerprint(ctx, tx, src.Position.ID)
	if err != nil {
		return nil, err
	}
	tgtFP, err := analogTargetFingerprint(ctx, tx, in.PositionID)
	if err != nil {
		return nil, err
	}
	if !dryRun {
		if side, stale := staleSide(in.PreviewToken, srcFP, tgtFP); stale {
			return nil, analogErr(AnalogCodeStale,
				"Данные изменились с момента предпросмотра. Откройте предпросмотр заново.",
				map[string]any{"changed": side})
		}
	}

	preview := &AnalogPreview{
		Target: *target,
		Source: AnalogPreviewSource{
			AnalogSourceTender: src.Tender, PositionID: src.Position.ID,
			WorkName: src.Position.WorkName, UnitCode: src.Position.UnitCode, Volume: src.Position.Volume,
		},
		Scale:        AnalogPreviewScale{Mode: in.Request.ScaleMode, Factor: 1, SourceVolume: src.Position.Volume, TargetVolume: target.Volume, UnitsMatch: plan.UnitsMatch},
		Items:        []AnalogRow{},
		Warnings:     []AnalogWarning{},
		PreviewToken: analogToken(srcFP, tgtFP),
		CanApply:     blocked == "",
	}
	if blocked != "" {
		preview.BlockedReason = &blocked
		return &analogOutcome{preview: preview}, nil
	}

	runID, err := ensureAnalogRun(ctx, tx, target.TenderID, in.UserID)
	if err != nil {
		return nil, err
	}
	if _, err := lockRun(ctx, tx, runID, true); err != nil {
		return nil, err
	}
	if err := setAuditUser(ctx, tx, in.UserID); err != nil {
		return nil, err
	}
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("analog.execute: %w", err)
	}

	// Прежнее решение по позиции заменяется: удаляются только строки чернового
	// прогона (с аудитом DELETE и проверкой чужих дочерних строк).
	deleted, err := deleteRunItemsTx(ctx, tx, runID, in.UserID, in.PositionID, nil)
	if err != nil {
		return nil, mapAnalogDeleteError(err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE public.analog_applications SET status = $2
		WHERE client_position_id = $1::uuid AND status = $3`,
		in.PositionID, AnalogStatusSuperseded, AnalogStatusApplied); err != nil {
		return nil, fmt.Errorf("analog.execute: supersede: %w", err)
	}

	var appID string
	if err := tx.QueryRow(ctx, `SELECT gen_random_uuid()::text`).Scan(&appID); err != nil {
		return nil, fmt.Errorf("analog.execute: id: %w", err)
	}
	srcIDs := make([]string, len(srcRows))
	for i, row := range srcRows {
		srcIDs[i] = *row.ID
	}
	copyPrices := in.Request.CopyPrices
	res, err := composeTx(ctx, tx, ComposeInput{
		TargetTenderID: target.TenderID,
		ChangedBy:      in.UserID,
		Verbose:        true,
		Options: ComposeOptions{
			OnMissingSource: OnMissingSourceFail, CopyQuoteDates: true,
			CopyDetailCostCategory: true, CopyPrices: &copyPrices,
		},
		Groups: []ComposeGroup{{
			TempID:           "analog",
			TargetPositionID: &in.PositionID,
			Sources: []ComposeSource{{
				SourcePositionID: src.Position.ID, SourceItemIDs: srcIDs, Scale: plan.Spec,
			}},
		}},
		ImportSessionID: &runID,
		AuditOrigin:     "analog_apply",
		AuditExtra:      map[string]any{"analog_application_id": appID},
	})
	if err != nil {
		return nil, mapAnalogComposeError(err)
	}
	if len(res.Groups) != 1 || len(res.Groups[0].Sources) != 1 {
		return nil, fmt.Errorf("analog.execute: неожиданный результат compose")
	}
	g := res.Groups[0]
	factor := g.Sources[0].ScaleFactor
	newIDs := make([]string, len(g.Items))
	stored := make([]analogStoredItem, len(g.Items))
	for i, it := range g.Items {
		newIDs[i] = it.NewItemID
		stored[i] = analogStoredItem{Index: i, NewItemID: it.NewItemID, SourceItemID: it.SourceItemID}
	}

	warnings := analogWarnings(res.Warnings, plan.UnitsMatch, src.Position.UnitCode, target.UnitCode)
	totals := AnalogPreviewTotals{
		WorksCount: res.Totals.WorksCount, MaterialsCount: res.Totals.MaterialsCount,
		ParentLinksRestored: res.Totals.ParentLinksRestored,
	}
	if g.TotalMaterial != nil {
		totals.TotalMaterial = *g.TotalMaterial
	}
	if g.TotalWorks != nil {
		totals.TotalWorks = *g.TotalWorks
	}
	preview.Scale.Factor = factor
	preview.Totals = totals
	preview.Warnings = warnings

	if _, err := tx.Exec(ctx, `
		UPDATE public.import_sessions SET items_count = GREATEST(items_count - $2, 0) + $3
		WHERE id = $1::uuid`, runID, deleted, len(newIDs)); err != nil {
		return nil, fmt.Errorf("analog.execute: items_count: %w", err)
	}

	comment := analogEventComment(src, in.Request, factor, plan)
	if _, err := upsertAnalogReviewTx(ctx, tx, runID, target.TenderID, in.PositionID, in.UserID, "analog_apply", comment, true); err != nil {
		return nil, err
	}

	if dryRun {
		rows, err := loadAnalogRowsByIDs(ctx, tx, newIDs, nil)
		if err != nil {
			return nil, err
		}
		for i := range rows {
			rows[i].ID = nil
			if i < len(g.Items) {
				s := g.Items[i].SourceItemID
				rows[i].SourceItemID = &s
			}
		}
		preview.Items = rows
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			return nil, fmt.Errorf("analog.execute: rollback: %w", err)
		}
		return &analogOutcome{preview: preview}, nil
	}

	app, err := insertAnalogApplication(ctx, tx, analogInsert{
		ID: appID, In: in, TenderID: target.TenderID, RunID: runID, Src: src, SrcIDs: srcIDs, NewIDs: newIDs,
		Factor: factor, Plan: plan, SrcFP: srcFP, TgtFP: tgtFP, SrcRows: srcRows,
		Result: analogStoredResult{ItemsCreated: len(newIDs), Items: stored, Totals: totals, Warnings: warnings},
	})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("analog.execute: commit: %w", err)
	}
	return &analogOutcome{apply: &AnalogApplyResult{Application: *app, RunID: runID, TenderID: target.TenderID}}, nil
}

// findAnalogReplay: ключ уже использован — то же тело отдаёт сохранённое решение,
// другое — конфликт. Нет ключа — (nil, nil).
func findAnalogReplay(ctx context.Context, tx pgx.Tx, in AnalogExecuteInput) (*AnalogApplyResult, error) {
	var id, tenderID string
	var request []byte
	err := tx.QueryRow(ctx, `
		SELECT id::text, tender_id::text, request FROM public.analog_applications
		WHERE idempotency_key = $1::uuid`, in.IdempotencyKey).Scan(&id, &tenderID, &request)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("analog.replay: %w", err)
	}
	if !analogRequestMatches(request, in.PositionID, in.Request) {
		return nil, analogErr(AnalogCodeIdempotencyClash,
			"Этот ключ повтора уже использован с другими параметрами. Откройте предпросмотр заново.", nil)
	}
	app, err := getAnalogApplication(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	return &AnalogApplyResult{Application: *app, RunID: app.RunID, Replayed: true, TenderID: tenderID}, nil
}

func analogBlockedError(t *AnalogTarget) *AnalogError {
	if t.State == AnalogStateLocked {
		return errAnalogLocked()
	}
	return analogErr(AnalogCodeTargetHasRows,
		"В позиции уже есть строки, добавленные вручную или другим способом: аналог можно применить только к пустой позиции.",
		map[string]any{"foreign_rows_count": t.ForeignRowsCount})
}

func errAnalogLocked() *AnalogError {
	return analogErr(AnalogCodeTargetLocked,
		"Позиция подтверждена или исключена из расценки: сначала снимите подтверждение («Переоткрыть»).", nil)
}

func errAnalogForeignChildren() *AnalogError {
	return analogErr(AnalogCodeForeignChildren,
		"У заменяемых строк есть дочерние строки, добавленные вручную: удаление их стёрло бы. Удалите их вручную и повторите.", nil)
}

func mapAnalogDeleteError(err error) error {
	if errors.Is(err, ErrAutopriceForeignChildren) {
		return errAnalogForeignChildren()
	}
	return err
}

// mapAnalogComposeError переводит ошибки сборки в коды пилота; остальные (курс
// валюты, родитель строки, БД) проходят как есть.
func mapAnalogComposeError(err error) error {
	var nf *ArchiveSourceNotFoundError
	var nothing *ArchiveNothingToComposeError
	var under *ArchiveQuantityUnderflowError
	switch {
	case errors.As(err, &nf) && nf.ItemID != "":
		return analogErr(AnalogCodeStale, "Данные изменились с момента предпросмотра. Откройте предпросмотр заново.",
			map[string]any{"changed": "source"})
	case errors.As(err, &nf):
		return errAnalogSourceNotFound()
	case errors.As(err, &nothing):
		return analogErr(AnalogCodeSourceEmpty, "У позиции-аналога нет строк расценки.", nil)
	case errors.As(err, &under):
		return analogErr(AnalogCodeScaleInvalid,
			"При таком коэффициенте количество строки стало нулевым. Задайте другой коэффициент.", nil)
	}
	return err
}

// analogWarnings — предупреждения предпросмотра.
func analogWarnings(cw []ComposeWarning, unitsOK bool, srcUnit, tgtUnit *string) []AnalogWarning {
	out := make([]AnalogWarning, 0, len(cw)+1)
	if !unitsOK {
		out = append(out, AnalogWarning{
			Code: AnalogWarnUnitsDiffer,
			Message: fmt.Sprintf("Единицы измерения позиции («%s») и аналога («%s») различаются: проверьте количества.",
				derefOrEmpty(tgtUnit), derefOrEmpty(srcUnit)),
		})
	}
	for _, w := range cw {
		msg := w.Code
		if w.Code == WarnLinkedQuantityRederived {
			msg = "Количество материала, привязанного к работе, пересчитано от количества работы."
		}
		out = append(out, AnalogWarning{
			Code: w.Code, Message: msg, SourceItemID: w.SourceItemID, Stored: w.Stored, Rederived: w.Rederived,
		})
	}
	return out
}

// analogEventComment — запись в журнал проверки: откуда аналог, масштаб, цены.
func analogEventComment(src *analogPositionInfo, req AnalogRequest, factor float64, plan analogScalePlan) string {
	prices := "не перенесены"
	if req.CopyPrices {
		prices = "перенесены"
	}
	ver := 1
	if src.Tender.Version != nil {
		ver = *src.Tender.Version
	}
	return fmt.Sprintf("Аналог: №%s v%d, поз. %s «%s»; масштаб %s; цены %s",
		derefOrEmpty(src.Tender.TenderNumber), ver, derefOrEmpty(src.Position.ItemNo), src.Position.WorkName,
		scaleDescription(req.ScaleMode, factor, plan.SourceVolume, plan.TargetVolume), prices)
}

// snapshotJSON — снимок источника для analog_applications.source_snapshot.
func snapshotJSON(src *analogPositionInfo, rows []AnalogRow) ([]byte, error) {
	return json.Marshal(analogSnapshot{Position: src.Position, Tender: src.Tender, Items: rows})
}
