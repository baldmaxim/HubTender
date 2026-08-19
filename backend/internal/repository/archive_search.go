package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ArchiveRepo — read/write доступ к архиву смет (исторические позиции
// заказчика чужих тендеров).
type ArchiveRepo struct {
	pool *pgxpool.Pool
}

// NewArchiveRepo creates an ArchiveRepo.
func NewArchiveRepo(pool *pgxpool.Pool) *ArchiveRepo {
	return &ArchiveRepo{pool: pool}
}

// Границы выборки кандидатов: SQL-префильтр грубый, точную оценку даёт
// estimatearchive.Rank уже в Go, поэтому кандидатов берём с запасом.
const (
	DefaultCandidateLimit = 500
	MaxCandidateLimit     = 4000
)

// ArchiveSearchFilter — общие фильтры поиска и батч-подбора.
type ArchiveSearchFilter struct {
	// ExcludeTenderID — обычно текущий тендер: свои же позиции в архиве не нужны.
	ExcludeTenderID string
	UnitCode        string
	// OnlyLatestVersion — по одной (максимальной) версии на tender_number.
	OnlyLatestVersion bool
	// ApprovedOnly — только согласованные тендеры.
	ApprovedOnly bool
	// PeriodMonths — окно по дате создания тендера; 0 = без ограничения.
	PeriodMonths int
	// WithBoqOnly — только позиции, у которых есть строки BOQ (иначе копировать нечего).
	WithBoqOnly bool
	// CandidateLimit — потолок SQL-префильтра.
	CandidateLimit int
}

// ArchivePositionRow — историческая позиция + контекст тендера.
type ArchivePositionRow struct {
	PositionID              string   `json:"position_id"`
	TenderID                string   `json:"tender_id"`
	TenderNumber            string   `json:"tender_number"`
	TenderVersion           int      `json:"tender_version"`
	TenderTitle             string   `json:"tender_title"`
	ClientName              string   `json:"client_name"`
	TenderCreatedAt         string   `json:"tender_created_at"`
	FinancialApproved       *bool    `json:"financial_approved"`
	IsArchived              bool     `json:"is_archived"`
	ItemNo                  *string  `json:"item_no"`
	SectionNumber           *string  `json:"section_number"`
	WorkName                string   `json:"work_name"`
	UnitCode                *string  `json:"unit_code"`
	Volume                  *float64 `json:"volume"`
	ManualVolume            *float64 `json:"manual_volume"`
	TotalMaterial           *float64 `json:"total_material"`
	TotalWorks              *float64 `json:"total_works"`
	MaterialCostPerUnit     *float64 `json:"material_cost_per_unit"`
	WorkCostPerUnit         *float64 `json:"work_cost_per_unit"`
	TotalCommercialMaterial *float64 `json:"total_commercial_material"`
	TotalCommercialWork     *float64 `json:"total_commercial_work"`
	ItemsCount              int      `json:"items_count"`
}

// scopeFilterSQL — общие условия отбора тендеров архива. Плейсхолдеры:
// $1 exclude tender id (nullable), $2 approved_only, $3 period_months.
const scopeFilterSQL = `
    WHERE ($1::uuid IS NULL OR t.id <> $1::uuid)
      AND (NOT $2::boolean OR t.financial_approved = true)
      AND ($3::int = 0 OR t.created_at >= NOW() - make_interval(months => $3::int))`

// scopeLatestCTE — одна АКТУАЛЬНАЯ версия логического тендера (DISTINCT ON по
// tender_number, version DESC). Тот же приём, что в price_benchmark.go.
const scopeLatestCTE = `
WITH scope AS (
    SELECT DISTINCT ON (t.tender_number)
           t.id, t.tender_number, COALESCE(t.version, 1) AS version,
           t.title, t.client_name, t.created_at, t.financial_approved, t.is_archived
    FROM public.tenders t` + scopeFilterSQL + `
    ORDER BY t.tender_number, COALESCE(t.version, 1) DESC, t.created_at DESC
)`

// scopeAllCTE — все версии всех тендеров.
const scopeAllCTE = `
WITH scope AS (
    SELECT t.id, t.tender_number, COALESCE(t.version, 1) AS version,
           t.title, t.client_name, t.created_at, t.financial_approved, t.is_archived
    FROM public.tenders t` + scopeFilterSQL + `
)`

// archiveCandidatesSQL — тело выборки кандидатов. Плейсхолдеры продолжают
// нумерацию scope-CTE: $4 unit_code (nullable), $5 ILIKE-паттерны, $6
// with_boq_only, $7 limit.
//
// Порядок — от свежих тендеров к старым: при упоре в CandidateLimit
// отбрасывается самая старая история, а не случайная выборка.
const archiveCandidatesSQL = `
SELECT cp.id::text, s.id::text, s.tender_number, s.version,
       s.title, s.client_name,
       to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
       s.financial_approved, COALESCE(s.is_archived, false),
       cp.item_no, cp.section_number, cp.work_name, cp.unit_code,
       cp.volume, cp.manual_volume,
       cp.total_material, cp.total_works,
       cp.material_cost_per_unit, cp.work_cost_per_unit,
       cp.total_commercial_material, cp.total_commercial_work,
       (SELECT count(*) FROM public.boq_items bi WHERE bi.client_position_id = cp.id)::int
FROM scope s
JOIN public.client_positions cp ON cp.tender_id = s.id
WHERE ($4::text IS NULL OR cp.unit_code = $4::text)
  AND (cardinality($5::text[]) = 0 OR cp.work_name ILIKE ANY ($5::text[]))
  AND (NOT $6::boolean OR EXISTS (
        SELECT 1 FROM public.boq_items bi WHERE bi.client_position_id = cp.id))
ORDER BY s.created_at DESC, cp.id
LIMIT $7::int
`

// LikePattern экранирует спецсимволы LIKE и оборачивает токен в проценты.
func LikePattern(token string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(token) + "%"
}

// LoadCandidates — SQL-префильтр архива. tokens — уже подготовленные токены
// названия (estimatearchive.PrefilterTokens); пустой список означает «взять всё
// в пределах остальных фильтров и лимита».
func (r *ArchiveRepo) LoadCandidates(
	ctx context.Context, tokens []string, f ArchiveSearchFilter,
) ([]ArchivePositionRow, error) {
	limit := f.CandidateLimit
	if limit <= 0 {
		limit = DefaultCandidateLimit
	}
	if limit > MaxCandidateLimit {
		limit = MaxCandidateLimit
	}

	patterns := make([]string, 0, len(tokens))
	for _, t := range tokens {
		patterns = append(patterns, LikePattern(t))
	}

	var excludeTender, unitCode *string
	if f.ExcludeTenderID != "" {
		excludeTender = &f.ExcludeTenderID
	}
	if f.UnitCode != "" {
		unitCode = &f.UnitCode
	}

	scope := scopeAllCTE
	if f.OnlyLatestVersion {
		scope = scopeLatestCTE
	}

	rows, err := r.pool.Query(ctx, scope+archiveCandidatesSQL,
		excludeTender, f.ApprovedOnly, f.PeriodMonths,
		unitCode, patterns, f.WithBoqOnly, limit,
	)
	if err != nil {
		return nil, fmt.Errorf("archiveRepo.LoadCandidates: query: %w", err)
	}
	defer rows.Close()

	out := make([]ArchivePositionRow, 0, limit)
	for rows.Next() {
		var p ArchivePositionRow
		if err := rows.Scan(
			&p.PositionID, &p.TenderID, &p.TenderNumber, &p.TenderVersion,
			&p.TenderTitle, &p.ClientName, &p.TenderCreatedAt,
			&p.FinancialApproved, &p.IsArchived,
			&p.ItemNo, &p.SectionNumber, &p.WorkName, &p.UnitCode,
			&p.Volume, &p.ManualVolume,
			&p.TotalMaterial, &p.TotalWorks,
			&p.MaterialCostPerUnit, &p.WorkCostPerUnit,
			&p.TotalCommercialMaterial, &p.TotalCommercialWork,
			&p.ItemsCount,
		); err != nil {
			return nil, fmt.Errorf("archiveRepo.LoadCandidates: scan: %w", err)
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("archiveRepo.LoadCandidates: rows: %w", err)
	}
	return out, nil
}
