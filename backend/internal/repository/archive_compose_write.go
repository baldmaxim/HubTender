package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// nextPositionNumberTx — следующий свободный номер позиции в тендере.
// position_number — numeric (в проде встречаются дробные вроде 4.10), поэтому
// шагаем от floor(max)+1.
func nextPositionNumberTx(ctx context.Context, tx pgx.Tx, tenderID string) (float64, error) {
	var next float64
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(FLOOR(MAX(position_number)), 0) + 1
		FROM public.client_positions WHERE tender_id = $1
	`, tenderID).Scan(&next)
	if err != nil {
		return 0, fmt.Errorf("nextPositionNumberTx: %w", err)
	}
	return next, nil
}

// insertArchivePositionTx создаёт целевую позицию заказчика.
// created_by не пишем: колонки нет в схеме client_positions (так же поступает
// перенос версий, insertNewPositions).
func insertArchivePositionTx(
	ctx context.Context, tx pgx.Tx, tenderID string, np NewTargetPosition, number float64,
) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO public.client_positions (
			tender_id, position_number, item_no, section_number, position_name,
			work_name, unit_code, volume, manual_volume,
			client_note, manual_note, hierarchy_level, is_additional, parent_position_id
		) VALUES (
			$1::uuid, $2::numeric, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''),
			$6, $7, $8::numeric, $9::numeric,
			NULLIF($10, ''), NULLIF($11, ''), $12::int, $13::boolean, $14::uuid
		)
		RETURNING id::text
	`,
		tenderID, number,
		derefOrEmpty(np.ItemNo), derefOrEmpty(np.SectionNumber), derefOrEmpty(np.PositionName),
		np.WorkName, np.UnitCode, np.Volume, np.ManualVolume,
		derefOrEmpty(np.ClientNote), derefOrEmpty(np.ManualNote),
		np.HierarchyLevel, np.IsAdditional, np.ParentPositionID,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("insertArchivePositionTx: %w", err)
	}
	return id, nil
}

// maxSortNumberTx — текущий максимум sort_number в целевой позиции.
func maxSortNumberTx(ctx context.Context, tx pgx.Tx, positionID string) (int, error) {
	var maxSort int
	err := tx.QueryRow(ctx, `
		SELECT COALESCE(MAX(sort_number), 0)
		FROM public.boq_items WHERE client_position_id = $1
	`, positionID).Scan(&maxSort)
	if err != nil {
		return 0, fmt.Errorf("maxSortNumberTx: %w", err)
	}
	return maxSort, nil
}

const archiveInsertItemsSQL = `
INSERT INTO public.boq_items (
    tender_id, client_position_id, sort_number,
    boq_item_type, material_type, material_name_id, work_name_id,
    unit_code, quantity, base_quantity,
    consumption_coefficient, conversion_coefficient,
    parent_work_item_id, delivery_price_type, delivery_amount,
    currency_type, unit_rate,
    detail_cost_category_id, quote_link, description,
    quote_price_date, quote_valid_until
)
SELECT $1::uuid, $2::uuid, $3::int + inp.idx::int,
       inp.item_type::boq_item_type,
       NULLIF(inp.material_type, '')::material_type,
       NULLIF(inp.material_name_id, '')::uuid,
       NULLIF(inp.work_name_id, '')::uuid,
       NULLIF(inp.unit_code, ''),
       inp.quantity, inp.base_quantity,
       inp.consumption, inp.conversion,
       NULL,
       NULLIF(inp.delivery_type, '')::delivery_price_type,
       inp.delivery_amount,
       NULLIF(inp.currency, '')::currency_type,
       inp.unit_rate,
       NULLIF(inp.detail_cat, '')::uuid,
       NULLIF(inp.quote_link, ''),
       NULLIF(inp.description, ''),
       NULLIF(inp.quote_price_date, '')::date,
       NULLIF(inp.quote_valid_until, '')::date
FROM UNNEST(
    $4::text[], $5::text[], $6::text[], $7::text[], $8::text[],
    $9::numeric[], $10::numeric[], $11::numeric[], $12::numeric[],
    $13::text[], $14::numeric[], $15::text[], $16::numeric[],
    $17::text[], $18::text[], $19::text[], $20::text[], $21::text[]
) WITH ORDINALITY AS inp(
    item_type, material_type, material_name_id, work_name_id, unit_code,
    quantity, base_quantity, consumption, conversion,
    delivery_type, delivery_amount, currency, unit_rate,
    detail_cat, quote_link, description, quote_price_date, quote_valid_until,
    idx
)
ORDER BY inp.idx
RETURNING id::text, sort_number
`

// insertArchiveItemsTx вставляет строки одной целевой позиции ОДНИМ statement'ом.
//
// parent_work_item_id всегда NULL: связи восстанавливаются отдельным bulk-UPDATE
// на ЦЕЛЕВЫЕ uuid. Производных денежных колонок (total_amount, commercial_*) нет
// в списке колонок вообще — они считаются позже, в этой же транзакции.
// Возвращает новые id в порядке items.
func insertArchiveItemsTx(
	ctx context.Context, tx pgx.Tx, tenderID, positionID string,
	startSort int, items []plannedItem, opt ComposeOptions,
) ([]string, error) {
	n := len(items)
	if n == 0 {
		return nil, nil
	}

	itemTypes := make([]string, n)
	materialTypes := make([]string, n)
	materialNameIDs := make([]string, n)
	workNameIDs := make([]string, n)
	unitCodes := make([]string, n)
	quantities := make([]*float64, n)
	baseQuantities := make([]*float64, n)
	consumption := make([]*float64, n)
	conversion := make([]*float64, n)
	deliveryTypes := make([]string, n)
	deliveryAmounts := make([]*float64, n)
	currencies := make([]string, n)
	unitRates := make([]*float64, n)
	detailCats := make([]string, n)
	quoteLinks := make([]string, n)
	descriptions := make([]string, n)
	quotePriceDates := make([]string, n)
	quoteValidUntils := make([]string, n)

	for i, it := range items {
		s := it.src
		itemTypes[i] = s.BoqItemType
		materialTypes[i] = derefOrEmpty(s.MaterialType)
		materialNameIDs[i] = derefOrEmpty(s.MaterialNameID)
		workNameIDs[i] = derefOrEmpty(s.WorkNameID)
		unitCodes[i] = derefOrEmpty(s.UnitCode)
		quantities[i] = it.Quantity
		baseQuantities[i] = it.BaseQuantity
		consumption[i] = s.ConsumptionCoefficient
		conversion[i] = s.ConversionCoefficient
		deliveryTypes[i] = derefOrEmpty(s.DeliveryPriceType)
		deliveryAmounts[i] = s.DeliveryAmount
		currencies[i] = derefOrEmpty(s.CurrencyType)
		unitRates[i] = s.UnitRate
		if opt.CopyDetailCostCategory {
			detailCats[i] = derefOrEmpty(s.DetailCostCategoryID)
		}
		quoteLinks[i] = derefOrEmpty(s.QuoteLink)
		descriptions[i] = derefOrEmpty(s.Description)
		if opt.CopyQuoteDates {
			// CHECK quote_valid_until >= quote_price_date: копируем обе или ни одной.
			quotePriceDates[i] = derefOrEmpty(s.QuotePriceDate)
			quoteValidUntils[i] = derefOrEmpty(s.QuoteValidUntil)
		}
	}

	rows, err := tx.Query(ctx, archiveInsertItemsSQL,
		tenderID, positionID, startSort,
		itemTypes, materialTypes, materialNameIDs, workNameIDs, unitCodes,
		quantities, baseQuantities, consumption, conversion,
		deliveryTypes, deliveryAmounts, currencies, unitRates,
		detailCats, quoteLinks, descriptions, quotePriceDates, quoteValidUntils,
	)
	if err != nil {
		return nil, fmt.Errorf("insertArchiveItemsTx: insert: %w", err)
	}

	newIDs := make([]string, n)
	var scanErr error
	func() {
		defer rows.Close()
		for rows.Next() {
			var id string
			var sortNumber int
			if scanErr = rows.Scan(&id, &sortNumber); scanErr != nil {
				return
			}
			// sort_number = startSort + порядковый номер (1-based) — прямой
			// обратный маппинг на индекс во входном срезе.
			pos := sortNumber - startSort - 1
			if pos < 0 || pos >= n {
				scanErr = fmt.Errorf("insertArchiveItemsTx: sort_number %d вне диапазона", sortNumber)
				return
			}
			newIDs[pos] = id
		}
		scanErr = rows.Err()
	}()
	if scanErr != nil {
		return nil, fmt.Errorf("insertArchiveItemsTx: %w", scanErr)
	}
	for i, id := range newIDs {
		if id == "" {
			return nil, fmt.Errorf("insertArchiveItemsTx: строка %d не вернула id", i)
		}
	}
	return newIDs, nil
}

// remapArchiveParentsTx восстанавливает parent_work_item_id одним UPDATE,
// подставляя ТОЛЬКО целевые uuid. parentIdx — индексы в пределах той же группы.
func remapArchiveParentsTx(
	ctx context.Context, tx pgx.Tx, newIDs []string, parentIdx []int,
) (int, error) {
	childIDs := make([]string, 0, len(newIDs))
	parentIDs := make([]string, 0, len(newIDs))
	for i, p := range parentIdx {
		if p < 0 {
			continue
		}
		if p >= len(newIDs) {
			return 0, fmt.Errorf("remapArchiveParentsTx: индекс родителя %d вне диапазона", p)
		}
		childIDs = append(childIDs, newIDs[i])
		parentIDs = append(parentIDs, newIDs[p])
	}
	if len(childIDs) == 0 {
		return 0, nil
	}
	tag, err := tx.Exec(ctx, `
		UPDATE public.boq_items b
		SET parent_work_item_id = u.new_parent
		FROM UNNEST($1::uuid[], $2::uuid[]) AS u(child_id, new_parent)
		WHERE b.id = u.child_id
	`, childIDs, parentIDs)
	if err != nil {
		return 0, fmt.Errorf("remapArchiveParentsTx: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

// archiveAuditPayload — минимальный след происхождения строки.
type archiveAuditPayload struct {
	ID               string `json:"id"`
	ClientPositionID string `json:"client_position_id"`
	TenderID         string `json:"tender_id"`
	BoqItemType      string `json:"boq_item_type"`
	SourceItemID     string `json:"source_item_id"`
	SourceTenderID   string `json:"source_tender_id"`
	Origin           string `json:"origin"`
}

// auditArchiveItemsTx пишет по одной INSERT-записи аудита на строку.
func auditArchiveItemsTx(
	ctx context.Context, tx pgx.Tx, tenderID, positionID, changedBy string,
	newIDs []string, items []plannedItem,
) error {
	for i, id := range newIDs {
		payload, err := json.Marshal(archiveAuditPayload{
			ID:               id,
			ClientPositionID: positionID,
			TenderID:         tenderID,
			BoqItemType:      items[i].src.BoqItemType,
			SourceItemID:     items[i].SourceItemID,
			SourceTenderID:   items[i].SourceTender,
			Origin:           "archive_compose",
		})
		if err != nil {
			return fmt.Errorf("auditArchiveItemsTx: marshal: %w", err)
		}
		if err := insertAudit(ctx, tx, id, "INSERT", changedBy, nil, nil, payload); err != nil {
			return fmt.Errorf("auditArchiveItemsTx: %w", err)
		}
	}
	return nil
}

// lockTargetPositionTx проверяет, что позиция существует и принадлежит тендеру.
func lockTargetPositionTx(ctx context.Context, tx pgx.Tx, positionID, tenderID string) error {
	var actual string
	err := tx.QueryRow(ctx, `
		SELECT tender_id::text FROM public.client_positions WHERE id = $1 FOR UPDATE
	`, positionID).Scan(&actual)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &ArchiveTargetNotFoundError{PositionID: positionID}
		}
		return fmt.Errorf("lockTargetPositionTx: %w", err)
	}
	if actual != tenderID {
		return &ArchiveTargetScopeError{
			PositionID: positionID, ExpectedTenderID: tenderID, ActualTenderID: actual,
		}
	}
	return nil
}

func derefOrEmpty(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
