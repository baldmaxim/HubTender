package repository

import (
	"context"
	"fmt"
	"time"
)

// PositionListParams holds pagination parameters for ListPositions.
type PositionListParams struct {
	TenderID        string
	CursorUpdatedAt *time.Time
	CursorID        *string
	Limit           int
}

// PositionListRow — строка GET /api/v1/tenders/{id}/positions: PositionRow плюс
// производные поля, которые считаются только для списка. UI этим маршрутом не
// пользуется (ходит в /positions/with-costs), потребитель — машинный доступ
// (TenderConnector/Cursor): фильтр раздела и сопоставление позиций.
type PositionListRow struct {
	PositionRow
	// IsSection — позиция является заголовком раздела, а не исполняемой строкой.
	// Правило зеркалит computeLeafPositions (src/pages/ClientPositions/hooks/
	// useClientPositions.ts): следующая НЕ-дополнительная позиция по
	// (position_number, id) лежит глубже по hierarchy_level.
	IsSection bool `json:"is_section"`
	// CostCategoryID/CostCategoryName — «раздел» в сметном смысле (МОНОЛИТНЫЕ
	// РАБОТЫ, КРОВЛЯ…): самая частая категория затрат по строкам boq_items
	// позиции. NULL, пока позиция не расценена.
	CostCategoryID   *string `json:"cost_category_id"`
	CostCategoryName *string `json:"cost_category_name"`
}

// buildPositionListQuery — чистый построитель запроса ListPositions (без пула и
// ctx), чтобы порядок плейсхолдеров был проверяем в обычном go test.
//
// Страница (WHERE / курсор / ORDER / LIMIT) собирается в подзапросе, а два
// LATERAL считаются только для её строк (≤200), а не для всего тендера.
func buildPositionListQuery(p PositionListParams) (string, []any) {
	args := []any{p.TenderID}
	argN := 2

	cursor := ""
	if p.CursorUpdatedAt != nil && p.CursorID != nil {
		cursor = fmt.Sprintf(
			"AND (updated_at, id) < ($%d, $%d)",
			argN, argN+1,
		)
		args = append(args, *p.CursorUpdatedAt, *p.CursorID)
		argN += 2
	}

	limit := p.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	args = append(args, limit)

	q := fmt.Sprintf(`
		SELECT `+positionScanCols+`,
		       COALESCE(nxt.next_level > COALESCE(cp.hierarchy_level, 0), false) AS is_section,
		       sec.cost_category_id, sec.cost_category_name
		FROM (
		    SELECT * FROM public.client_positions
		    WHERE tender_id = $1
		    %s
		    ORDER BY updated_at DESC, id DESC
		    LIMIT $%d
		) cp
		LEFT JOIN LATERAL (
		    SELECT COALESCE(n.hierarchy_level, 0) AS next_level
		    FROM public.client_positions n
		    WHERE n.tender_id = cp.tender_id
		      AND COALESCE(n.is_additional, false) = false
		      AND (n.position_number, n.id) > (cp.position_number, cp.id)
		    ORDER BY n.position_number, n.id
		    LIMIT 1
		) nxt ON true
		LEFT JOIN LATERAL (
		    SELECT cc.id::text AS cost_category_id, cc.name AS cost_category_name
		    FROM public.boq_items bi
		    JOIN public.detail_cost_categories dcc ON dcc.id = bi.detail_cost_category_id
		    JOIN public.cost_categories cc ON cc.id = dcc.cost_category_id
		    WHERE bi.client_position_id = cp.id
		    GROUP BY cc.id, cc.name
		    ORDER BY COUNT(*) DESC, cc.name, cc.id
		    LIMIT 1
		) sec ON true
		ORDER BY cp.updated_at DESC, cp.id DESC
	`, cursor, argN)

	return q, args
}

// ListPositions returns a page of client_positions for the given tender,
// ordered by (updated_at DESC, id DESC), with the derived section fields.
// No BOQ items are embedded.
func (r *PositionRepo) ListPositions(ctx context.Context, p PositionListParams) ([]PositionListRow, error) {
	q, args := buildPositionListQuery(p)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("positionRepo.ListPositions: query: %w", err)
	}
	defer rows.Close()

	var result []PositionListRow
	for rows.Next() {
		var row PositionListRow
		targets := append(positionScanTargets(&row.PositionRow),
			&row.IsSection, &row.CostCategoryID, &row.CostCategoryName)
		if err := rows.Scan(targets...); err != nil {
			return nil, fmt.Errorf("positionRepo.ListPositions: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("positionRepo.ListPositions: rows: %w", err)
	}
	return result, nil
}
