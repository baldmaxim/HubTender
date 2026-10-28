package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Подтверждение авторасценки (тест): прогоны авторасценки — import_sessions с
// source='autoprice'; проверка позиции в прогоне — autoprice_position_reviews.
// Миграция: db/yandex/incremental/2026_10_autoprice_review.sql.

// AutopriceSource — значение import_sessions.source для прогонов авторасценки.
const AutopriceSource = "autoprice"

var (
	ErrAutopriceTenderNotFound   = errors.New("autoprice: tender not found")
	ErrAutopriceRunNotFound      = errors.New("autoprice: run not found")
	ErrAutopriceRunCancelled     = errors.New("autoprice: run cancelled")
	ErrAutopricePositionNotFound = errors.New("autoprice: position not found in run tender")
	ErrAutopriceReviewNotFound   = errors.New("autoprice: review not found")
	// ErrAutopriceApproved — позиция уже подтверждена: правка и повторная
	// загрузка запрещены, пока подтверждение не снято (reopen).
	ErrAutopriceApproved = errors.New("autoprice: review is approved")
)

// InvalidImportSessionError — import_session_id при создании строки не подходит
// (400 на write-path).
type InvalidImportSessionError struct{ Reason string }

func (e *InvalidImportSessionError) Error() string { return e.Reason }

// AutopriceZeroPriceError — подтвердить нельзя: в позиции есть строки с нулевой ценой.
type AutopriceZeroPriceError struct{ Count int }

func (e *AutopriceZeroPriceError) Error() string {
	return fmt.Sprintf("autoprice: %d items with zero unit_rate", e.Count)
}

// AutopriceTransitionError — действие недопустимо из текущего статуса.
type AutopriceTransitionError struct{ Action, From string }

func (e *AutopriceTransitionError) Error() string {
	return fmt.Sprintf("autoprice: action %q is not allowed from status %q", e.Action, e.From)
}

// AutopriceStaleFields — поля строки, правка которых снимает подтверждение
// (UPDATE-записи аудита). INSERT/DELETE строки снимают его всегда; количество
// и итоги — нет.
var AutopriceStaleFields = []string{
	"unit_rate", "conversion_coefficient", "consumption_coefficient",
	"work_name_id", "material_name_id", "material_type",
}

// autopriceStaleExpr — SQL-выражение approval_stale для строки r
// (autoprice_position_reviews): подтверждённая позиция, в строках которой после
// approved_at была запись аудита INSERT/DELETE или правка ценовых полей.
// Условие по двум индексированным выражениям (idx_audit_new_position,
// idx_audit_old_position): удалённая строка видна только в old_data.
const autopriceStaleExpr = `(CASE WHEN r.status = 'approved' AND r.approved_at IS NOT NULL THEN EXISTS (
	SELECT 1 FROM public.boq_items_audit a
	WHERE ((a.new_data ->> 'client_position_id') = r.client_position_id::text
	    OR (a.old_data ->> 'client_position_id') = r.client_position_id::text)
	  AND a.changed_at > r.approved_at
	  AND (a.operation_type IN ('INSERT', 'DELETE')
	       OR a.changed_fields && ARRAY['unit_rate','conversion_coefficient','consumption_coefficient','work_name_id','material_name_id','material_type']::text[])
) ELSE false END)`

// AutopriceRunCreated — ответ POST /tenders/{id}/autoprice-runs.
type AutopriceRunCreated struct {
	ID         string    `json:"id"`
	Label      string    `json:"label"`
	SourceRef  *string   `json:"source_ref"`
	ImportedAt time.Time `json:"imported_at"`
}

// AutopriceRun — прогон авторасценки со счётчиками позиций. Позиции — карточки
// проверки прогона; «не подтверждено» = статус не approved/excluded или
// подтверждение устарело; excluded в счётчики не входит.
type AutopriceRun struct {
	ID              string     `json:"id"`
	Label           string     `json:"label"`
	SourceRef       *string    `json:"source_ref"`
	ImportedAt      time.Time  `json:"imported_at"`
	CancelledAt     *time.Time `json:"cancelled_at"`
	UserID          *string    `json:"user_id"`
	PositionsTotal  int        `json:"positions_total"`
	ApprovedCount   int        `json:"approved_count"`
	UnapprovedCount int        `json:"unapproved_count"`
	// TenderID — для гейта и проверок; в JSON не отдаётся.
	TenderID string `json:"-"`
}

// AutopriceTender — тендер с неотменённым прогоном авторасценки.
type AutopriceTender struct {
	TenderID     string `json:"tender_id"`
	TenderNumber string `json:"tender_number"`
	Title        string `json:"title"`
	Version      int    `json:"version"`
}

// AutopriceReview — карточка проверки позиции (элемент GET .../reviews).
type AutopriceReview struct {
	ClientPositionID string          `json:"client_position_id"`
	PositionNumber   float64         `json:"position_number"`
	ItemNo           *string         `json:"item_no"`
	WorkName         string          `json:"work_name"`
	Section          *string         `json:"section"`
	ItemsCount       int             `json:"items_count"`
	ZeroPriceCount   int             `json:"zero_price_count"`
	Basis            *string         `json:"basis"`
	PdRefs           json.RawMessage `json:"pd_refs"`
	PdNote           *string         `json:"pd_note"`
	Questions        json.RawMessage `json:"questions"`
	Findings         json.RawMessage `json:"findings"`
	Status           string          `json:"status"`
	ApprovalStale    bool            `json:"approval_stale"`
	EngineerComment  *string         `json:"engineer_comment"`
	ApprovedBy       *string         `json:"approved_by"`
	ApprovedByName   *string         `json:"approved_by_name"`
	ApprovedAt       *time.Time      `json:"approved_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
	// Events — только в карточке одной позиции (GET .../positions/{posId}).
	Events json.RawMessage `json:"events,omitempty"`
}

// AutopriceReviewRepo — прогоны авторасценки и проверки позиций.
type AutopriceReviewRepo struct {
	pool *pgxpool.Pool
}

// NewAutopriceReviewRepo creates an AutopriceReviewRepo.
func NewAutopriceReviewRepo(pool *pgxpool.Pool) *AutopriceReviewRepo {
	return &AutopriceReviewRepo{pool: pool}
}

// TenderOfRun — тендер прогона (резолвер гейта машинного доступа).
func (r *AutopriceReviewRepo) TenderOfRun(ctx context.Context, sessionID string) (string, error) {
	var tenderID *string
	err := r.pool.QueryRow(ctx, `
		SELECT tender_id::text FROM public.import_sessions WHERE id = $1 AND source = $2`,
		sessionID, AutopriceSource).Scan(&tenderID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrAutopriceRunNotFound
		}
		return "", fmt.Errorf("autoprice.TenderOfRun: %w", err)
	}
	if tenderID == nil {
		return "", ErrAutopriceRunNotFound
	}
	return *tenderID, nil
}

// CreateRun создаёт прогон авторасценки (import_sessions, source='autoprice').
func (r *AutopriceReviewRepo) CreateRun(ctx context.Context, tenderID, userID, label string, sourceRef *string) (*AutopriceRunCreated, error) {
	var exists bool
	if err := r.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM public.tenders WHERE id = $1)`, tenderID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("autoprice.CreateRun: tender: %w", err)
	}
	if !exists {
		return nil, ErrAutopriceTenderNotFound
	}
	out := &AutopriceRunCreated{}
	err := r.pool.QueryRow(ctx, `
		INSERT INTO public.import_sessions (user_id, tender_id, file_name, source, label)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text, COALESCE(label, ''), file_name, imported_at`,
		userID, tenderID, sourceRef, AutopriceSource, label,
	).Scan(&out.ID, &out.Label, &out.SourceRef, &out.ImportedAt)
	if err != nil {
		return nil, fmt.Errorf("autoprice.CreateRun: insert: %w", err)
	}
	return out, nil
}

const autopriceRunSelect = `
SELECT s.id::text, COALESCE(s.label, ''), s.file_name, s.imported_at, s.cancelled_at,
       s.user_id::text, COALESCE(s.tender_id::text, ''),
       COALESCE(c.total, 0), COALESCE(c.approved, 0), COALESCE(c.unapproved, 0)
FROM public.import_sessions s
LEFT JOIN LATERAL (
    SELECT count(*)::int AS total,
           (count(*) FILTER (WHERE x.status = 'approved' AND NOT x.stale))::int AS approved,
           (count(*) FILTER (WHERE x.status NOT IN ('approved', 'excluded') OR x.stale))::int AS unapproved
    FROM (
        SELECT r.status, ` + autopriceStaleExpr + ` AS stale
        FROM public.autoprice_position_reviews r
        WHERE r.import_session_id = s.id
    ) x
) c ON true
WHERE s.source = 'autoprice' AND `

func scanAutopriceRun(row pgx.Row) (*AutopriceRun, error) {
	run := &AutopriceRun{}
	if err := row.Scan(&run.ID, &run.Label, &run.SourceRef, &run.ImportedAt, &run.CancelledAt,
		&run.UserID, &run.TenderID, &run.PositionsTotal, &run.ApprovedCount, &run.UnapprovedCount); err != nil {
		return nil, err
	}
	return run, nil
}

// ListRuns — прогоны тендера (включая отменённые), новые сверху.
func (r *AutopriceReviewRepo) ListRuns(ctx context.Context, tenderID string) ([]AutopriceRun, error) {
	rows, err := r.pool.Query(ctx, autopriceRunSelect+`s.tender_id = $1 ORDER BY s.imported_at DESC, s.id`, tenderID)
	if err != nil {
		return nil, fmt.Errorf("autoprice.ListRuns: %w", err)
	}
	defer rows.Close()
	out := make([]AutopriceRun, 0)
	for rows.Next() {
		run, err := scanAutopriceRun(rows)
		if err != nil {
			return nil, fmt.Errorf("autoprice.ListRuns scan: %w", err)
		}
		out = append(out, *run)
	}
	return out, rows.Err()
}

// GetRun — один прогон со счётчиками.
func (r *AutopriceReviewRepo) GetRun(ctx context.Context, sessionID string) (*AutopriceRun, error) {
	run, err := scanAutopriceRun(r.pool.QueryRow(ctx, autopriceRunSelect+`s.id = $1`, sessionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAutopriceRunNotFound
		}
		return nil, fmt.Errorf("autoprice.GetRun: %w", err)
	}
	return run, nil
}

// ListTenders — тендеры с неотменённым прогоном авторасценки.
func (r *AutopriceReviewRepo) ListTenders(ctx context.Context) ([]AutopriceTender, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT t.id::text, COALESCE(t.tender_number, ''), COALESCE(t.title, ''), COALESCE(t.version, 1)
		FROM public.tenders t
		WHERE EXISTS (SELECT 1 FROM public.import_sessions s
		              WHERE s.tender_id = t.id AND s.source = 'autoprice' AND s.cancelled_at IS NULL)
		ORDER BY t.tender_number, t.version, t.id`)
	if err != nil {
		return nil, fmt.Errorf("autoprice.ListTenders: %w", err)
	}
	defer rows.Close()
	out := make([]AutopriceTender, 0)
	for rows.Next() {
		var t AutopriceTender
		if err := rows.Scan(&t.TenderID, &t.TenderNumber, &t.Title, &t.Version); err != nil {
			return nil, fmt.Errorf("autoprice.ListTenders scan: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// autopriceReviewQuery — выборка карточек проверки прогона ($1 = id сессии);
// where — дополнительное условие (например, "AND r.client_position_id = $2").
// Раздел — самая частая категория затрат по строкам позиции (как в
// position_list.go). Счётчики строк и approval_stale считаются в том же запросе.
func autopriceReviewQuery(withEvents bool, where string) string {
	events := ""
	if withEvents {
		events = ", r.events"
	}
	return `
SELECT r.client_position_id::text, cp.position_number::float8, cp.item_no, cp.work_name, sec.name,
       COALESCE(agg.items_count, 0), COALESCE(agg.zero_count, 0),
       r.basis, r.pd_refs, r.pd_note, r.questions, r.findings, r.status,
       ` + autopriceStaleExpr + `,
       r.engineer_comment, r.approved_by::text, u.full_name, r.approved_at, r.updated_at` + events + `
FROM public.autoprice_position_reviews r
JOIN public.client_positions cp ON cp.id = r.client_position_id
LEFT JOIN public.users u ON u.id = r.approved_by
LEFT JOIN LATERAL (
    SELECT count(*)::int AS items_count,
           (count(*) FILTER (WHERE COALESCE(b.unit_rate, 0) = 0))::int AS zero_count
    FROM public.boq_items b
    WHERE b.client_position_id = r.client_position_id
) agg ON true
LEFT JOIN LATERAL (
    SELECT cc.name
    FROM public.boq_items bi
    JOIN public.detail_cost_categories dcc ON dcc.id = bi.detail_cost_category_id
    JOIN public.cost_categories cc ON cc.id = dcc.cost_category_id
    WHERE bi.client_position_id = r.client_position_id
    GROUP BY cc.id, cc.name
    ORDER BY COUNT(*) DESC, cc.name, cc.id
    LIMIT 1
) sec ON true
WHERE r.import_session_id = $1 ` + where + `
ORDER BY cp.position_number, cp.id`
}

func scanAutopriceReview(row pgx.Row, withEvents bool) (*AutopriceReview, error) {
	v := &AutopriceReview{}
	dest := []any{&v.ClientPositionID, &v.PositionNumber, &v.ItemNo, &v.WorkName, &v.Section,
		&v.ItemsCount, &v.ZeroPriceCount, &v.Basis, &v.PdRefs, &v.PdNote, &v.Questions, &v.Findings,
		&v.Status, &v.ApprovalStale, &v.EngineerComment, &v.ApprovedBy, &v.ApprovedByName,
		&v.ApprovedAt, &v.UpdatedAt}
	if withEvents {
		dest = append(dest, &v.Events)
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return v, nil
}

// ListReviews — карточки проверки прогона, по номеру позиции.
func (r *AutopriceReviewRepo) ListReviews(ctx context.Context, sessionID string) ([]AutopriceReview, error) {
	rows, err := r.pool.Query(ctx, autopriceReviewQuery(false, ""), sessionID)
	if err != nil {
		return nil, fmt.Errorf("autoprice.ListReviews: %w", err)
	}
	defer rows.Close()
	out := make([]AutopriceReview, 0)
	for rows.Next() {
		v, err := scanAutopriceReview(rows, false)
		if err != nil {
			return nil, fmt.Errorf("autoprice.ListReviews scan: %w", err)
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// GetReview — карточка одной позиции прогона вместе с журналом событий.
func (r *AutopriceReviewRepo) GetReview(ctx context.Context, sessionID, positionID string) (*AutopriceReview, error) {
	return getAutopriceReview(ctx, r.pool, sessionID, positionID)
}

type autopriceQuerier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func getAutopriceReview(ctx context.Context, q autopriceQuerier, sessionID, positionID string) (*AutopriceReview, error) {
	v, err := scanAutopriceReview(
		q.QueryRow(ctx, autopriceReviewQuery(true, "AND r.client_position_id = $2"), sessionID, positionID), true)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAutopriceReviewNotFound
		}
		return nil, fmt.Errorf("autoprice.GetReview: %w", err)
	}
	return v, nil
}
