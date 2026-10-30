package repository

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
)

// AutopricePosition — шапка позиции в карточке проверки.
type AutopricePosition struct {
	ID             string   `json:"id"`
	PositionNumber float64  `json:"position_number"`
	ItemNo         *string  `json:"item_no"`
	WorkName       string   `json:"work_name"`
	UnitCode       *string  `json:"unit_code"`
	Volume         *float64 `json:"volume"`
	// CustomerVolume — объём из ВОР Заказчика (client_positions.volume) без
	// ручной правки; Volume = COALESCE(manual_volume, volume).
	CustomerVolume *float64 `json:"customer_volume"`
}

// AutopriceMachineSnapshot — то, что записала авторасценка в строку (new_data
// первой INSERT-записи аудита).
type AutopriceMachineSnapshot struct {
	Name                   string   `json:"name"`
	UnitRate               *float64 `json:"unit_rate"`
	ConversionCoefficient  *float64 `json:"conversion_coefficient"`
	ConsumptionCoefficient *float64 `json:"consumption_coefficient"`
	MaterialType           *string  `json:"material_type"`
	Quantity               *float64 `json:"quantity"`

	workNameID, materialNameID *string
}

// AutopriceItem — строка позиции в карточке проверки.
type AutopriceItem struct {
	ID                     string                    `json:"id"`
	BoqItemType            string                    `json:"boq_item_type"`
	MaterialType           *string                   `json:"material_type"`
	Name                   string                    `json:"name"`
	UnitCode               *string                   `json:"unit_code"`
	Quantity               *float64                  `json:"quantity"`
	UnitRate               *float64                  `json:"unit_rate"`
	ConversionCoefficient  *float64                  `json:"conversion_coefficient"`
	ConsumptionCoefficient *float64                  `json:"consumption_coefficient"`
	ParentWorkItemID       *string                   `json:"parent_work_item_id"`
	Origin                 string                    `json:"origin"`
	Machine                *AutopriceMachineSnapshot `json:"machine"`
	Changed                []string                  `json:"changed"`

	workNameID, materialNameID *string
}

// AutopriceDeletedItem — строка позиции, удалённая после загрузки прогона.
type AutopriceDeletedItem struct {
	BoqItemID     string    `json:"boq_item_id"`
	Name          string    `json:"name"`
	BoqItemType   string    `json:"boq_item_type"`
	DeletedAt     time.Time `json:"deleted_at"`
	DeletedByName *string   `json:"deleted_by_name"`
}

// AutopriceDetail — ответ GET /autoprice-runs/{sid}/positions/{posId}.
type AutopriceDetail struct {
	Review   *AutopriceReview       `json:"review"`
	Position AutopricePosition      `json:"position"`
	Items    []AutopriceItem        `json:"items"`
	Deleted  []AutopriceDeletedItem `json:"deleted"`
}

const autopriceItemsSQL = `
SELECT b.id::text, b.boq_item_type::text, b.material_type::text,
       COALESCE(mn.name, wn.name, b.description, ''), b.unit_code,
       b.quantity::float8, b.unit_rate::float8, b.conversion_coefficient::float8,
       b.consumption_coefficient::float8, b.parent_work_item_id::text,
       COALESCE(b.import_session_id = $2, false),
       b.work_name_id::text, b.material_name_id::text
FROM public.boq_items b
LEFT JOIN public.material_names mn ON mn.id = b.material_name_id
LEFT JOIN public.work_names wn ON wn.id = b.work_name_id
WHERE b.client_position_id = $1
ORDER BY b.sort_number, b.created_at, b.id`

// autopriceMachineSQL — снимок авторасценки по строкам одним запросом: первая
// INSERT-запись аудита каждой строки. Числа читаются из jsonb приведением.
const autopriceMachineSQL = `
SELECT DISTINCT ON (a.boq_item_id)
       a.boq_item_id::text,
       COALESCE(mn.name, wn.name, a.new_data ->> 'description', ''),
       (a.new_data ->> 'unit_rate')::numeric::float8,
       (a.new_data ->> 'conversion_coefficient')::numeric::float8,
       (a.new_data ->> 'consumption_coefficient')::numeric::float8,
       a.new_data ->> 'material_type',
       (a.new_data ->> 'quantity')::numeric::float8,
       a.new_data ->> 'work_name_id', a.new_data ->> 'material_name_id'
FROM public.boq_items_audit a
LEFT JOIN public.material_names mn ON mn.id = NULLIF(a.new_data ->> 'material_name_id', '')::uuid
LEFT JOIN public.work_names wn ON wn.id = NULLIF(a.new_data ->> 'work_name_id', '')::uuid
WHERE a.boq_item_id = ANY($1::uuid[]) AND a.operation_type = 'INSERT'
ORDER BY a.boq_item_id, a.changed_at ASC`

// autopriceDeletedSQL — DELETE-записи аудита по строкам позиции после загрузки
// прогона; удалённая строка видна только в old_data (idx_audit_old_position).
const autopriceDeletedSQL = `
SELECT a.boq_item_id::text,
       COALESCE(mn.name, wn.name, a.old_data ->> 'description', ''),
       COALESCE(a.old_data ->> 'boq_item_type', ''), a.changed_at, u.full_name
FROM public.boq_items_audit a
LEFT JOIN public.material_names mn ON mn.id = NULLIF(a.old_data ->> 'material_name_id', '')::uuid
LEFT JOIN public.work_names wn ON wn.id = NULLIF(a.old_data ->> 'work_name_id', '')::uuid
LEFT JOIN public.users u ON u.id = a.changed_by
WHERE (a.old_data ->> 'client_position_id') = $1
  AND a.operation_type = 'DELETE' AND a.changed_at >= $2
ORDER BY a.changed_at DESC, a.id`

func floatsDiffer(a, b *float64) bool {
	if a == nil || b == nil {
		return a != b
	}
	return math.Abs(*a-*b) > 1e-9
}

func strsDiffer(a, b *string) bool {
	if a == nil || b == nil {
		return a != b
	}
	return *a != *b
}

// changedFromMachine — поля из AutopriceStaleFields, отличающиеся от снимка авторасценки.
func (it *AutopriceItem) changedFromMachine(m *AutopriceMachineSnapshot) []string {
	out := make([]string, 0)
	if floatsDiffer(it.UnitRate, m.UnitRate) {
		out = append(out, "unit_rate")
	}
	if floatsDiffer(it.ConversionCoefficient, m.ConversionCoefficient) {
		out = append(out, "conversion_coefficient")
	}
	if floatsDiffer(it.ConsumptionCoefficient, m.ConsumptionCoefficient) {
		out = append(out, "consumption_coefficient")
	}
	if strsDiffer(it.workNameID, m.workNameID) {
		out = append(out, "work_name_id")
	}
	if strsDiffer(it.materialNameID, m.materialNameID) {
		out = append(out, "material_name_id")
	}
	if strsDiffer(it.MaterialType, m.MaterialType) {
		out = append(out, "material_type")
	}
	return out
}

// GetPositionDetail — карточка позиции прогона: проверка, шапка, строки со
// снимком авторасценки и удалённые строки. Три запроса на позицию, без N+1.
func (r *AutopriceReviewRepo) GetPositionDetail(ctx context.Context, sessionID, positionID string) (*AutopriceDetail, error) {
	review, err := getAutopriceReview(ctx, r.pool, sessionID, positionID)
	if err != nil {
		return nil, err
	}
	var importedAt time.Time
	if err := r.pool.QueryRow(ctx,
		`SELECT imported_at FROM public.import_sessions WHERE id = $1`, sessionID).Scan(&importedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAutopriceRunNotFound
		}
		return nil, fmt.Errorf("autoprice.GetPositionDetail: run: %w", err)
	}

	d := &AutopriceDetail{Review: review, Items: make([]AutopriceItem, 0), Deleted: make([]AutopriceDeletedItem, 0)}
	if err := r.pool.QueryRow(ctx, `
		SELECT id::text, position_number::float8, item_no, work_name, unit_code,
		       COALESCE(manual_volume, volume)::float8, volume::float8
		FROM public.client_positions WHERE id = $1`, positionID,
	).Scan(&d.Position.ID, &d.Position.PositionNumber, &d.Position.ItemNo, &d.Position.WorkName,
		&d.Position.UnitCode, &d.Position.Volume, &d.Position.CustomerVolume); err != nil {
		return nil, fmt.Errorf("autoprice.GetPositionDetail: position: %w", err)
	}

	autoIDs := make([]string, 0)
	rows, err := r.pool.Query(ctx, autopriceItemsSQL, positionID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("autoprice.GetPositionDetail: items: %w", err)
	}
	for rows.Next() {
		var it AutopriceItem
		var auto bool
		if err := rows.Scan(&it.ID, &it.BoqItemType, &it.MaterialType, &it.Name, &it.UnitCode,
			&it.Quantity, &it.UnitRate, &it.ConversionCoefficient, &it.ConsumptionCoefficient,
			&it.ParentWorkItemID, &auto, &it.workNameID, &it.materialNameID); err != nil {
			rows.Close()
			return nil, fmt.Errorf("autoprice.GetPositionDetail: scan item: %w", err)
		}
		it.Origin = "manual"
		it.Changed = make([]string, 0)
		if auto {
			it.Origin = "auto"
			autoIDs = append(autoIDs, it.ID)
		}
		d.Items = append(d.Items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("autoprice.GetPositionDetail: items: %w", err)
	}

	if len(autoIDs) > 0 {
		snaps, err := r.machineSnapshots(ctx, autoIDs)
		if err != nil {
			return nil, err
		}
		for i := range d.Items {
			it := &d.Items[i]
			if m, ok := snaps[it.ID]; ok && it.Origin == "auto" {
				it.Machine = m
				it.Changed = it.changedFromMachine(m)
			}
		}
	}

	drows, err := r.pool.Query(ctx, autopriceDeletedSQL, positionID, importedAt)
	if err != nil {
		return nil, fmt.Errorf("autoprice.GetPositionDetail: deleted: %w", err)
	}
	defer drows.Close()
	for drows.Next() {
		var x AutopriceDeletedItem
		if err := drows.Scan(&x.BoqItemID, &x.Name, &x.BoqItemType, &x.DeletedAt, &x.DeletedByName); err != nil {
			return nil, fmt.Errorf("autoprice.GetPositionDetail: scan deleted: %w", err)
		}
		d.Deleted = append(d.Deleted, x)
	}
	return d, drows.Err()
}

func (r *AutopriceReviewRepo) machineSnapshots(ctx context.Context, itemIDs []string) (map[string]*AutopriceMachineSnapshot, error) {
	rows, err := r.pool.Query(ctx, autopriceMachineSQL, itemIDs)
	if err != nil {
		return nil, fmt.Errorf("autoprice.machineSnapshots: %w", err)
	}
	defer rows.Close()
	out := make(map[string]*AutopriceMachineSnapshot, len(itemIDs))
	for rows.Next() {
		var id string
		m := &AutopriceMachineSnapshot{}
		if err := rows.Scan(&id, &m.Name, &m.UnitRate, &m.ConversionCoefficient, &m.ConsumptionCoefficient,
			&m.MaterialType, &m.Quantity, &m.workNameID, &m.materialNameID); err != nil {
			return nil, fmt.Errorf("autoprice.machineSnapshots scan: %w", err)
		}
		out[id] = m
	}
	return out, rows.Err()
}
