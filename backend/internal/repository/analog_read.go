package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AnalogRepo — пилот «расценка по реальному аналогу»: чтение, предпросмотр,
// применение и отмена решений. Строки пишутся в чёрновой прогон тендера
// (import_sessions, source='autoprice') и проверяются штатным подтверждением
// авторасценки.
type AnalogRepo struct {
	pool *pgxpool.Pool
}

// NewAnalogRepo creates an AnalogRepo.
func NewAnalogRepo(pool *pgxpool.Pool) *AnalogRepo {
	return &AnalogRepo{pool: pool}
}

// analogQuerier — общий вид пула и транзакции для читающих запросов.
type analogQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// analogPositionInfo — позиция и её тендер.
type analogPositionInfo struct {
	Position AnalogSourcePosition
	TenderID string
	Tender   AnalogSourceTender
}

const analogPositionSQL = `
SELECT cp.id::text, cp.tender_id::text, cp.position_number::float8, cp.item_no, cp.work_name,
       cp.position_name, cp.unit_code, COALESCE(cp.manual_volume, cp.volume)::float8,
       cp.client_note, cp.manual_note,
       t.tender_number, COALESCE(t.version, 1), t.title, t.client_name,
       to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       t.financial_approved
FROM public.client_positions cp
JOIN public.tenders t ON t.id = cp.tender_id
WHERE cp.id = $1::uuid`

// loadAnalogPosition читает позицию и тендер; forUpdate блокирует строку позиции.
// Нет позиции — (nil, nil).
func loadAnalogPosition(ctx context.Context, q analogQuerier, positionID string, forUpdate bool) (*analogPositionInfo, error) {
	sql := analogPositionSQL
	if forUpdate {
		sql += ` FOR UPDATE OF cp`
	}
	info := &analogPositionInfo{}
	p, t := &info.Position, &info.Tender
	err := q.QueryRow(ctx, sql, positionID).Scan(
		&p.ID, &info.TenderID, &p.PositionNumber, &p.ItemNo, &p.WorkName,
		&p.PositionName, &p.UnitCode, &p.Volume, &p.ClientNote, &p.ManualNote,
		&t.TenderNumber, &t.Version, &t.Title, &t.ClientName, &t.CreatedAt, &t.FinancialApproved)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("analog.loadPosition: %w", err)
	}
	t.ID = info.TenderID
	return info, nil
}

const analogRowsSelect = `
SELECT bi.id::text, bi.boq_item_type::text, bi.material_type::text,
       COALESCE(wn.name, mn.name, bi.description, ''), bi.unit_code,
       bi.quantity::float8, bi.conversion_coefficient::float8, bi.consumption_coefficient::float8,
       bi.unit_rate::float8, bi.currency_type::text, bi.delivery_price_type::text,
       bi.delivery_amount::float8, bi.total_amount::float8,
       to_char(bi.quote_price_date, 'YYYY-MM-DD'), to_char(bi.quote_valid_until, 'YYYY-MM-DD'),
       bi.quote_link, bi.parent_work_item_id::text, bi.import_session_id::text
FROM public.boq_items bi
LEFT JOIN public.work_names wn ON wn.id = bi.work_name_id
LEFT JOIN public.material_names mn ON mn.id = bi.material_name_id
`

// scanAnalogRows читает строки в порядке запроса: Index — порядковый номер,
// ParentIndex — индекс родительской работы в этом же списке. draftRunID
// отмечает строки чернового прогона (is_draft).
func scanAnalogRows(rows pgx.Rows, draftRunID *string) ([]AnalogRow, error) {
	defer rows.Close()
	out := make([]AnalogRow, 0, 16)
	parents := make([]*string, 0, 16)
	for rows.Next() {
		var r AnalogRow
		var id string
		var parent, session *string
		if err := rows.Scan(&id, &r.BoqItemType, &r.MaterialType, &r.Name, &r.UnitCode,
			&r.Quantity, &r.ConversionCoefficient, &r.ConsumptionCoefficient,
			&r.UnitRate, &r.CurrencyType, &r.DeliveryPriceType, &r.DeliveryAmount, &r.TotalAmount,
			&r.QuotePriceDate, &r.QuoteValidUntil, &r.QuoteLink, &parent, &session); err != nil {
			return nil, fmt.Errorf("analog.scanRows: %w", err)
		}
		r.ID = &id
		r.Index = len(out)
		r.IsDraft = draftRunID != nil && session != nil && *session == *draftRunID
		out = append(out, r)
		parents = append(parents, parent)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("analog.scanRows: %w", err)
	}
	byID := make(map[string]int, len(out))
	for i, r := range out {
		byID[*r.ID] = i
	}
	for i, p := range parents {
		if p == nil {
			continue
		}
		if idx, ok := byID[*p]; ok {
			n := idx
			out[i].ParentIndex = &n
		}
	}
	return out, nil
}

// loadAnalogRowsByPosition — строки позиции по sort_number.
func loadAnalogRowsByPosition(ctx context.Context, q analogQuerier, positionID string, draftRunID *string) ([]AnalogRow, error) {
	rows, err := q.Query(ctx, analogRowsSelect+`
		WHERE bi.client_position_id = $1::uuid
		ORDER BY bi.sort_number, bi.id`, positionID)
	if err != nil {
		return nil, fmt.Errorf("analog.loadRows: %w", err)
	}
	return scanAnalogRows(rows, draftRunID)
}

// loadAnalogRowsByIDs — строки в порядке списка ids (порядок вставки compose).
func loadAnalogRowsByIDs(ctx context.Context, q analogQuerier, ids []string, draftRunID *string) ([]AnalogRow, error) {
	rows, err := q.Query(ctx, analogRowsSelect+`
		WHERE bi.id = ANY($1::uuid[])
		ORDER BY array_position($1::uuid[], bi.id)`, ids)
	if err != nil {
		return nil, fmt.Errorf("analog.loadRowsByIDs: %w", err)
	}
	return scanAnalogRows(rows, draftRunID)
}

// ─── отпечатки ──────────────────────────────────────────────────────────────

// analogSourceFingerprint: md5 по позиции источника (id, единица, объёмы,
// название) и его строкам (id, updated_at) по id.
func analogSourceFingerprint(ctx context.Context, q analogQuerier, positionID string) (string, error) {
	var fp string
	err := q.QueryRow(ctx, `
		SELECT md5(
		  concat_ws('|', cp.id::text, COALESCE(cp.unit_code, ''), COALESCE(cp.volume::text, ''),
		            COALESCE(cp.manual_volume::text, ''), cp.work_name)
		  || '#' || COALESCE((
		      SELECT string_agg(b.id::text || ':' || extract(epoch FROM b.updated_at)::text, ',' ORDER BY b.id)
		      FROM public.boq_items b WHERE b.client_position_id = cp.id), ''))
		FROM public.client_positions cp WHERE cp.id = $1::uuid`, positionID).Scan(&fp)
	if err != nil {
		return "", fmt.Errorf("analog.sourceFingerprint: %w", err)
	}
	return fp, nil
}

// analogTargetFingerprint: md5 по цели (единица, объёмы, название) и её строкам
// (id, updated_at, import_session_id). updated_at самой позиции не берётся: его
// трогает тендерный пересчёт итогов.
func analogTargetFingerprint(ctx context.Context, q analogQuerier, positionID string) (string, error) {
	var fp string
	err := q.QueryRow(ctx, `
		SELECT md5(
		  concat_ws('|', COALESCE(cp.unit_code, ''), COALESCE(cp.volume::text, ''),
		            COALESCE(cp.manual_volume::text, ''), cp.work_name)
		  || '#' || COALESCE((
		      SELECT string_agg(b.id::text || ':' || extract(epoch FROM b.updated_at)::text || ':'
		                        || COALESCE(b.import_session_id::text, ''), ',' ORDER BY b.id)
		      FROM public.boq_items b WHERE b.client_position_id = cp.id), ''))
		FROM public.client_positions cp WHERE cp.id = $1::uuid`, positionID).Scan(&fp)
	if err != nil {
		return "", fmt.Errorf("analog.targetFingerprint: %w", err)
	}
	return fp, nil
}

// ─── состояние цели ─────────────────────────────────────────────────────────

// findAnalogRun — действующий (не отменённый) чёрновой прогон аналогов тендера.
func findAnalogRun(ctx context.Context, q analogQuerier, tenderID string) (*string, error) {
	var id string
	err := q.QueryRow(ctx, `
		SELECT id::text FROM public.import_sessions
		WHERE tender_id = $1::uuid AND source = $2 AND file_name = $3 AND cancelled_at IS NULL
		ORDER BY imported_at, id LIMIT 1`,
		tenderID, AutopriceSource, AnalogRunFileName).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("analog.findRun: %w", err)
	}
	return &id, nil
}

// analogPositionLocked: позиция подтверждена или исключена в каком-либо
// неотменённом прогоне авторасценки — правка запрещена, пока её не переоткрыли.
func analogPositionLocked(ctx context.Context, q analogQuerier, positionID string) (bool, error) {
	var locked bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM public.autoprice_position_reviews r
		  JOIN public.import_sessions s ON s.id = r.import_session_id
		  WHERE r.client_position_id = $1::uuid AND r.status IN ('approved', 'excluded')
		    AND s.source = $2 AND s.cancelled_at IS NULL)`,
		positionID, AutopriceSource).Scan(&locked)
	if err != nil {
		return false, fmt.Errorf("analog.locked: %w", err)
	}
	return locked, nil
}

// analogSourceItemMap — new_item_id → source_item_id из последнего действующего
// решения по позиции (для столбца «источник строки» в составе цели).
func analogSourceItemMap(ctx context.Context, q analogQuerier, positionID string) (map[string]string, error) {
	var raw []byte
	err := q.QueryRow(ctx, `
		SELECT result FROM public.analog_applications
		WHERE client_position_id = $1::uuid AND status = $2
		ORDER BY created_at DESC LIMIT 1`, positionID, AnalogStatusApplied).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("analog.sourceItemMap: %w", err)
	}
	var res analogStoredResult
	if err := json.Unmarshal(raw, &res); err != nil {
		return nil, nil
	}
	m := make(map[string]string, len(res.Items))
	for _, it := range res.Items {
		m[it.NewItemID] = it.SourceItemID
	}
	return m, nil
}

// loadAnalogTarget собирает целевую позицию с состоянием. Нет позиции — (nil, nil).
func loadAnalogTarget(ctx context.Context, q analogQuerier, positionID string, forUpdate bool) (*AnalogTarget, error) {
	info, err := loadAnalogPosition(ctx, q, positionID, forUpdate)
	if err != nil || info == nil {
		return nil, err
	}
	runID, err := findAnalogRun(ctx, q, info.TenderID)
	if err != nil {
		return nil, err
	}
	rows, err := loadAnalogRowsByPosition(ctx, q, positionID, runID)
	if err != nil {
		return nil, err
	}
	locked, err := analogPositionLocked(ctx, q, positionID)
	if err != nil {
		return nil, err
	}

	t := &AnalogTarget{
		PositionID: positionID, TenderID: info.TenderID,
		TenderNumber: info.Tender.TenderNumber, TenderVersion: info.Tender.Version,
		PositionNumber: info.Position.PositionNumber, ItemNo: info.Position.ItemNo,
		WorkName: info.Position.WorkName, UnitCode: info.Position.UnitCode,
		Volume: info.Position.Volume, ClientNote: info.Position.ClientNote,
		ManualNote: info.Position.ManualNote, RunID: runID, Items: rows,
	}
	for _, r := range rows {
		if r.IsDraft {
			t.DraftRowsCount++
		} else {
			t.ForeignRowsCount++
		}
	}
	switch {
	case locked:
		t.State = AnalogStateLocked
	case t.ForeignRowsCount > 0:
		t.State = AnalogStateForeign
	case t.DraftRowsCount > 0:
		t.State = AnalogStateDraftOnly
	default:
		t.State = AnalogStateEmpty
	}

	if runID != nil {
		var status string
		err := q.QueryRow(ctx, `
			SELECT status FROM public.autoprice_position_reviews
			WHERE import_session_id = $1::uuid AND client_position_id = $2::uuid`,
			*runID, positionID).Scan(&status)
		switch {
		case err == nil:
			t.ReviewStatus = &status
		case !errors.Is(err, pgx.ErrNoRows):
			return nil, fmt.Errorf("analog.target review: %w", err)
		}
	}
	if t.DraftRowsCount > 0 {
		m, err := analogSourceItemMap(ctx, q, positionID)
		if err != nil {
			return nil, err
		}
		for i := range t.Items {
			if src, ok := m[*t.Items[i].ID]; ok {
				s := src
				t.Items[i].SourceItemID = &s
			}
		}
	}
	return t, nil
}

// GetTarget — целевая позиция для поиска и предпросмотра; нет позиции —
// *AnalogError ANALOG_TARGET_NOT_FOUND.
func (r *AnalogRepo) GetTarget(ctx context.Context, positionID string) (*AnalogTarget, error) {
	t, err := loadAnalogTarget(ctx, r.pool, positionID, false)
	if err != nil {
		return nil, err
	}
	if t == nil {
		return nil, errAnalogTargetNotFound()
	}
	return t, nil
}

// LoadSourceRows — строки позиции-источника с датами цен (GET /analogs/sources).
func (r *AnalogRepo) LoadSourceRows(ctx context.Context, positionID string) ([]AnalogRow, error) {
	return loadAnalogRowsByPosition(ctx, r.pool, positionID, nil)
}

func errAnalogTargetNotFound() *AnalogError {
	return analogErr(AnalogCodeTargetNotFound, "Позиция не найдена.", nil)
}

func errAnalogSourceNotFound() *AnalogError {
	return analogErr(AnalogCodeSourceNotFound, "Позиция-аналог не найдена.", nil)
}

// NextUnpriced — следующая по номеру позиция того же тендера без строк BOQ, с
// заданной единицей и не подтверждённая/исключённая. Нет такой — (nil, nil).
func (r *AnalogRepo) NextUnpriced(ctx context.Context, positionID string) (*AnalogNext, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM public.client_positions WHERE id = $1::uuid)`, positionID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("analog.next: %w", err)
	}
	if !exists {
		return nil, errAnalogTargetNotFound()
	}
	n := &AnalogNext{}
	err := r.pool.QueryRow(ctx, `
		SELECT n.id::text, n.position_number::float8, n.item_no, n.work_name
		FROM public.client_positions cp
		JOIN public.client_positions n
		  ON n.tender_id = cp.tender_id AND n.position_number > cp.position_number
		WHERE cp.id = $1::uuid
		  AND btrim(COALESCE(n.unit_code, '')) <> ''
		  AND NOT EXISTS (SELECT 1 FROM public.boq_items b WHERE b.client_position_id = n.id)
		  AND NOT EXISTS (
		      SELECT 1 FROM public.autoprice_position_reviews r
		      JOIN public.import_sessions s ON s.id = r.import_session_id
		      WHERE r.client_position_id = n.id AND r.status IN ('approved', 'excluded')
		        AND s.source = $2 AND s.cancelled_at IS NULL)
		ORDER BY n.position_number, n.id
		LIMIT 1`, positionID, AutopriceSource).Scan(&n.PositionID, &n.PositionNumber, &n.ItemNo, &n.WorkName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("analog.next: %w", err)
	}
	return n, nil
}
