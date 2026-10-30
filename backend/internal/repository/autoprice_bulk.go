package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// Пакетная запись строк BOQ прогона авторасценки: одна транзакция на весь
// запрос (все позиции целиком или ничего). Заменяет россыпь вызовов
// POST .../items + PUT .../review: 11 тыс. запросов на тендер.

// ErrAutopriceForeignChildren — заменяемая работа прогона имеет дочерние строки,
// не принадлежащие этому прогону (ручные или из другого прогона): каскадное
// удаление стёрло бы их без следа, поэтому замена отклоняется.
var ErrAutopriceForeignChildren = errors.New("autoprice: replaced work has rows of another origin")

// AutopriceBulkError привязывает ошибку к позиции/строке запроса, чтобы хендлер
// мог указать, что именно не так. Ref и Field могут быть пустыми.
type AutopriceBulkError struct {
	PositionID string
	Ref        string
	Field      string
	Err        error
}

func (e *AutopriceBulkError) Error() string {
	return fmt.Sprintf("autoprice bulk: position %s ref %q: %v", e.PositionID, e.Ref, e.Err)
}

func (e *AutopriceBulkError) Unwrap() error { return e.Err }

// AutopriceBulkItem — строка запроса. Item несёт поля строки; позицию, тендер,
// сессию, автора и parent_work_item_id репозиторий проставляет сам.
type AutopriceBulkItem struct {
	Ref       string
	ParentRef string // пусто — строка без родителя
	Item      CreateBoqItemInput
}

// AutopriceBulkPosition — позиция запроса.
type AutopriceBulkPosition struct {
	PositionID string
	// Replace — перед вставкой удалить строки этой позиции, записанные
	// ЭТИМ прогоном (чужие прогоны и ручные строки не трогаются).
	Replace bool
	Items   []AutopriceBulkItem
	Review  *AutopriceReviewInput // nil — карточку не менять
}

// AutopriceBulkItemResult — записанная строка (порядок — как в запросе).
type AutopriceBulkItemResult struct {
	Ref              string    `json:"ref"`
	ID               string    `json:"id"`
	ParentWorkItemID *string   `json:"parent_work_item_id"`
	Quantity         *float64  `json:"quantity"`
	UnitRate         *float64  `json:"unit_rate"`
	TotalAmount      *float64  `json:"total_amount"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// AutopriceBulkPositionResult — итог по позиции запроса.
type AutopriceBulkPositionResult struct {
	PositionID string                    `json:"position_id"`
	Items      []AutopriceBulkItemResult `json:"items"`
	Review     *AutopriceReview          `json:"review"`
}

// AutopriceBulkResult — итог запроса; TenderID нужен сервису для инвалидации
// кэшей и пересчёта коммерции, в JSON не отдаётся.
type AutopriceBulkResult struct {
	TenderID  string
	Positions []AutopriceBulkPositionResult
}

// BulkWrite записывает строки и карточки позиций прогона одной транзакцией.
// Любая ошибка откатывает всё; ошибки позиции/строки — *AutopriceBulkError.
func (r *AutopriceReviewRepo) BulkWrite(ctx context.Context, sessionID, actorID string, positions []AutopriceBulkPosition) (*AutopriceBulkResult, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	// Строка сессии берётся FOR UPDATE: отмена прогона дождётся коммита, а
	// параллельные пакеты одного прогона идут по очереди (иначе взаимная
	// блокировка на items_count).
	tenderID, err := lockRun(ctx, tx, sessionID, true)
	if err != nil {
		return nil, err
	}
	if err := setAuditUser(ctx, tx, actorID); err != nil {
		return nil, err
	}
	if err := skipBoqAuditTrigger(ctx, tx); err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: %w", err)
	}
	rates, err := loadTenderRates(ctx, tx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: %w", err)
	}

	posIDs := make([]string, len(positions))
	for i, p := range positions {
		posIDs[i] = p.PositionID
	}
	if err := checkBulkPositions(ctx, tx, sessionID, tenderID, posIDs); err != nil {
		return nil, err
	}

	// 0-F2 (category A): одна ревизия на команду; коммерция пересчитывается
	// асинхронно (сервис ставит пересчёт после коммита).
	if _, err := MarkTenderFinancialInputsChangedTx(ctx, tx, tenderID, "autoprice_bulk"); err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: %w", err)
	}

	res := &AutopriceBulkResult{TenderID: tenderID, Positions: make([]AutopriceBulkPositionResult, 0, len(positions))}
	deleted, inserted := 0, 0
	for _, p := range positions {
		pr := AutopriceBulkPositionResult{PositionID: p.PositionID, Items: []AutopriceBulkItemResult{}}
		if p.Replace {
			n, err := bulkReplaceDelete(ctx, tx, sessionID, actorID, p.PositionID)
			if err != nil {
				return nil, err
			}
			deleted += n
		}
		items, err := bulkInsertItems(ctx, tx, sessionID, tenderID, actorID, rates, p)
		if err != nil {
			return nil, err
		}
		pr.Items = items
		inserted += len(items)
		if p.Review != nil {
			review, err := upsertReviewTx(ctx, tx, sessionID, tenderID, p.PositionID, actorID, *p.Review)
			if err != nil {
				return nil, &AutopriceBulkError{PositionID: p.PositionID, Err: err}
			}
			pr.Review = review
		}
		res.Positions = append(res.Positions, pr)
	}

	// Счётчик строк прогона — один UPDATE на запрос (как +1/−n у одиночных путей).
	if _, err := tx.Exec(ctx, `
		UPDATE public.import_sessions SET items_count = GREATEST(items_count - $2, 0) + $3
		WHERE id = $1`, sessionID, deleted, inserted); err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: items_count: %w", err)
	}
	if err := recomputePositionTotalsByIDsTx(ctx, tx, posIDs); err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: %w", err)
	}
	if deleted > 0 {
		// Удалённые строки могли нести материализованную коммерцию — как у
		// DeleteBoqItem и CancelSession, общий итог тендера обновляется здесь же.
		if _, err := RecalculateTenderGrandTotalTx(ctx, tx, tenderID); err != nil {
			return nil, fmt.Errorf("autoprice.BulkWrite: grand total: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("autoprice.BulkWrite: commit: %w", err)
	}
	return res, nil
}

// checkBulkPositions: все позиции принадлежат тендеру прогона и ни одна не
// подтверждена (запись в подтверждённую позицию запрещена, пока её не
// переоткрыли). Карточки блокируются FOR UPDATE до конца транзакции. Ошибки
// выдаются по порядку позиций запроса.
func checkBulkPositions(ctx context.Context, tx pgx.Tx, sessionID, tenderID string, posIDs []string) error {
	found := make(map[string]bool, len(posIDs))
	rows, err := tx.Query(ctx, `
		SELECT id::text FROM public.client_positions WHERE id = ANY($1::uuid[]) AND tender_id = $2::uuid`,
		posIDs, tenderID)
	if err != nil {
		return fmt.Errorf("autoprice.BulkWrite: positions: %w", err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return fmt.Errorf("autoprice.BulkWrite: positions: %w", err)
		}
		found[id] = true
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("autoprice.BulkWrite: positions: %w", err)
	}
	for _, id := range posIDs {
		if !found[id] {
			return &AutopriceBulkError{PositionID: id, Err: ErrAutopricePositionNotFound}
		}
	}

	approved := make(map[string]bool)
	rows, err = tx.Query(ctx, `
		SELECT client_position_id::text, status FROM public.autoprice_position_reviews
		WHERE import_session_id = $1 AND client_position_id = ANY($2::uuid[]) FOR UPDATE`,
		sessionID, posIDs)
	if err != nil {
		return fmt.Errorf("autoprice.BulkWrite: reviews: %w", err)
	}
	for rows.Next() {
		var id, status string
		if err := rows.Scan(&id, &status); err != nil {
			rows.Close()
			return fmt.Errorf("autoprice.BulkWrite: reviews: %w", err)
		}
		approved[id] = status == AutopriceStatusApproved
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("autoprice.BulkWrite: reviews: %w", err)
	}
	for _, id := range posIDs {
		if approved[id] {
			return &AutopriceBulkError{PositionID: id, Err: ErrAutopriceApproved}
		}
	}
	return nil
}

// bulkReplaceDelete удаляет строки позиции, записанные этим прогоном, с тем же
// аудитом DELETE, что у одиночного удаления. Возвращает число удалённых строк.
func bulkReplaceDelete(ctx context.Context, tx pgx.Tx, sessionID, actorID, positionID string) (int, error) {
	return deleteRunItemsTx(ctx, tx, sessionID, actorID, positionID, nil)
}

// deleteRunItemsTx удаляет строки позиции, принадлежащие прогону sessionID, с
// аудитом DELETE. itemIDs == nil — все строки прогона в позиции; иначе только
// перечисленные (отмена одного решения аналога). Если у удаляемых работ есть
// дочерние строки вне удаляемого набора (ручные или чужого прогона), удаление
// отклоняется (ErrAutopriceForeignChildren): каскад стёр бы их без следа.
func deleteRunItemsTx(ctx context.Context, tx pgx.Tx, sessionID, actorID, positionID string, itemIDs []string) (int, error) {
	// Дочерние строки заменяемых работ из чужого источника каскадом исчезли бы
	// без аудита — отказываем до удаления.
	var foreign bool
	if err := tx.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM public.boq_items c
			JOIN public.boq_items w ON w.id = c.parent_work_item_id
			WHERE w.client_position_id = $1::uuid AND w.import_session_id = $2::uuid
			  AND ($3::uuid[] IS NULL OR w.id = ANY($3::uuid[]))
			  AND CASE WHEN $3::uuid[] IS NULL THEN c.import_session_id IS DISTINCT FROM $2::uuid
			           ELSE NOT (c.id = ANY($3::uuid[])) END)`,
		positionID, sessionID, itemIDs).Scan(&foreign); err != nil {
		return 0, fmt.Errorf("autoprice.BulkWrite: foreign children: %w", err)
	}
	if foreign {
		return 0, &AutopriceBulkError{PositionID: positionID, Err: ErrAutopriceForeignChildren}
	}

	rows, err := tx.Query(ctx, `
		DELETE FROM public.boq_items
		WHERE client_position_id = $1::uuid AND import_session_id = $2::uuid
		  AND ($3::uuid[] IS NULL OR id = ANY($3::uuid[]))
		RETURNING `+boqScanCols, positionID, sessionID, itemIDs)
	if err != nil {
		return 0, &AutopriceBulkError{PositionID: positionID, Err: fmt.Errorf("replace: delete: %w", err)}
	}
	var old []*BoqItemRow
	for rows.Next() {
		item, err := scanBoqItemRow(rows)
		if err != nil {
			rows.Close()
			return 0, fmt.Errorf("autoprice.BulkWrite: scan deleted: %w", err)
		}
		old = append(old, item)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, &AutopriceBulkError{PositionID: positionID, Err: fmt.Errorf("replace: delete: %w", err)}
	}
	for _, item := range old {
		oldJSON, _ := boqRowJSON(item)
		if err := insertAudit(ctx, tx, item.ID, "DELETE", actorID, nil, oldJSON, nil); err != nil {
			return 0, fmt.Errorf("autoprice.BulkWrite: audit delete: %w", err)
		}
	}
	return len(old), nil
}

// bulkInsertItems вставляет строки позиции: сначала без parent_ref, затем с
// ним (parent_work_item_id — id вставленной работы с этим ref). Результат — в
// порядке запроса.
func bulkInsertItems(ctx context.Context, tx pgx.Tx, sessionID, tenderID, actorID string, rates calc.CurrencyRates, p AutopriceBulkPosition) ([]AutopriceBulkItemResult, error) {
	out := make([]AutopriceBulkItemResult, len(p.Items))
	type parentInfo struct {
		id       string
		itemType string
	}
	parents := make(map[string]parentInfo, len(p.Items))

	insert := func(idx int) error {
		bi := p.Items[idx]
		in := bi.Item
		in.ClientPositionID = p.PositionID
		in.TenderID = tenderID
		in.CreatedBy = actorID
		in.ImportSessionID = &sessionID
		in.ParentWorkItemID = nil
		if bi.ParentRef != "" {
			par, ok := parents[bi.ParentRef]
			if !ok {
				return &AutopriceBulkError{PositionID: p.PositionID, Ref: bi.Ref, Field: "parent_ref",
					Err: errors.New("parent_ref не найден среди строк без parent_ref этой позиции")}
			}
			if !calc.IsWorkBoqType(par.itemType) {
				return &AutopriceBulkError{PositionID: p.PositionID, Ref: bi.Ref, Field: "parent_ref",
					Err: errors.New("parent_ref указывает не на работу")}
			}
			id := par.id
			in.ParentWorkItemID = &id
		}
		// Порядок строк в позиции — как в запросе, если sort_number не задан
		// (иначе при равных sort_number выдача упорядочена случайным id).
		if in.SortNumber == nil {
			n := idx
			in.SortNumber = &n
		}
		item, err := insertBoqItemTx(ctx, tx, in, rates)
		if err != nil {
			return &AutopriceBulkError{PositionID: p.PositionID, Ref: bi.Ref, Err: err}
		}
		out[idx] = AutopriceBulkItemResult{
			Ref: bi.Ref, ID: item.ID, ParentWorkItemID: item.ParentWorkItemID,
			Quantity: item.Quantity, UnitRate: item.UnitRate, TotalAmount: item.TotalAmount,
			UpdatedAt: item.UpdatedAt,
		}
		if bi.ParentRef == "" {
			parents[bi.Ref] = parentInfo{id: item.ID, itemType: item.BoqItemType}
		}
		return nil
	}

	for idx, bi := range p.Items {
		if bi.ParentRef == "" {
			if err := insert(idx); err != nil {
				return nil, err
			}
		}
	}
	for idx, bi := range p.Items {
		if bi.ParentRef != "" {
			if err := insert(idx); err != nil {
				return nil, err
			}
		}
	}
	return out, nil
}
