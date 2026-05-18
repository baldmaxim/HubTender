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

// ─── Read side (replacing supabase.from() in src/pages/Projects/) ──────────

// ProjectTenderJoin is the tender:{id,title,tender_number} embed.
type ProjectTenderJoin struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	TenderNumber string `json:"tender_number"`
}

// ProjectWithTenderRow mirrors `projects.* + tender:tenders(...)`.
type ProjectWithTenderRow struct {
	ID                  string             `json:"id"`
	Name                string             `json:"name"`
	ClientName          string             `json:"client_name"`
	ContractCost        float64            `json:"contract_cost"`
	Area                *float64           `json:"area"`
	ConstructionEndDate *string            `json:"construction_end_date"`
	ContractDate        *string            `json:"contract_date"`
	TenderID            *string            `json:"tender_id"`
	IsActive            bool               `json:"is_active"`
	CreatedAt           *string            `json:"created_at"`
	UpdatedAt           *string            `json:"updated_at"`
	CreatedBy           *string            `json:"created_by"`
	Tender              *ProjectTenderJoin `json:"tender"`
}

const projectWithTenderCols = `
	p.id::text, p.name, p.client_name, p.contract_cost, p.area,
	to_char(p.construction_end_date, 'YYYY-MM-DD'),
	to_char(p.contract_date, 'YYYY-MM-DD'),
	p.tender_id::text, p.is_active,
	to_char(p.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	to_char(p.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
	p.created_by::text,
	t.id::text, t.title, t.tender_number
`

func scanProjectWithTender(row interface{ Scan(...any) error }) (*ProjectWithTenderRow, error) {
	var p ProjectWithTenderRow
	var tID, tTitle, tNumber *string
	if err := row.Scan(
		&p.ID, &p.Name, &p.ClientName, &p.ContractCost, &p.Area,
		&p.ConstructionEndDate, &p.ContractDate,
		&p.TenderID, &p.IsActive,
		&p.CreatedAt, &p.UpdatedAt, &p.CreatedBy,
		&tID, &tTitle, &tNumber,
	); err != nil {
		return nil, err
	}
	if tID != nil {
		p.Tender = &ProjectTenderJoin{
			ID:           *tID,
			Title:        derefStr(tTitle),
			TenderNumber: derefStr(tNumber),
		}
	}
	return &p, nil
}

// ListProjects returns active projects with their tender embed,
// newest first (mirrors is_active=true, order created_at desc).
func (r *ProjectsRepo) ListProjects(ctx context.Context) ([]ProjectWithTenderRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT `+projectWithTenderCols+`
		FROM public.projects p
		LEFT JOIN public.tenders t ON t.id = p.tender_id
		WHERE p.is_active = true
		ORDER BY p.created_at DESC
	`)
	if err != nil {
		return nil, fmt.Errorf("projectsRepo.ListProjects: %w", err)
	}
	defer rows.Close()
	out := make([]ProjectWithTenderRow, 0)
	for rows.Next() {
		p, scanErr := scanProjectWithTender(rows)
		if scanErr != nil {
			return nil, fmt.Errorf("projectsRepo.ListProjects scan: %w", scanErr)
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// GetProject returns a single project (any is_active) with tender embed.
func (r *ProjectsRepo) GetProject(ctx context.Context, id string) (*ProjectWithTenderRow, error) {
	row := r.pool.QueryRow(ctx, `
		SELECT `+projectWithTenderCols+`
		FROM public.projects p
		LEFT JOIN public.tenders t ON t.id = p.tender_id
		WHERE p.id = $1
	`, id)
	p, err := scanProjectWithTender(row)
	if err != nil {
		return nil, fmt.Errorf("projectsRepo.GetProject: %w", err)
	}
	return p, nil
}

// ListAllAgreements returns every agreement, ordered by agreement_date asc.
// The Projects list page maps these by project_id client-side.
func (r *ProjectsRepo) ListAllAgreements(ctx context.Context) ([]AgreementRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, project_id::text, agreement_number,
		       to_char(agreement_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       amount, description,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.project_additional_agreements
		ORDER BY agreement_date ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("projectsRepo.ListAllAgreements: %w", err)
	}
	defer rows.Close()
	out := make([]AgreementRow, 0)
	for rows.Next() {
		var a AgreementRow
		if err := rows.Scan(&a.ID, &a.ProjectID, &a.AgreementNumber, &a.AgreementDate,
			&a.Amount, &a.Description, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("projectsRepo.ListAllAgreements scan: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// MonthlyCompletionRow mirrors a project_monthly_completion row.
type MonthlyCompletionRow struct {
	ID             string   `json:"id"`
	ProjectID      string   `json:"project_id"`
	Year           int      `json:"year"`
	Month          int      `json:"month"`
	ActualAmount   float64  `json:"actual_amount"`
	ForecastAmount *float64 `json:"forecast_amount"`
	Note           *string  `json:"note"`
	CreatedAt      *string  `json:"created_at"`
	UpdatedAt      *string  `json:"updated_at"`
}

// ListMonthlyCompletion returns monthly completion rows ordered by
// (year asc, month asc). When projectID is non-empty it filters to one project.
func (r *ProjectsRepo) ListMonthlyCompletion(ctx context.Context, projectID string) ([]MonthlyCompletionRow, error) {
	q := `
		SELECT id::text, project_id::text, year, month,
		       actual_amount, forecast_amount, note,
		       to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		       to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		FROM public.project_monthly_completion
	`
	args := []any{}
	if projectID != "" {
		q += ` WHERE project_id = $1`
		args = append(args, projectID)
	}
	q += ` ORDER BY year ASC, month ASC`

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("projectsRepo.ListMonthlyCompletion: %w", err)
	}
	defer rows.Close()
	out := make([]MonthlyCompletionRow, 0)
	for rows.Next() {
		var m MonthlyCompletionRow
		if err := rows.Scan(&m.ID, &m.ProjectID, &m.Year, &m.Month,
			&m.ActualAmount, &m.ForecastAmount, &m.Note,
			&m.CreatedAt, &m.UpdatedAt); err != nil {
			return nil, fmt.Errorf("projectsRepo.ListMonthlyCompletion scan: %w", err)
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
