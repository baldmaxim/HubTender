package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ProjectsRepo handles projects + project_additional_agreements +
// project_monthly_completion CRUD consumed by src/pages/Projects/.
type ProjectsRepo struct {
	pool *pgxpool.Pool
}

// NewProjectsRepo creates a ProjectsRepo.
func NewProjectsRepo(pool *pgxpool.Pool) *ProjectsRepo {
	return &ProjectsRepo{pool: pool}
}

// ─── Projects ───────────────────────────────────────────────────────────────

type ProjectInsert struct {
	Name                *string  `json:"name"`
	ClientName          *string  `json:"client_name"`
	ContractCost        *float64 `json:"contract_cost"`
	Area                *float64 `json:"area"`
	ContractDate        *string  `json:"contract_date"`
	ConstructionEndDate *string  `json:"construction_end_date"`
	TenderID            *string  `json:"tender_id"`
	IsActive            *bool    `json:"is_active"`
}

func (r *ProjectsRepo) Create(ctx context.Context, in ProjectInsert) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.projects (
			name, client_name, contract_cost, area,
			contract_date, construction_end_date,
			tender_id, is_active
		) VALUES (
			$1, $2, $3, $4,
			$5::date, $6::date,
			$7::uuid, COALESCE($8, true)
		)
	`,
		in.Name, in.ClientName, in.ContractCost, in.Area,
		in.ContractDate, in.ConstructionEndDate,
		in.TenderID, in.IsActive,
	)
	if err != nil {
		return fmt.Errorf("projectsRepo.Create: %w", err)
	}
	return nil
}

func (r *ProjectsRepo) Update(ctx context.Context, id string, in ProjectInsert) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.projects
		SET name                  = COALESCE($1, name),
		    client_name           = COALESCE($2, client_name),
		    contract_cost         = COALESCE($3, contract_cost),
		    area                  = $4,
		    contract_date         = $5::date,
		    construction_end_date = $6::date,
		    tender_id             = $7::uuid,
		    is_active             = COALESCE($8, is_active),
		    updated_at            = NOW()
		WHERE id = $9
	`,
		in.Name, in.ClientName, in.ContractCost,
		in.Area, in.ContractDate, in.ConstructionEndDate,
		in.TenderID, in.IsActive,
		id,
	)
	if err != nil {
		return fmt.Errorf("projectsRepo.Update: %w", err)
	}
	return nil
}

func (r *ProjectsRepo) SoftDelete(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.projects SET is_active = false, updated_at = NOW() WHERE id = $1
	`, id)
	if err != nil {
		return fmt.Errorf("projectsRepo.SoftDelete: %w", err)
	}
	return nil
}

// ProjectTenderRow is the tender projection ProjectSettings consumes.
type ProjectTenderRow struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	TenderNumber string `json:"tender_number"`
	ClientName   string `json:"client_name"`
}

func (r *ProjectsRepo) ListActiveTendersForSelect(ctx context.Context) ([]ProjectTenderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, COALESCE(title, ''), COALESCE(tender_number, ''), COALESCE(client_name, '')
		FROM public.tenders
		WHERE is_archived = false
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("projectsRepo.ListActiveTendersForSelect: %w", err)
	}
	defer rows.Close()
	out := make([]ProjectTenderRow, 0)
	for rows.Next() {
		var t ProjectTenderRow
		if err := rows.Scan(&t.ID, &t.Title, &t.TenderNumber, &t.ClientName); err != nil {
			return nil, fmt.Errorf("projectsRepo.ListActiveTendersForSelect scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ─── Agreements ────────────────────────────────────────────────────────────

type AgreementRow struct {
	ID              string  `json:"id"`
	ProjectID       string  `json:"project_id"`
	AgreementNumber *string `json:"agreement_number,omitempty"`
	AgreementDate   *string `json:"agreement_date,omitempty"`
	Amount          float64 `json:"amount"`
	Description     *string `json:"description,omitempty"`
	CreatedAt       *string `json:"created_at,omitempty"`
	UpdatedAt       *string `json:"updated_at,omitempty"`
}

func (r *ProjectsRepo) ListAgreements(ctx context.Context, projectID string, asc bool) ([]AgreementRow, error) {
	order := "DESC"
	if asc {
		order = "ASC"
	}
	rows, err := r.pool.Query(ctx, fmt.Sprintf(`
		SELECT id::text, project_id::text, agreement_number,
		       to_char(agreement_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       amount, description,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.project_additional_agreements
		WHERE project_id = $1
		ORDER BY agreement_date %s
	`, order), projectID)
	if err != nil {
		return nil, fmt.Errorf("projectsRepo.ListAgreements: %w", err)
	}
	defer rows.Close()
	out := make([]AgreementRow, 0)
	for rows.Next() {
		var a AgreementRow
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.AgreementNumber, &a.AgreementDate,
			&a.Amount, &a.Description, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("projectsRepo.ListAgreements scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

type AgreementInput struct {
	ProjectID       string  `json:"project_id"`
	AgreementDate   string  `json:"agreement_date"`
	Amount          float64 `json:"amount"`
	Description     *string `json:"description"`
	AgreementNumber *string `json:"agreement_number"`
}

func (r *ProjectsRepo) CreateAgreement(ctx context.Context, in AgreementInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.project_additional_agreements (
			project_id, agreement_date, amount, description, agreement_number
		) VALUES ($1::uuid, $2::date, $3, $4, $5)
	`, in.ProjectID, in.AgreementDate, in.Amount, in.Description, in.AgreementNumber)
	if err != nil {
		return fmt.Errorf("projectsRepo.CreateAgreement: %w", err)
	}
	return nil
}

type AgreementPatch struct {
	AgreementNumber *string  `json:"agreement_number"`
	AgreementDate   *string  `json:"agreement_date"`
	Amount          *float64 `json:"amount"`
	Description     *string  `json:"description"`
}

func (r *ProjectsRepo) UpdateAgreement(ctx context.Context, id string, p AgreementPatch) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.project_additional_agreements
		SET agreement_number = COALESCE($1, agreement_number),
		    agreement_date   = COALESCE($2::date, agreement_date),
		    amount           = COALESCE($3, amount),
		    description      = COALESCE($4, description),
		    updated_at       = NOW()
		WHERE id = $5
	`, p.AgreementNumber, p.AgreementDate, p.Amount, p.Description, id)
	if err != nil {
		return fmt.Errorf("projectsRepo.UpdateAgreement: %w", err)
	}
	return nil
}

func (r *ProjectsRepo) DeleteAgreement(ctx context.Context, id string) error {
	_, err := r.pool.Exec(ctx, `
		DELETE FROM public.project_additional_agreements WHERE id = $1
	`, id)
	if err != nil {
		return fmt.Errorf("projectsRepo.DeleteAgreement: %w", err)
	}
	return nil
}

// ─── Monthly completion ────────────────────────────────────────────────────

type MonthlyCompletionInput struct {
	ProjectID      string   `json:"project_id"`
	Year           int      `json:"year"`
	Month          int      `json:"month"`
	ActualAmount   float64  `json:"actual_amount"`
	ForecastAmount *float64 `json:"forecast_amount"`
	Note           *string  `json:"note"`
}

func (r *ProjectsRepo) CreateMonthlyCompletion(ctx context.Context, in MonthlyCompletionInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.project_monthly_completion (
			project_id, year, month, actual_amount, forecast_amount, note
		) VALUES ($1::uuid, $2, $3, $4, $5, $6)
	`, in.ProjectID, in.Year, in.Month, in.ActualAmount, in.ForecastAmount, in.Note)
	if err != nil {
		return fmt.Errorf("projectsRepo.CreateMonthlyCompletion: %w", err)
	}
	return nil
}

type MonthlyCompletionPatch struct {
	ActualAmount   float64  `json:"actual_amount"`
	ForecastAmount *float64 `json:"forecast_amount"`
	Note           *string  `json:"note"`
}

func (r *ProjectsRepo) UpdateMonthlyCompletion(ctx context.Context, id string, p MonthlyCompletionPatch) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE public.project_monthly_completion
		SET actual_amount   = $1,
		    forecast_amount = $2,
		    note            = $3,
		    updated_at      = NOW()
		WHERE id = $4
	`, p.ActualAmount, p.ForecastAmount, p.Note, id)
	if err != nil {
		return fmt.Errorf("projectsRepo.UpdateMonthlyCompletion: %w", err)
	}
	return nil
}
