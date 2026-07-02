package repository

import (
	"context"
	"fmt"
)

// ─── markup_parameters ─────────────────────────────────────────────────────

type MarkupParameterRow struct {
	ID           string   `json:"id"`
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	IsActive     bool     `json:"is_active"`
	OrderNum     *int     `json:"order_num,omitempty"`
	DefaultValue *float64 `json:"default_value,omitempty"`
	CreatedAt    *string  `json:"created_at,omitempty"`
	UpdatedAt    *string  `json:"updated_at,omitempty"`
}

func (r *MarkupRepo) ListActiveParameters(ctx context.Context) ([]MarkupParameterRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, key, COALESCE(label, ''),
		       COALESCE(is_active, true), order_num, default_value,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.markup_parameters
		WHERE is_active = true
		ORDER BY order_num ASC NULLS LAST
	`)
	if err != nil {
		return nil, fmt.Errorf("markupRepo.ListActiveParameters: %w", err)
	}
	defer rows.Close()
	out := make([]MarkupParameterRow, 0)
	for rows.Next() {
		var p MarkupParameterRow
		if err := rows.Scan(&p.ID, &p.Key, &p.Label, &p.IsActive, &p.OrderNum,
			&p.DefaultValue, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("markupRepo.ListActiveParameters scan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type MarkupParameterInput struct {
	Key          string   `json:"key"`
	Label        string   `json:"label"`
	IsActive     *bool    `json:"is_active"`
	OrderNum     *int     `json:"order_num"`
	DefaultValue *float64 `json:"default_value"`
}

func (r *MarkupRepo) CreateParameter(ctx context.Context, in MarkupParameterInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.markup_parameters (key, label, is_active, order_num, default_value)
		VALUES ($1, $2, COALESCE($3, true), $4, $5)
	`, in.Key, in.Label, in.IsActive, in.OrderNum, in.DefaultValue)
	if err != nil {
		return fmt.Errorf("markupRepo.CreateParameter: %w", err)
	}
	return nil
}

type MarkupParameterPatch struct {
	Label        *string  `json:"label"`
	DefaultValue *float64 `json:"default_value"`
	OrderNum     *int     `json:"order_num"`
	IsActive     *bool    `json:"is_active"`
}

func (r *MarkupRepo) UpdateParameter(ctx context.Context, id string, p MarkupParameterPatch) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.markup_parameters
		SET label         = COALESCE($1, label),
		    default_value = COALESCE($2, default_value),
		    order_num     = COALESCE($3, order_num),
		    is_active     = COALESCE($4, is_active),
		    updated_at    = NOW()
		WHERE id = $5
	`, p.Label, p.DefaultValue, p.OrderNum, p.IsActive, id)
	if err != nil {
		return fmt.Errorf("markupRepo.UpdateParameter: %w", err)
	}
	return nil
}

func (r *MarkupRepo) DeleteParameter(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.markup_parameters WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("markupRepo.DeleteParameter: %w", err)
	}
	return nil
}

func (r *MarkupRepo) SetParameterOrderNum(ctx context.Context, id string, orderNum int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.markup_parameters SET order_num = $1, updated_at = NOW() WHERE id = $2
	`, orderNum, id)
	if err != nil {
		return fmt.Errorf("markupRepo.SetParameterOrderNum: %w", err)
	}
	return nil
}

// ─── tender_markup_percentage ──────────────────────────────────────────────

type TenderMarkupPctRow struct {
	ID                string                 `json:"id"`
	TenderID          string                 `json:"tender_id"`
	MarkupParameterID string                 `json:"markup_parameter_id"`
	Value             float64                `json:"value"`
	MarkupParameter   *MarkupParameterRow    `json:"markup_parameter,omitempty"`
}

func (r *MarkupRepo) ListTenderMarkupPercentages(ctx context.Context, tenderID string) ([]TenderMarkupPctRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT tmp.id::text, tmp.tender_id::text, tmp.markup_parameter_id::text, tmp.value,
		       mp.id::text, mp.key, COALESCE(mp.label, ''),
		       COALESCE(mp.is_active, true), mp.order_num, mp.default_value,
		       to_char(mp.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(mp.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.tender_markup_percentage tmp
		LEFT JOIN public.markup_parameters mp ON mp.id = tmp.markup_parameter_id
		WHERE tmp.tender_id = $1
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("markupRepo.ListTenderMarkupPercentages: %w", err)
	}
	defer rows.Close()
	out := make([]TenderMarkupPctRow, 0)
	for rows.Next() {
		var (
			rec TenderMarkupPctRow
			mp  MarkupParameterRow
		)
		if err := rows.Scan(&rec.ID, &rec.TenderID, &rec.MarkupParameterID, &rec.Value,
			&mp.ID, &mp.Key, &mp.Label, &mp.IsActive, &mp.OrderNum, &mp.DefaultValue,
			&mp.CreatedAt, &mp.UpdatedAt); err != nil {
			return nil, fmt.Errorf("markupRepo.ListTenderMarkupPercentages scan: %w", err)
		}
		if mp.ID != "" {
			recMP := mp
			rec.MarkupParameter = &recMP
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

type TenderMarkupPctInput struct {
	TenderID          string  `json:"tender_id"`
	MarkupParameterID string  `json:"markup_parameter_id"`
	Value             float64 `json:"value"`
}

// ReplaceTenderMarkupPercentages atomically deletes existing rows and inserts
// the supplied set in a single transaction.
func (r *MarkupRepo) ReplaceTenderMarkupPercentages(ctx context.Context, tenderID string, records []TenderMarkupPctInput) error {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("markupRepo.ReplaceTenderMarkupPercentages: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	if _, err := tx.Exec(ctx, `
		DELETE FROM public.tender_markup_percentage WHERE tender_id = $1
	`, tenderID); err != nil {
		return fmt.Errorf("markupRepo.ReplaceTenderMarkupPercentages: delete: %w", err)
	}

	for _, rec := range records {
		_, err := tx.Exec(ctx, `
			INSERT INTO public.tender_markup_percentage (tender_id, markup_parameter_id, value)
			VALUES ($1::uuid, $2::uuid, $3)
		`, rec.TenderID, rec.MarkupParameterID, rec.Value)
		if err != nil {
			return fmt.Errorf("markupRepo.ReplaceTenderMarkupPercentages: insert: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("markupRepo.ReplaceTenderMarkupPercentages: commit: %w", err)
	}
	return nil
}
