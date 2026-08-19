package repository

import (
	"context"
	"errors"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/su10/hubtender/backend/internal/calc"
)

// archiveSrcRow — class-A входы исторической строки. Производные денежные
// колонки (total_amount, commercial_*) не читаются намеренно: их нельзя
// скопировать как авторитетные, они считаются заново по ЦЕЛЕВОМУ тендеру.
type archiveSrcRow struct {
	ID                     string
	TenderID               string
	BoqItemType            string
	MaterialType           *string
	MaterialNameID         *string
	WorkNameID             *string
	UnitCode               *string
	Quantity               *float64
	BaseQuantity           *float64
	ConsumptionCoefficient *float64
	ConversionCoefficient  *float64
	ParentWorkItemID       *string
	DeliveryPriceType      *string
	DeliveryAmount         *float64
	CurrencyType           *string
	UnitRate               *float64
	DetailCostCategoryID   *string
	QuoteLink              *string
	Description            *string
	QuotePriceDate         *string
	QuoteValidUntil        *string
}

// plannedItem — строка, готовая к вставке в целевую позицию.
type plannedItem struct {
	src          archiveSrcRow
	SourceItemID string
	SourceTender string
	// ParentIdx — индекс родителя в пределах СВОЕЙ группы (-1 = самостоятельная).
	ParentIdx    int
	Quantity     *float64
	BaseQuantity *float64
}

// plannedGroup — целевая позиция и её будущие строки.
type plannedGroup struct {
	TempID           string
	Create           bool
	NewPosition      *NewTargetPosition
	TargetPositionID string
	Items            []plannedItem
	// NewIDs — id вставленных строк в порядке Items (заполняется на фазе записи).
	NewIDs  []string
	Sources []ComposeSourceStat
}

const archiveSourceItemsSQL = `
SELECT bi.id::text, bi.tender_id::text, bi.boq_item_type::text, bi.material_type::text,
       bi.material_name_id::text, bi.work_name_id::text, bi.unit_code,
       bi.quantity, bi.base_quantity,
       bi.consumption_coefficient, bi.conversion_coefficient,
       bi.parent_work_item_id::text, bi.delivery_price_type::text, bi.delivery_amount,
       bi.currency_type::text, bi.unit_rate,
       bi.detail_cost_category_id::text, bi.quote_link, bi.description,
       to_char(bi.quote_price_date, 'YYYY-MM-DD'),
       to_char(bi.quote_valid_until, 'YYYY-MM-DD')
FROM public.boq_items bi
WHERE bi.client_position_id = $1
  AND (cardinality($2::uuid[]) = 0 OR bi.id = ANY ($2::uuid[]))
ORDER BY bi.sort_number ASC, bi.id ASC
`

// loadArchiveSourceItemsTx читает строки позиции-источника (или их подмножество).
func loadArchiveSourceItemsTx(
	ctx context.Context, tx pgx.Tx, positionID string, itemIDs []string,
) ([]archiveSrcRow, error) {
	ids := itemIDs
	if ids == nil {
		ids = []string{}
	}
	rows, err := tx.Query(ctx, archiveSourceItemsSQL, positionID, ids)
	if err != nil {
		return nil, fmt.Errorf("loadArchiveSourceItemsTx: query: %w", err)
	}
	defer rows.Close()

	out := make([]archiveSrcRow, 0, 32)
	for rows.Next() {
		var s archiveSrcRow
		if err := rows.Scan(
			&s.ID, &s.TenderID, &s.BoqItemType, &s.MaterialType,
			&s.MaterialNameID, &s.WorkNameID, &s.UnitCode,
			&s.Quantity, &s.BaseQuantity,
			&s.ConsumptionCoefficient, &s.ConversionCoefficient,
			&s.ParentWorkItemID, &s.DeliveryPriceType, &s.DeliveryAmount,
			&s.CurrencyType, &s.UnitRate,
			&s.DetailCostCategoryID, &s.QuoteLink, &s.Description,
			&s.QuotePriceDate, &s.QuoteValidUntil,
		); err != nil {
			return nil, fmt.Errorf("loadArchiveSourceItemsTx: scan: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("loadArchiveSourceItemsTx: rows: %w", err)
	}

	// Явно запрошенный id, которого нет в позиции, — ошибка, а не тихий пропуск.
	if len(itemIDs) > 0 && len(out) != len(itemIDs) {
		found := make(map[string]bool, len(out))
		for _, r := range out {
			found[r.ID] = true
		}
		for _, want := range itemIDs {
			if !found[want] {
				return nil, &ArchiveSourceNotFoundError{PositionID: positionID, ItemID: want}
			}
		}
	}
	return out, nil
}

// positionScope — минимум о позиции: её тендер и объём для volume_ratio.
type positionScope struct {
	TenderID     string
	Volume       *float64
	ManualVolume *float64
}

// EffectiveVolume — объём для масштабирования: manual_volume («объём ГП»), а
// при его отсутствии — volume заказчика. Тот же приоритет, что во всём приложении.
func (p positionScope) EffectiveVolume() *float64 {
	if p.ManualVolume != nil {
		return p.ManualVolume
	}
	return p.Volume
}

// loadPositionScopeTx читает тендер и объёмы позиции.
func loadPositionScopeTx(ctx context.Context, tx pgx.Tx, positionID string) (positionScope, error) {
	var s positionScope
	err := tx.QueryRow(ctx, `
		SELECT tender_id::text, volume, manual_volume
		FROM public.client_positions WHERE id = $1
	`, positionID).Scan(&s.TenderID, &s.Volume, &s.ManualVolume)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return s, &ArchiveSourceNotFoundError{PositionID: positionID}
		}
		return s, fmt.Errorf("loadPositionScopeTx: %w", err)
	}
	return s, nil
}

// resolveScaleFactor вычисляет коэффициент пересчёта количеств.
func resolveScaleFactor(
	spec *ScaleSpec, srcVolume, tgtVolume *float64, groupTempID string,
) (float64, string, error) {
	if spec == nil || spec.Mode == "" || spec.Mode == ScaleModeNone {
		return 1, ScaleModeNone, nil
	}

	switch spec.Mode {
	case ScaleModeFactor:
		if spec.Factor == nil {
			return 0, spec.Mode, &ArchiveScaleError{
				GroupTempID: groupTempID, Reason: "mode=factor требует поле factor",
			}
		}
		k := *spec.Factor
		if err := validateFactor(k, groupTempID); err != nil {
			return 0, spec.Mode, err
		}
		return k, ScaleModeFactor, nil

	case ScaleModeVolumeRatio:
		src := spec.SourceVolume
		if src == nil {
			src = srcVolume
		}
		tgt := spec.TargetVolume
		if tgt == nil {
			tgt = tgtVolume
		}
		if src == nil || *src <= 0 {
			return 0, spec.Mode, &ArchiveScaleError{
				GroupTempID: groupTempID, Undefined: true,
				Reason: "объём позиции-источника не задан или не положителен",
			}
		}
		if tgt == nil || *tgt <= 0 {
			return 0, spec.Mode, &ArchiveScaleError{
				GroupTempID: groupTempID, Undefined: true,
				Reason: "объём целевой позиции не задан или не положителен",
			}
		}
		k := *tgt / *src
		if err := validateFactor(k, groupTempID); err != nil {
			return 0, spec.Mode, err
		}
		return k, ScaleModeVolumeRatio, nil

	default:
		return 0, spec.Mode, &ArchiveScaleError{
			GroupTempID: groupTempID,
			Reason:      fmt.Sprintf("неизвестный режим масштабирования %q", spec.Mode),
		}
	}
}

func validateFactor(k float64, groupTempID string) error {
	if math.IsNaN(k) || math.IsInf(k, 0) || k <= 0 {
		return &ArchiveScaleError{
			GroupTempID: groupTempID,
			Reason:      fmt.Sprintf("коэффициент %g недопустим (нужен конечный и положительный)", k),
		}
	}
	return nil
}

// planSourceBlock переносит строки одного источника в план группы.
// baseOffset — сколько строк уже лежит в группе (индексы родителей глобальны
// для группы, а ResolveCopiedParents считает их внутри источника).
func planSourceBlock(
	src []archiveSrcRow, baseOffset int,
) ([]plannedItem, error) {
	refs := make([]CopiedParentRef, len(src))
	for i, s := range src {
		refs[i] = CopiedParentRef{ID: s.ID, ParentID: s.ParentWorkItemID, ItemType: s.BoqItemType}
	}
	parentIdx, err := ResolveCopiedParents(refs)
	if err != nil {
		return nil, err
	}

	out := make([]plannedItem, len(src))
	for i, s := range src {
		p := plannedItem{
			src:          s,
			SourceItemID: s.ID,
			SourceTender: s.TenderID,
			ParentIdx:    -1,
			Quantity:     s.Quantity,
			BaseQuantity: s.BaseQuantity,
		}
		if parentIdx[i] >= 0 {
			p.ParentIdx = baseOffset + parentIdx[i]
		}
		out[i] = p
	}
	return out, nil
}

// scaleBlock пересчитывает количества блока строк одного источника.
//
// Два прохода. Сначала работы: quantity = src * k. Затем материалы: у
// самостоятельных тоже src * k, а у ПРИВЯЗАННЫХ к работе количество
// ПЕРЕ-ВЫВОДИТСЯ из уже масштабированного родителя по формуле
// RecomputeLinkedMaterialsForWork (parentQty * conversion * consumption).
// Умножать хранимое количество ребёнка на k нельзя: calc принудительно
// считает consumption = 1 для привязанной строки, потому что расход уже зашит
// в quantity. Пере-вывод делает результат идемпотентным — последующий
// recompute-linked-materials ничего не изменит.
func scaleBlock(
	group *plannedGroup, block []plannedItem, k float64, opt ComposeOptions, groupTempID string,
) ([]ComposeWarning, error) {
	var warnings []ComposeWarning

	scaleOpt := func(v *float64) *float64 {
		if v == nil {
			return nil
		}
		out := roundQuantity(*v*k, opt.QuantityDecimals)
		return &out
	}

	// Проход 1 — работы.
	for i := range block {
		if !calc.IsWorkBoqType(block[i].src.BoqItemType) {
			continue
		}
		block[i].Quantity = scaleOpt(block[i].src.Quantity)
		block[i].BaseQuantity = scaleOpt(block[i].src.BaseQuantity)
	}

	// Проход 2 — материалы.
	for i := range block {
		it := &block[i]
		if calc.IsWorkBoqType(it.src.BoqItemType) {
			continue
		}
		if it.ParentIdx < 0 {
			it.Quantity = scaleOpt(it.src.Quantity)
			it.BaseQuantity = scaleOpt(it.src.BaseQuantity)
			continue
		}

		parent := resolvePlannedParent(group, block, it.ParentIdx)
		if parent == nil || parent.Quantity == nil {
			// Родитель без количества — оставляем масштабирование по k,
			// пере-выводить не из чего.
			it.Quantity = scaleOpt(it.src.Quantity)
			it.BaseQuantity = nil
			continue
		}

		conv := coefOrOne(it.src.ConversionCoefficient)
		cons := coefOrOne(it.src.ConsumptionCoefficient)
		rederived := roundQuantity(*parent.Quantity*conv*cons, opt.QuantityDecimals)

		if it.src.Quantity != nil {
			expected := *it.src.Quantity * k
			if math.Abs(rederived-expected) > 1e-9*math.Max(1, math.Abs(rederived)) {
				stored, red := expected, rederived
				warnings = append(warnings, ComposeWarning{
					Code:         WarnLinkedQuantityRederived,
					GroupTempID:  groupTempID,
					SourceItemID: it.SourceItemID,
					Stored:       &stored,
					Rederived:    &red,
				})
			}
		}
		it.Quantity = &rederived
		// base_quantity привязанной строки не хранится: количество полностью
		// определяется родителем и коэффициентами.
		it.BaseQuantity = nil
	}

	// CHECK quantity > 0 — проверяем ДО любой записи, без молчаливого клампа.
	for i := range block {
		if q := block[i].Quantity; q != nil && *q <= 0 {
			return nil, &ArchiveQuantityUnderflowError{
				GroupTempID:  groupTempID,
				SourceItemID: block[i].SourceItemID,
				Factor:       k,
			}
		}
		if b := block[i].BaseQuantity; b != nil && *b <= 0 {
			block[i].BaseQuantity = nil
		}
	}
	return warnings, nil
}

// resolvePlannedParent достаёт родителя по глобальному индексу группы: он либо
// уже в накопленных строках группы, либо в текущем блоке.
func resolvePlannedParent(group *plannedGroup, block []plannedItem, idx int) *plannedItem {
	if idx < len(group.Items) {
		return &group.Items[idx]
	}
	local := idx - len(group.Items)
	if local >= 0 && local < len(block) {
		return &block[local]
	}
	return nil
}

func coefOrOne(v *float64) float64 {
	if v == nil || *v <= 0 {
		return 1
	}
	return *v
}

func roundQuantity(v float64, decimals *int) float64 {
	if decimals == nil {
		return v
	}
	d := *decimals
	if d < 0 {
		d = 0
	}
	if d > 9 {
		d = 9
	}
	p := math.Pow(10, float64(d))
	return math.Round(v*p) / p
}
