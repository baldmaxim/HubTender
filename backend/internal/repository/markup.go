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
// Admin/MarkupPercentages. Sub-domains live in sibling files:
// markup_parameters.go (parameters + percentages) and
// markup_pricing.go (pricing distribution + subcontract exclusions).
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
