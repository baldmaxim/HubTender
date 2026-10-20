package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TenderRegistryRepo handles tender_registry / tender_statuses /
// construction_scopes reads + writes consumed by src/pages/Tenders/.
type TenderRegistryRepo struct {
	pool *pgxpool.Pool
}

// NewTenderRegistryRepo creates a TenderRegistryRepo.
func NewTenderRegistryRepo(pool *pgxpool.Pool) *TenderRegistryRepo {
	return &TenderRegistryRepo{pool: pool}
}

// TenderRegistryRow mirrors public.tender_registry plus the joined status /
// construction_scope objects the frontend expects.
type TenderRegistryRow struct {
	ID                 string          `json:"id"`
	TenderNumber       *string         `json:"tender_number,omitempty"`
	Title              string          `json:"title"`
	ClientName         string          `json:"client_name"`
	ObjectAddress      *string         `json:"object_address,omitempty"`
	ObjectCoordinates  *string         `json:"object_coordinates,omitempty"`
	Area               *float64        `json:"area,omitempty"`
	StatusID           *string         `json:"status_id,omitempty"`
	ConstructionScopeID *string        `json:"construction_scope_id,omitempty"`
	DashboardStatus    *string         `json:"dashboard_status,omitempty"`
	IsArchived         bool            `json:"is_archived"`
	SortOrder          int             `json:"sort_order"`
	ManualTotalCost    *float64        `json:"manual_total_cost,omitempty"`
	ChronologyItems    json.RawMessage `json:"chronology_items,omitempty"`
	TenderPackageItems json.RawMessage `json:"tender_package_items,omitempty"`
	HasTenderPackage   *string         `json:"has_tender_package,omitempty"`
	SubmissionDate     *string         `json:"submission_date,omitempty"`
	CommissionDate     *string         `json:"commission_date,omitempty"`
	ConstructionStart  *string         `json:"construction_start_date,omitempty"`
	SiteVisitDate      *string         `json:"site_visit_date,omitempty"`
	SiteVisitPhotoURL  *string         `json:"site_visit_photo_url,omitempty"`
	InvitationDate     *string         `json:"invitation_date,omitempty"`
	CreatedAt          *string         `json:"created_at,omitempty"`
	UpdatedAt          *string         `json:"updated_at,omitempty"`
	Status             *NamedRefRow    `json:"status,omitempty"`
	ConstructionScope  *NamedRefRow    `json:"construction_scope,omitempty"`
}

// NamedRefRow is the joined {id, name} object embedded in a registry row.
type NamedRefRow struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

const tenderRegistrySelect = `
	SELECT
		tr.id::text,
		tr.tender_number,
		tr.title,
		tr.client_name,
		tr.object_address,
		tr.object_coordinates,
		tr.area,
		tr.status_id::text,
		tr.construction_scope_id::text,
		tr.dashboard_status,
		tr.is_archived,
		tr.sort_order,
		tr.manual_total_cost,
		tr.chronology_items,
		tr.tender_package_items,
		tr.has_tender_package,
		to_char(tr.submission_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		to_char(tr.commission_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		to_char(tr.construction_start_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		to_char(tr.site_visit_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		tr.site_visit_photo_url,
		to_char(tr.invitation_date, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		to_char(tr.created_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		to_char(tr.updated_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		ts.id::text, ts.name,
		cs.id::text, cs.name
	FROM public.tender_registry tr
	LEFT JOIN public.tender_statuses ts ON ts.id = tr.status_id
	LEFT JOIN public.construction_scopes cs ON cs.id = tr.construction_scope_id
`

func scanTenderRegistryRow(scanner interface {
	Scan(dest ...any) error
}) (TenderRegistryRow, error) {
	var (
		row     TenderRegistryRow
		statusID, statusName             *string
		scopeID, scopeName               *string
		chronology, tenderPackage        []byte
	)
	err := scanner.Scan(
		&row.ID,
		&row.TenderNumber,
		&row.Title,
		&row.ClientName,
		&row.ObjectAddress,
		&row.ObjectCoordinates,
		&row.Area,
		&row.StatusID,
		&row.ConstructionScopeID,
		&row.DashboardStatus,
		&row.IsArchived,
		&row.SortOrder,
		&row.ManualTotalCost,
		&chronology,
		&tenderPackage,
		&row.HasTenderPackage,
		&row.SubmissionDate,
		&row.CommissionDate,
		&row.ConstructionStart,
		&row.SiteVisitDate,
		&row.SiteVisitPhotoURL,
		&row.InvitationDate,
		&row.CreatedAt,
		&row.UpdatedAt,
		&statusID, &statusName,
		&scopeID, &scopeName,
	)
	if err != nil {
		return row, err
	}
	if len(chronology) > 0 {
		row.ChronologyItems = chronology
	}
	if len(tenderPackage) > 0 {
		row.TenderPackageItems = tenderPackage
	}
	if statusID != nil && statusName != nil {
		row.Status = &NamedRefRow{ID: *statusID, Name: *statusName}
	}
	if scopeID != nil && scopeName != nil {
		row.ConstructionScope = &NamedRefRow{ID: *scopeID, Name: *scopeName}
	}
	return row, nil
}

// List returns all tender_registry rows ordered by sort_order.
func (r *TenderRegistryRepo) List(ctx context.Context) ([]TenderRegistryRow, error) {
	rows, err := r.pool.Query(ctx, tenderRegistrySelect+" ORDER BY tr.sort_order ASC")
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.List: query: %w", err)
	}
	defer rows.Close()

	out := make([]TenderRegistryRow, 0)
	for rows.Next() {
		row, err := scanTenderRegistryRow(rows)
		if err != nil {
			return nil, fmt.Errorf("tenderRegistryRepo.List: scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.List: rows: %w", err)
	}
	return out, nil
}

// NextSortOrder returns max(sort_order)+1, or 1 if the table is empty.
func (r *TenderRegistryRepo) NextSortOrder(ctx context.Context) (int, error) {
	var n int
	err := r.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(sort_order), 0) + 1 FROM public.tender_registry
	`).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("tenderRegistryRepo.NextSortOrder: %w", err)
	}
	return n, nil
}

// AutocompleteRow is one row of the autocomplete dataset.
type AutocompleteRow struct {
	Title      string `json:"title"`
	ClientName string `json:"client_name"`
}

// Autocomplete returns the latest 100 (title, client_name) pairs.
func (r *TenderRegistryRepo) Autocomplete(ctx context.Context) ([]AutocompleteRow, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT title, client_name
		FROM public.tender_registry
		ORDER BY created_at DESC NULLS LAST
		LIMIT 100
	`)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.Autocomplete: query: %w", err)
	}
	defer rows.Close()

	out := make([]AutocompleteRow, 0)
	for rows.Next() {
		var row AutocompleteRow
		if err := rows.Scan(&row.Title, &row.ClientName); err != nil {
			return nil, fmt.Errorf("tenderRegistryRepo.Autocomplete: scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.Autocomplete: rows: %w", err)
	}
	return out, nil
}

// CreateInput captures the writable fields for INSERT.
type TenderRegistryCreateInput struct {
	TenderNumber       *string         `json:"tender_number"`
	Title              string          `json:"title"`
	ClientName         string          `json:"client_name"`
	ObjectAddress      *string         `json:"object_address"`
	ObjectCoordinates  *string         `json:"object_coordinates"`
	Area               *float64        `json:"area"`
	StatusID           *string         `json:"status_id"`
	ConstructionScopeID *string        `json:"construction_scope_id"`
	DashboardStatus    *string         `json:"dashboard_status"`
	IsArchived         bool            `json:"is_archived"`
	SortOrder          int             `json:"sort_order"`
	ChronologyItems    json.RawMessage `json:"chronology_items"`
	TenderPackageItems json.RawMessage `json:"tender_package_items"`
	HasTenderPackage   *string         `json:"has_tender_package"`
	SubmissionDate     *string         `json:"submission_date"`
	CommissionDate     *string         `json:"commission_date"`
	ConstructionStart  *string         `json:"construction_start_date"`
	SiteVisitDate      *string         `json:"site_visit_date"`
	SiteVisitPhotoURL  *string         `json:"site_visit_photo_url"`
	InvitationDate     *string         `json:"invitation_date"`
}

// Create inserts a new tender_registry row.
func (r *TenderRegistryRepo) Create(ctx context.Context, in TenderRegistryCreateInput) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO public.tender_registry (
			tender_number, title, client_name,
			object_address, object_coordinates, area,
			status_id, construction_scope_id, dashboard_status,
			is_archived, sort_order,
			chronology_items, tender_package_items, has_tender_package,
			submission_date, commission_date, construction_start_date,
			site_visit_date, site_visit_photo_url, invitation_date
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9,
			$10, $11, $12::jsonb, $13::jsonb, $14,
			$15::date, $16::date, $17::date, $18::date, $19, $20::date
		)
	`,
		in.TenderNumber, in.Title, in.ClientName,
		in.ObjectAddress, in.ObjectCoordinates, in.Area,
		in.StatusID, in.ConstructionScopeID, in.DashboardStatus,
		in.IsArchived, in.SortOrder,
		bytesOrNil(in.ChronologyItems), bytesOrNil(in.TenderPackageItems), in.HasTenderPackage,
		in.SubmissionDate, in.CommissionDate, in.ConstructionStart,
		in.SiteVisitDate, in.SiteVisitPhotoURL, in.InvitationDate,
	)
	if err != nil {
		return fmt.Errorf("tenderRegistryRepo.Create: %w", err)
	}
	return nil
}

func bytesOrNil(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	return string(b)
}

// UpdateInput captures partial-update fields. Only non-nil fields are written.
type TenderRegistryUpdateInput struct {
	SortOrder  *int  `json:"sort_order,omitempty"`
	IsArchived *bool `json:"is_archived,omitempty"`
}

// Update applies the patch atomically.
func (r *TenderRegistryRepo) Update(ctx context.Context, id string, in TenderRegistryUpdateInput) error {
	// Deliberately narrow scope — these are the only fields the frontend
	// patches via tender_registry today (sort_order swap + archive toggle).
	if in.SortOrder == nil && in.IsArchived == nil {
		return nil
	}
	_, err := r.pool.Exec(ctx, `
		UPDATE public.tender_registry
		SET
			sort_order  = COALESCE($1, sort_order),
			is_archived = COALESCE($2, is_archived),
			updated_at  = NOW()
		WHERE id = $3
	`, in.SortOrder, in.IsArchived, id)
	if err != nil {
		return fmt.Errorf("tenderRegistryRepo.Update: %w", err)
	}
	return nil
}

// TenderRegistryPatch is the admin-modal patch shape — all fields the
// Tenders/* UI surfaces. Non-nil fields are applied; an explicit null clears
// a nullable column (see sqlSet).
type TenderRegistryPatch struct {
	TenderNumber          *string          `json:"tender_number"`
	Title                 *string          `json:"title"`
	ClientName            *string          `json:"client_name"`
	ObjectAddress         *string          `json:"object_address"`
	ObjectCoordinates     *string          `json:"object_coordinates"`
	ConstructionScopeID   *string          `json:"construction_scope_id"`
	Area                  *float64         `json:"area"`
	SubmissionDate        *string          `json:"submission_date"`
	ChronologyItems       *json.RawMessage `json:"chronology_items"`
	ConstructionStartDate *string          `json:"construction_start_date"`
	SiteVisitDate         *string          `json:"site_visit_date"`
	SiteVisitPhotoURL     *string          `json:"site_visit_photo_url"`
	TenderPackageItems    *json.RawMessage `json:"tender_package_items"`
	InvitationDate        *string          `json:"invitation_date"`
	StatusID              *string          `json:"status_id"`
	CommissionDate        *string          `json:"commission_date"`
	DashboardStatus       *string          `json:"dashboard_status"`
	ManualTotalCost       *float64         `json:"manual_total_cost"`
	IsArchived            *bool            `json:"is_archived"`
	SortOrder             *int             `json:"sort_order"`

	// present — множество ключей, реально пришедших в JSON-теле. Позволяет
	// sqlSet отличить явный null (очистить столбец) от отсутствия поля
	// (не трогать) для nullable-колонок: status_id, даты, адрес, площадь и т.д.
	present map[string]bool
}

// UnmarshalJSON декодирует патч и одновременно фиксирует набор присутствующих
// ключей. Без этого JSON `status_id: null` неотличим от отсутствия поля
// (оба дают *string == nil), и очистка статуса («Направлено») или поля карточки
// тендера молча теряется.
func (p *TenderRegistryPatch) UnmarshalJSON(b []byte) error {
	type alias TenderRegistryPatch
	if err := json.Unmarshal(b, (*alias)(p)); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	p.present = make(map[string]bool, len(raw))
	for k := range raw {
		p.present[k] = true
	}
	return nil
}

// sqlSet собирает SET-часть UPDATE. Nullable-колонки: явный null в теле (ключ
// пришёл — present) очищает столбец, отсутствие ключа их не трогает; pgx пишет
// NULL для nil-указателя. NOT NULL-колонки и jsonb-списки null не принимают —
// для них, как и раньше, пишется только непустое значение.
func (p TenderRegistryPatch) sqlSet() (string, []any) {
	args := []any{}
	setClauses := ""
	add := func(col string, val any) {
		if setClauses != "" {
			setClauses += ", "
		}
		setClauses += fmt.Sprintf("%s = $%d", col, len(args)+1)
		args = append(args, val)
	}
	nullable := func(col string, val any, isSet bool) {
		if isSet || p.present[col] {
			add(col, val)
		}
	}
	nullable("tender_number", p.TenderNumber, p.TenderNumber != nil)
	if p.Title != nil {
		add("title", *p.Title)
	}
	if p.ClientName != nil {
		add("client_name", *p.ClientName)
	}
	nullable("object_address", p.ObjectAddress, p.ObjectAddress != nil)
	nullable("object_coordinates", p.ObjectCoordinates, p.ObjectCoordinates != nil)
	nullable("construction_scope_id", p.ConstructionScopeID, p.ConstructionScopeID != nil)
	nullable("area", p.Area, p.Area != nil)
	nullable("submission_date", p.SubmissionDate, p.SubmissionDate != nil)
	if p.ChronologyItems != nil {
		add("chronology_items", []byte(*p.ChronologyItems))
	}
	nullable("construction_start_date", p.ConstructionStartDate, p.ConstructionStartDate != nil)
	nullable("site_visit_date", p.SiteVisitDate, p.SiteVisitDate != nil)
	nullable("site_visit_photo_url", p.SiteVisitPhotoURL, p.SiteVisitPhotoURL != nil)
	if p.TenderPackageItems != nil {
		add("tender_package_items", []byte(*p.TenderPackageItems))
	}
	nullable("invitation_date", p.InvitationDate, p.InvitationDate != nil)
	// status_id = null — псевдостатус «Направлено».
	nullable("status_id", p.StatusID, p.StatusID != nil)
	nullable("commission_date", p.CommissionDate, p.CommissionDate != nil)
	if p.DashboardStatus != nil {
		add("dashboard_status", *p.DashboardStatus)
	}
	nullable("manual_total_cost", p.ManualTotalCost, p.ManualTotalCost != nil)
	if p.IsArchived != nil {
		add("is_archived", *p.IsArchived)
	}
	if p.SortOrder != nil {
		add("sort_order", *p.SortOrder)
	}
	return setClauses, args
}

// PatchFields applies the patch (see sqlSet) to a tender_registry row.
func (r *TenderRegistryRepo) PatchFields(ctx context.Context, id string, p TenderRegistryPatch) error {
	setClauses, args := p.sqlSet()
	if setClauses == "" {
		return nil
	}
	setClauses += ", updated_at = NOW()"
	args = append(args, id)
	q := fmt.Sprintf(`UPDATE public.tender_registry SET %s WHERE id = $%d`, setClauses, len(args))
	if _, err := r.pool.Exec(ctx, q, args...); err != nil {
		return fmt.Errorf("tenderRegistryRepo.PatchFields: %w", err)
	}
	return nil
}

// DeletedRegistryRow — строка, удалённая из «Перечня тендеров» (ответ клиенту и журнал).
type DeletedRegistryRow struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	TenderNumber *string `json:"tender_number,omitempty"`
}

// DeleteMany удаляет строки перечня одним запросом. Расчёты тендеров (tenders,
// позиции, ВОР) связаны с перечнем только номером тендера и не затрагиваются;
// каскадом уходят лишь напоминания Telegram-бота по этим строкам.
func (r *TenderRegistryRepo) DeleteMany(ctx context.Context, ids []string) ([]DeletedRegistryRow, error) {
	rows, err := r.pool.Query(ctx, `
		DELETE FROM public.tender_registry
		WHERE id = ANY($1::uuid[])
		RETURNING id::text, title, tender_number
	`, ids)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.DeleteMany: %w", err)
	}
	defer rows.Close()

	out := make([]DeletedRegistryRow, 0, len(ids))
	for rows.Next() {
		var d DeletedRegistryRow
		if err := rows.Scan(&d.ID, &d.Title, &d.TenderNumber); err != nil {
			return nil, fmt.Errorf("tenderRegistryRepo.DeleteMany: scan: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.DeleteMany: %w", err)
	}
	return out, nil
}

// ListTenderStatuses returns rows from public.tender_statuses ordered by name.
func (r *TenderRegistryRepo) ListTenderStatuses(ctx context.Context) ([]NamedRefRow, error) {
	return r.listNamedRef(ctx, `SELECT id::text, name FROM public.tender_statuses ORDER BY name`)
}

// ListConstructionScopes returns rows from public.construction_scopes ordered by name.
func (r *TenderRegistryRepo) ListConstructionScopes(ctx context.Context) ([]NamedRefRow, error) {
	return r.listNamedRef(ctx, `SELECT id::text, name FROM public.construction_scopes ORDER BY name`)
}

func (r *TenderRegistryRepo) listNamedRef(ctx context.Context, q string) ([]NamedRefRow, error) {
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.listNamedRef: query: %w", err)
	}
	defer rows.Close()

	out := make([]NamedRefRow, 0)
	for rows.Next() {
		var row NamedRefRow
		if err := rows.Scan(&row.ID, &row.Name); err != nil {
			return nil, fmt.Errorf("tenderRegistryRepo.listNamedRef: scan: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.listNamedRef: rows: %w", err)
	}
	return out, nil
}

// TenderNumber returns distinct tender_number values from public.tenders.
func (r *TenderRegistryRepo) TenderNumbers(ctx context.Context) ([]string, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT DISTINCT tender_number
		FROM public.tenders
		WHERE tender_number IS NOT NULL
		ORDER BY tender_number
	`)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.TenderNumbers: query: %w", err)
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, fmt.Errorf("tenderRegistryRepo.TenderNumbers: scan: %w", err)
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// RelatedTenderRow describes the public.tenders projection used by Tenders
// page to compute total_cost from cached_grand_total.
type RelatedTenderRow struct {
	ID                string   `json:"id"`
	TenderNumber      *string  `json:"tender_number,omitempty"`
	Version           *int     `json:"version,omitempty"`
	CachedGrandTotal  *float64 `json:"cached_grand_total,omitempty"`
}

// RelatedTendersByNumbers returns public.tenders rows filtered by tender_number.
func (r *TenderRegistryRepo) RelatedTendersByNumbers(ctx context.Context, numbers []string) ([]RelatedTenderRow, error) {
	if len(numbers) == 0 {
		return []RelatedTenderRow{}, nil
	}
	rows, err := r.pool.Query(ctx, `
		SELECT id::text, tender_number, version, cached_grand_total
		FROM public.tenders
		WHERE tender_number = ANY($1::text[])
	`, numbers)
	if err != nil {
		return nil, fmt.Errorf("tenderRegistryRepo.RelatedTendersByNumbers: query: %w", err)
	}
	defer rows.Close()

	out := make([]RelatedTenderRow, 0)
	for rows.Next() {
		var row RelatedTenderRow
		if err := rows.Scan(&row.ID, &row.TenderNumber, &row.Version, &row.CachedGrandTotal); err != nil {
			return nil, fmt.Errorf("tenderRegistryRepo.RelatedTendersByNumbers: scan: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
