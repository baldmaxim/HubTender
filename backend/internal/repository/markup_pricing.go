package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// ─── tender_pricing_distribution ───────────────────────────────────────────

type PricingDistributionRow struct {
	ID                                       string  `json:"id"`
	TenderID                                 string  `json:"tender_id"`
	MarkupTacticID                           *string `json:"markup_tactic_id,omitempty"`
	BasicMaterialBaseTarget                  string  `json:"basic_material_base_target"`
	BasicMaterialMarkupTarget                string  `json:"basic_material_markup_target"`
	AuxiliaryMaterialBaseTarget              string  `json:"auxiliary_material_base_target"`
	AuxiliaryMaterialMarkupTarget            string  `json:"auxiliary_material_markup_target"`
	ComponentMaterialBaseTarget              string  `json:"component_material_base_target"`
	ComponentMaterialMarkupTarget            string  `json:"component_material_markup_target"`
	SubcontractBasicMaterialBaseTarget       string  `json:"subcontract_basic_material_base_target"`
	SubcontractBasicMaterialMarkupTarget     string  `json:"subcontract_basic_material_markup_target"`
	SubcontractAuxiliaryMaterialBaseTarget   string  `json:"subcontract_auxiliary_material_base_target"`
	SubcontractAuxiliaryMaterialMarkupTarget string  `json:"subcontract_auxiliary_material_markup_target"`
	WorkBaseTarget                           string  `json:"work_base_target"`
	WorkMarkupTarget                         string  `json:"work_markup_target"`
	ComponentWorkBaseTarget                  string  `json:"component_work_base_target"`
	ComponentWorkMarkupTarget                string  `json:"component_work_markup_target"`
	CreatedAt                                *string `json:"created_at,omitempty"`
	UpdatedAt                                *string `json:"updated_at,omitempty"`
}

const pricingDistSelect = `
	SELECT id::text, tender_id::text, markup_tactic_id::text,
	       basic_material_base_target, basic_material_markup_target,
	       auxiliary_material_base_target, auxiliary_material_markup_target,
	       component_material_base_target, component_material_markup_target,
	       subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
	       subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
	       work_base_target, work_markup_target,
	       component_work_base_target, component_work_markup_target,
	       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	FROM public.tender_pricing_distribution
`

func scanPricingDist(scanner interface{ Scan(...any) error }) (PricingDistributionRow, error) {
	var row PricingDistributionRow
	err := scanner.Scan(&row.ID, &row.TenderID, &row.MarkupTacticID,
		&row.BasicMaterialBaseTarget, &row.BasicMaterialMarkupTarget,
		&row.AuxiliaryMaterialBaseTarget, &row.AuxiliaryMaterialMarkupTarget,
		&row.ComponentMaterialBaseTarget, &row.ComponentMaterialMarkupTarget,
		&row.SubcontractBasicMaterialBaseTarget, &row.SubcontractBasicMaterialMarkupTarget,
		&row.SubcontractAuxiliaryMaterialBaseTarget, &row.SubcontractAuxiliaryMaterialMarkupTarget,
		&row.WorkBaseTarget, &row.WorkMarkupTarget,
		&row.ComponentWorkBaseTarget, &row.ComponentWorkMarkupTarget,
		&row.CreatedAt, &row.UpdatedAt)
	return row, err
}

func (r *MarkupRepo) GetPricingDistribution(ctx context.Context, tenderID string) (*PricingDistributionRow, error) {
	row, err := scanPricingDist(r.pool.QueryRow(ctx,
		pricingDistSelect+" WHERE tender_id = $1 LIMIT 1", tenderID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("markupRepo.GetPricingDistribution: %w", err)
	}
	return &row, nil
}

type PricingDistributionInput struct {
	TenderID                                 string  `json:"tender_id"`
	MarkupTacticID                           *string `json:"markup_tactic_id,omitempty"`
	BasicMaterialBaseTarget                  string  `json:"basic_material_base_target"`
	BasicMaterialMarkupTarget                string  `json:"basic_material_markup_target"`
	AuxiliaryMaterialBaseTarget              string  `json:"auxiliary_material_base_target"`
	AuxiliaryMaterialMarkupTarget            string  `json:"auxiliary_material_markup_target"`
	ComponentMaterialBaseTarget              string  `json:"component_material_base_target"`
	ComponentMaterialMarkupTarget            string  `json:"component_material_markup_target"`
	SubcontractBasicMaterialBaseTarget       string  `json:"subcontract_basic_material_base_target"`
	SubcontractBasicMaterialMarkupTarget     string  `json:"subcontract_basic_material_markup_target"`
	SubcontractAuxiliaryMaterialBaseTarget   string  `json:"subcontract_auxiliary_material_base_target"`
	SubcontractAuxiliaryMaterialMarkupTarget string  `json:"subcontract_auxiliary_material_markup_target"`
	WorkBaseTarget                           string  `json:"work_base_target"`
	WorkMarkupTarget                         string  `json:"work_markup_target"`
	ComponentWorkBaseTarget                  string  `json:"component_work_base_target"`
	ComponentWorkMarkupTarget                string  `json:"component_work_markup_target"`
}

func (r *MarkupRepo) UpsertPricingDistribution(ctx context.Context, in PricingDistributionInput) (*PricingDistributionRow, error) {
	row, err := scanPricingDist(r.pool.QueryRow(ctx, `
		INSERT INTO public.tender_pricing_distribution (
			tender_id, markup_tactic_id,
			basic_material_base_target, basic_material_markup_target,
			auxiliary_material_base_target, auxiliary_material_markup_target,
			component_material_base_target, component_material_markup_target,
			subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
			subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
			work_base_target, work_markup_target,
			component_work_base_target, component_work_markup_target
		) VALUES (
			$1::uuid, $2::uuid,
			$3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
		)
		ON CONFLICT (tender_id, markup_tactic_id) DO UPDATE SET
			basic_material_base_target                  = EXCLUDED.basic_material_base_target,
			basic_material_markup_target                = EXCLUDED.basic_material_markup_target,
			auxiliary_material_base_target              = EXCLUDED.auxiliary_material_base_target,
			auxiliary_material_markup_target            = EXCLUDED.auxiliary_material_markup_target,
			component_material_base_target              = EXCLUDED.component_material_base_target,
			component_material_markup_target            = EXCLUDED.component_material_markup_target,
			subcontract_basic_material_base_target      = EXCLUDED.subcontract_basic_material_base_target,
			subcontract_basic_material_markup_target    = EXCLUDED.subcontract_basic_material_markup_target,
			subcontract_auxiliary_material_base_target  = EXCLUDED.subcontract_auxiliary_material_base_target,
			subcontract_auxiliary_material_markup_target= EXCLUDED.subcontract_auxiliary_material_markup_target,
			work_base_target                            = EXCLUDED.work_base_target,
			work_markup_target                          = EXCLUDED.work_markup_target,
			component_work_base_target                  = EXCLUDED.component_work_base_target,
			component_work_markup_target                = EXCLUDED.component_work_markup_target,
			updated_at                                  = NOW()
		RETURNING id::text, tender_id::text, markup_tactic_id::text,
		          basic_material_base_target, basic_material_markup_target,
		          auxiliary_material_base_target, auxiliary_material_markup_target,
		          component_material_base_target, component_material_markup_target,
		          subcontract_basic_material_base_target, subcontract_basic_material_markup_target,
		          subcontract_auxiliary_material_base_target, subcontract_auxiliary_material_markup_target,
		          work_base_target, work_markup_target,
		          component_work_base_target, component_work_markup_target,
		          to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		          to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	`,
		in.TenderID, in.MarkupTacticID,
		in.BasicMaterialBaseTarget, in.BasicMaterialMarkupTarget,
		in.AuxiliaryMaterialBaseTarget, in.AuxiliaryMaterialMarkupTarget,
		in.ComponentMaterialBaseTarget, in.ComponentMaterialMarkupTarget,
		in.SubcontractBasicMaterialBaseTarget, in.SubcontractBasicMaterialMarkupTarget,
		in.SubcontractAuxiliaryMaterialBaseTarget, in.SubcontractAuxiliaryMaterialMarkupTarget,
		in.WorkBaseTarget, in.WorkMarkupTarget,
		in.ComponentWorkBaseTarget, in.ComponentWorkMarkupTarget,
	))
	if err != nil {
		return nil, fmt.Errorf("markupRepo.UpsertPricingDistribution: %w", err)
	}
	return &row, nil
}

// ─── subcontract_growth_exclusions ─────────────────────────────────────────

type SubcontractExclusionRow struct {
	DetailCostCategoryID string `json:"detail_cost_category_id"`
	ExclusionType        string `json:"exclusion_type"`
}

func (r *MarkupRepo) ListSubcontractExclusions(ctx context.Context, tenderID string) ([]SubcontractExclusionRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT detail_cost_category_id::text, exclusion_type
		FROM public.subcontract_growth_exclusions
		WHERE tender_id = $1
	`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("markupRepo.ListSubcontractExclusions: %w", err)
	}
	defer rows.Close()
	out := make([]SubcontractExclusionRow, 0)
	for rows.Next() {
		var rec SubcontractExclusionRow
		if err := rows.Scan(&rec.DetailCostCategoryID, &rec.ExclusionType); err != nil {
			return nil, fmt.Errorf("markupRepo.ListSubcontractExclusions scan: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

type SubcontractExclusionInput struct {
	TenderID             string `json:"tender_id"`
	DetailCostCategoryID string `json:"detail_cost_category_id"`
	ExclusionType        string `json:"exclusion_type"`
}

func (r *MarkupRepo) InsertSubcontractExclusion(ctx context.Context, in SubcontractExclusionInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.subcontract_growth_exclusions (tender_id, detail_cost_category_id, exclusion_type)
		VALUES ($1::uuid, $2::uuid, $3)
		ON CONFLICT DO NOTHING
	`, in.TenderID, in.DetailCostCategoryID, in.ExclusionType)
	if err != nil {
		return fmt.Errorf("markupRepo.InsertSubcontractExclusion: %w", err)
	}
	return nil
}

func (r *MarkupRepo) InsertSubcontractExclusionsBatch(ctx context.Context, rows []SubcontractExclusionInput) error {
	if len(rows) == 0 {
		return nil
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("markupRepo.InsertSubcontractExclusionsBatch: begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	for _, rec := range rows {
		if _, err := tx.Exec(ctx, `
			INSERT INTO public.subcontract_growth_exclusions (tender_id, detail_cost_category_id, exclusion_type)
			VALUES ($1::uuid, $2::uuid, $3)
			ON CONFLICT DO NOTHING
		`, rec.TenderID, rec.DetailCostCategoryID, rec.ExclusionType); err != nil {
			return fmt.Errorf("markupRepo.InsertSubcontractExclusionsBatch: insert: %w", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("markupRepo.InsertSubcontractExclusionsBatch: commit: %w", err)
	}
	return nil
}

func (r *MarkupRepo) DeleteSubcontractExclusion(ctx context.Context, in SubcontractExclusionInput) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM public.subcontract_growth_exclusions
		WHERE tender_id = $1 AND detail_cost_category_id = $2 AND exclusion_type = $3
	`, in.TenderID, in.DetailCostCategoryID, in.ExclusionType)
	if err != nil {
		return fmt.Errorf("markupRepo.DeleteSubcontractExclusion: %w", err)
	}
	return nil
}

func (r *MarkupRepo) DeleteSubcontractExclusionsBatch(ctx context.Context, tenderID string, ids []string, exclusionType string) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.pool.Exec(ctx, `
		DELETE FROM public.subcontract_growth_exclusions
		WHERE tender_id = $1 AND exclusion_type = $2 AND detail_cost_category_id = ANY($3::uuid[])
	`, tenderID, exclusionType, ids)
	if err != nil {
		return fmt.Errorf("markupRepo.DeleteSubcontractExclusionsBatch: %w", err)
	}
	return nil
}
