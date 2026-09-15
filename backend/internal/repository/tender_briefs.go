package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// TenderBrief — краткая выжимка по тендеру для руководства. Цифры в ней не
// хранятся: они считаются из расчёта (cost-benchmarks), чтобы не разойтись с
// тендером. Хранится текст и выбор категорий для блока цифр.
type TenderBrief struct {
	TenderID        string     `json:"tender_id"`
	SummaryText     string     `json:"summary_text"`
	FactCategoryIDs []string   `json:"fact_category_ids"`
	UpdatedAt       *time.Time `json:"updated_at"`
	UpdatedByName   *string    `json:"updated_by_name"`
}

// GetBrief — выжимка тендера; ещё не заведённая возвращается пустой.
func (r *CostBenchmarkRepo) GetBrief(ctx context.Context, tenderID string) (*TenderBrief, error) {
	b := &TenderBrief{TenderID: tenderID}
	var ids []string
	err := r.pool.QueryRow(ctx, `
		SELECT tb.summary_text, tb.fact_category_ids::text[], tb.updated_at, u.full_name
		FROM public.tender_briefs tb
		LEFT JOIN public.users u ON u.id = tb.updated_by
		WHERE tb.tender_id = $1`, tenderID).
		Scan(&b.SummaryText, &ids, &b.UpdatedAt, &b.UpdatedByName)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return b, nil
	case err != nil:
		return nil, fmt.Errorf("costBenchmark.GetBrief: %w", err)
	}
	b.FactCategoryIDs = ids
	return b, nil
}

// SaveBrief сохраняет текст и выбор категорий. factCategoryIDs == nil — категории
// выбираются автоматически (крупнейшие по сумме).
func (r *CostBenchmarkRepo) SaveBrief(
	ctx context.Context,
	tenderID, summaryText string,
	factCategoryIDs []string,
	actor *string,
) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.tender_briefs (tender_id, summary_text, fact_category_ids, updated_by)
		VALUES ($1, $2, $3::uuid[], $4::uuid)
		ON CONFLICT (tender_id) DO UPDATE
		SET summary_text = EXCLUDED.summary_text,
		    fact_category_ids = EXCLUDED.fact_category_ids,
		    updated_by = EXCLUDED.updated_by`,
		tenderID, summaryText, factCategoryIDs, actor)
	if err != nil {
		return mapRangeErr("SaveBrief", err)
	}
	return nil
}
