package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MarkupRepo handles markup_tactics + markup_parameters +
// tender_markup_percentage + tender_pricing_distribution +
// subcontract_growth_exclusions consumed by Admin/MarkupConstructor and
// Admin/MarkupPercentages.
type MarkupRepo struct {
	pool *pgxpool.Pool
}

// NewMarkupRepo creates a MarkupRepo.
func NewMarkupRepo(pool *pgxpool.Pool) *MarkupRepo {
	return &MarkupRepo{pool: pool}
}

// ─── markup_tactics ─────────────────────────────────────────────────────────

type MarkupTacticRow struct {
	ID         string          `json:"id"`
	Name       string          `json:"name"`
	IsGlobal   bool            `json:"is_global"`
	Sequences  json.RawMessage `json:"sequences"`
	BaseCosts  json.RawMessage `json:"base_costs"`
	CreatedAt  *string         `json:"created_at,omitempty"`
	UpdatedAt  *string         `json:"updated_at,omitempty"`
}

const markupTacticSelect = `
	SELECT id::text, name, COALESCE(is_global, false),
	       COALESCE(sequences, '{}'::jsonb)::text,
	       COALESCE(base_costs, '{}'::jsonb)::text,
	       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	FROM public.markup_tactics
`

func scanMarkupTactic(scanner interface{ Scan(...any) error }) (MarkupTacticRow, error) {
	var (
		row             MarkupTacticRow
		seqText, bcText string
	)
	err := scanner.Scan(&row.ID, &row.Name, &row.IsGlobal, &seqText, &bcText, &row.CreatedAt, &row.UpdatedAt)
	if err == nil {
		row.Sequences = json.RawMessage(seqText)
		row.BaseCosts = json.RawMessage(bcText)
	}
	return row, err
}

func (r *MarkupRepo) ListTactics(ctx context.Context) ([]MarkupTacticRow, error) {
	rows, err := r.pool.Query(ctx, markupTacticSelect+" ORDER BY created_at DESC")
	if err != nil {
		return nil, fmt.Errorf("markupRepo.ListTactics: %w", err)
	}
	defer rows.Close()
	out := make([]MarkupTacticRow, 0)
	for rows.Next() {
		row, err := scanMarkupTactic(rows)
		if err != nil {
			return nil, fmt.Errorf("markupRepo.ListTactics scan: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (r *MarkupRepo) GetTactic(ctx context.Context, id string) (*MarkupTacticRow, error) {
	row, err := scanMarkupTactic(r.pool.QueryRow(ctx, markupTacticSelect+" WHERE id = $1", id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("markupRepo.GetTactic: %w", err)
	}
	return &row, nil
}

func (r *MarkupRepo) FindGlobalTacticByName(ctx context.Context, name string) (*MarkupTacticRow, error) {
	row, err := scanMarkupTactic(r.pool.QueryRow(ctx,
		markupTacticSelect+" WHERE name = $1 AND is_global = true LIMIT 1", name))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("markupRepo.FindGlobalTacticByName: %w", err)
	}
	return &row, nil
}

type MarkupTacticInput struct {
	Name      string          `json:"name"`
	Sequences json.RawMessage `json:"sequences"`
	BaseCosts json.RawMessage `json:"base_costs"`
	IsGlobal  *bool           `json:"is_global"`
}

func (r *MarkupRepo) CreateTactic(ctx context.Context, in MarkupTacticInput) (*MarkupTacticRow, error) {
	row, err := scanMarkupTactic(r.pool.QueryRow(ctx, `
		INSERT INTO public.markup_tactics (name, sequences, base_costs, is_global)
		VALUES ($1, $2::jsonb, $3::jsonb, COALESCE($4, false))
		RETURNING id::text, name, COALESCE(is_global, false),
		          COALESCE(sequences, '{}'::jsonb)::text,
		          COALESCE(base_costs, '{}'::jsonb)::text,
		          to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		          to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
	`, in.Name, jsonRawOrNullObj(in.Sequences), jsonRawOrNullObj(in.BaseCosts), in.IsGlobal))
	if err != nil {
		return nil, fmt.Errorf("markupRepo.CreateTactic: %w", err)
	}
	return &row, nil
}

type MarkupTacticPatch struct {
	Name      *string         `json:"name"`
	Sequences json.RawMessage `json:"sequences,omitempty"`
	BaseCosts json.RawMessage `json:"base_costs,omitempty"`
}

func (r *MarkupRepo) UpdateTactic(ctx context.Context, id string, p MarkupTacticPatch) error {
	var seq, bc any
	if len(p.Sequences) > 0 {
		seq = string(p.Sequences)
	}
	if len(p.BaseCosts) > 0 {
		bc = string(p.BaseCosts)
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE public.markup_tactics
		SET name       = COALESCE($1, name),
		    sequences  = COALESCE($2::jsonb, sequences),
		    base_costs = COALESCE($3::jsonb, base_costs),
		    updated_at = NOW()
		WHERE id = $4
	`, p.Name, seq, bc, id)
	if err != nil {
		return fmt.Errorf("markupRepo.UpdateTactic: %w", err)
	}
	return nil
}

func (r *MarkupRepo) RenameTactic(ctx context.Context, id, name string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.markup_tactics SET name = $1, updated_at = NOW() WHERE id = $2
	`, name, id)
	if err != nil {
		return fmt.Errorf("markupRepo.RenameTactic: %w", err)
	}
	return nil
}

func (r *MarkupRepo) DeleteTactic(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `DELETE FROM public.markup_tactics WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("markupRepo.DeleteTactic: %w", err)
	}
	return nil
}

// jsonRawOrNullObj returns "{}" when raw is empty so the INSERT never fails
// with a NOT NULL violation on the sequences/base_costs columns.
func jsonRawOrNullObj(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
}

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

// ─── tender ↔ markup_tactic linkage ────────────────────────────────────────

func (r *MarkupRepo) GetTenderTacticID(ctx context.Context, tenderID string) (*string, error) {
	var id *string
	err := r.pool.QueryRow(ctx, `
		SELECT markup_tactic_id::text FROM public.tenders WHERE id = $1
	`, tenderID).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("markupRepo.GetTenderTacticID: %w", err)
	}
	return id, nil
}

func (r *MarkupRepo) SetTenderTacticID(ctx context.Context, tenderID, tacticID string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.tenders SET markup_tactic_id = $1::uuid WHERE id = $2
	`, tacticID, tenderID)
	if err != nil {
		return fmt.Errorf("markupRepo.SetTenderTacticID: %w", err)
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
