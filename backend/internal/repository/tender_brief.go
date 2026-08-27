package repository

import (
	"context"
	"fmt"
	"time"
)

// TenderBriefRow — узкая карточка тендера для машинного доступа
// (GET /api/v1/tenders/brief): идентификация и статус, без финансовых итогов,
// курсов, ссылок на папки и состояния расчёта.
type TenderBriefRow struct {
	ID                 string    `json:"id"`
	TenderNumber       string    `json:"tender_number"`
	Title              string    `json:"title"`
	ClientName         string    `json:"client_name"`
	Version            *int64    `json:"version"`
	IsArchived         bool      `json:"is_archived"`
	HousingClass       *string   `json:"housing_class"`
	ConstructionScope  *string   `json:"construction_scope"`
	SubmissionDeadline *string   `json:"submission_deadline"`
	UpdatedAt          time.Time `json:"updated_at"`
}

// TenderBriefParams — фильтры ListTendersBrief.
type TenderBriefParams struct {
	IsArchived *bool
	// Search — подстрока без учёта регистра по title, client_name, tender_number.
	Search string
	// IDs — ограничение ключа по списку тендеров; пусто = без ограничения.
	IDs []string
}

// tenderBriefLimit — потолок без курсора: это выпадающий список, а не лента.
const tenderBriefLimit = 1000

// buildTenderBriefQuery — чистый построитель (см. buildTenderListQuery):
// проверяем порядок плейсхолдеров без тестовой БД.
func buildTenderBriefQuery(p TenderBriefParams) (string, []any) {
	args := []any{}
	where := "WHERE 1=1"

	if p.IsArchived != nil {
		where += fmt.Sprintf(" AND is_archived = $%d", len(args)+1)
		args = append(args, *p.IsArchived)
	}
	if p.Search != "" {
		n := len(args) + 1
		where += fmt.Sprintf(
			" AND (title ILIKE $%d OR client_name ILIKE $%d OR tender_number ILIKE $%d)",
			n, n, n,
		)
		args = append(args, "%"+p.Search+"%")
	}
	if len(p.IDs) > 0 {
		where += fmt.Sprintf(" AND id = ANY($%d::uuid[])", len(args)+1)
		args = append(args, p.IDs)
	}

	q := fmt.Sprintf(`
		SELECT id::text, tender_number, title, client_name,
		       version, is_archived,
		       housing_class::text, construction_scope::text,
		       submission_deadline::text,
		       COALESCE(updated_at, NOW())
		FROM public.tenders
		%s
		ORDER BY tender_number, version DESC NULLS LAST, id
		LIMIT %d
	`, where, tenderBriefLimit)

	return q, args
}

// ListTendersBrief returns the brief tender list (no cursor, hard cap
// tenderBriefLimit), ordered by tender_number then newest version first.
func (r *TenderRepo) ListTendersBrief(ctx context.Context, p TenderBriefParams) ([]TenderBriefRow, error) {
	q, args := buildTenderBriefQuery(p)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("tenderRepo.ListTendersBrief: query: %w", err)
	}
	defer rows.Close()

	var result []TenderBriefRow
	for rows.Next() {
		var row TenderBriefRow
		if err := rows.Scan(
			&row.ID, &row.TenderNumber, &row.Title, &row.ClientName,
			&row.Version, &row.IsArchived,
			&row.HousingClass, &row.ConstructionScope,
			&row.SubmissionDeadline,
			&row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("tenderRepo.ListTendersBrief: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderRepo.ListTendersBrief: rows: %w", err)
	}
	return result, nil
}
