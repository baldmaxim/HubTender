package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

// TenderRow mirrors the columns returned by ListTenders.
type TenderRow struct {
	ID                string    `json:"id"`
	TenderNumber      string    `json:"tender_number"`
	Title             string    `json:"title"`
	ClientName        string    `json:"client_name"`
	HousingClass      *string   `json:"housing_class"`
	ConstructionScope *string   `json:"construction_scope"`
	IsArchived        bool      `json:"is_archived"`
	CachedGrandTotal  float64   `json:"cached_grand_total"`
	USDRate           *float64  `json:"usd_rate"`
	EURRate           *float64  `json:"eur_rate"`
	CNYRate           *float64  `json:"cny_rate"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// TenderOverviewRow is the aggregate returned by GetTenderOverview.
type TenderOverviewRow struct {
	ID                string    `json:"id"`
	TenderNumber      string    `json:"tender_number"`
	Title             string    `json:"title"`
	ClientName        string    `json:"client_name"`
	HousingClass      *string   `json:"housing_class"`
	ConstructionScope *string   `json:"construction_scope"`
	IsArchived        bool      `json:"is_archived"`
	CachedGrandTotal  float64   `json:"cached_grand_total"`
	USDRate           *float64  `json:"usd_rate"`
	EURRate           *float64  `json:"eur_rate"`
	CNYRate           *float64  `json:"cny_rate"`
	PositionCount     int64     `json:"position_count"`
	BoqItemCount      int64     `json:"boq_item_count"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// TenderListParams holds optional filters for ListTenders.
type TenderListParams struct {
	IsArchived *bool
	// HousingClass filters by housing_class enum value; empty string = no filter.
	HousingClass string
	// Search does a case-insensitive prefix/substring match on title and client_name.
	Search string
	// Cursor fields for keyset pagination.
	CursorUpdatedAt *time.Time
	CursorID        *string
	Limit           int
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

// TenderRepo handles read-only database access for the tenders domain.
type TenderRepo struct {
	pool *pgxpool.Pool
}

// NewTenderRepo creates a TenderRepo.
func NewTenderRepo(pool *pgxpool.Pool) *TenderRepo {
	return &TenderRepo{pool: pool}
}

// ListTenders returns a page of tenders ordered by (updated_at DESC, id DESC).
// Pagination is keyset-based via CursorUpdatedAt + CursorID.
func (r *TenderRepo) ListTenders(ctx context.Context, p TenderListParams) ([]TenderRow, error) {
	args := []any{}
	argN := 1

	// Build WHERE clauses dynamically.
	where := "WHERE 1=1"

	if p.IsArchived != nil {
		where += fmt.Sprintf(" AND is_archived = $%d", argN)
		args = append(args, *p.IsArchived)
		argN++
	}
	if p.HousingClass != "" {
		where += fmt.Sprintf(" AND housing_class = $%d", argN)
		args = append(args, p.HousingClass)
		argN++
	}
	if p.Search != "" {
		where += fmt.Sprintf(
			" AND (title ILIKE $%d OR client_name ILIKE $%d)",
			argN, argN,
		)
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.CursorUpdatedAt != nil && p.CursorID != nil {
		where += fmt.Sprintf(
			" AND (updated_at, id) < ($%d, $%d)",
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
		SELECT id::text, tender_number, title, client_name,
		       housing_class::text, construction_scope::text,
		       is_archived, cached_grand_total,
		       usd_rate, eur_rate, cny_rate,
		       COALESCE(created_at, NOW()), COALESCE(updated_at, NOW())
		FROM public.tenders
		%s
		ORDER BY updated_at DESC, id DESC
		LIMIT $%d
	`, where, argN)

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("tenderRepo.ListTenders: query: %w", err)
	}
	defer rows.Close()

	var result []TenderRow
	for rows.Next() {
		var row TenderRow
		if err := rows.Scan(
			&row.ID, &row.TenderNumber, &row.Title, &row.ClientName,
			&row.HousingClass, &row.ConstructionScope,
			&row.IsArchived, &row.CachedGrandTotal,
			&row.USDRate, &row.EURRate, &row.CNYRate,
			&row.CreatedAt, &row.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("tenderRepo.ListTenders: scan: %w", err)
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderRepo.ListTenders: rows: %w", err)
	}
	return result, nil
}

// GetTenderOverview fetches header columns plus aggregate counts for one tender.
func (r *TenderRepo) GetTenderOverview(ctx context.Context, tenderID string) (*TenderOverviewRow, error) {
	const q = `
		SELECT
		    t.id::text,
		    t.tender_number,
		    t.title,
		    t.client_name,
		    t.housing_class::text,
		    t.construction_scope::text,
		    t.is_archived,
		    t.cached_grand_total,
		    t.usd_rate,
		    t.eur_rate,
		    t.cny_rate,
		    COUNT(DISTINCT cp.id)  AS position_count,
		    COUNT(DISTINCT bi.id)  AS boq_item_count,
		    COALESCE(t.created_at, NOW()),
		    COALESCE(t.updated_at, NOW())
		FROM public.tenders t
		LEFT JOIN public.client_positions cp ON cp.tender_id = t.id
		LEFT JOIN public.boq_items        bi ON bi.tender_id = t.id
		WHERE t.id = $1
		GROUP BY t.id
	`

	row := r.pool.QueryRow(ctx, q, tenderID)
	var ov TenderOverviewRow
	if err := row.Scan(
		&ov.ID, &ov.TenderNumber, &ov.Title, &ov.ClientName,
		&ov.HousingClass, &ov.ConstructionScope,
		&ov.IsArchived, &ov.CachedGrandTotal,
		&ov.USDRate, &ov.EURRate, &ov.CNYRate,
		&ov.PositionCount, &ov.BoqItemCount,
		&ov.CreatedAt, &ov.UpdatedAt,
	); err != nil {
		return nil, fmt.Errorf("tenderRepo.GetTenderOverview: scan: %w", err)
	}
	return &ov, nil
}
